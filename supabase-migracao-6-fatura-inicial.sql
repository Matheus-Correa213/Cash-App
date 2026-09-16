-- ============================================================
-- CORREA CASH — Migração 6: fatura inicial do cartão (16/09/2026)
-- Rode depois das migrações 1 a 5.
--
-- Por quê: quando você manda pro COSMO "limite total, limite disponível,
-- fatura atual, fechamento, vencimento" de um cartão, hoje só o LIMITE e as
-- datas de fechamento/vencimento têm pra onde ir — a "fatura atual" que você
-- informa simplesmente não tinha nenhum campo pra ser guardada, porque a
-- fatura do cartão neste app é CALCULADA a partir dos lançamentos de gasto
-- feitos com aquele cartão (não é um número solto que se atualiza por fora).
-- Isso é ótimo pro dia a dia (a fatura sobe sozinha conforme você lança
-- gastos), mas deixava sem solução o caso de você querer registrar "a fatura
-- já está em R$ 2.784,54" sem lançar item por item.
--
-- Esta migração resolve isso do mesmo jeito que `contas.saldo_inicial` já
-- resolve pra contas: um "ponto de partida". `fatura_inicial` é a dívida que
-- já existia no cartão antes de você começar a lançar tudo pelo app — a
-- fatura mostrada na tela passa a ser fatura_inicial + soma dos lançamentos
-- de gasto em aberto daquele cartão. Quando você paga a fatura pelo app
-- (RPC pagar_fatura_cartao), o fatura_inicial zera junto, senão ela nunca
-- sairia do total.
--
-- Esta versão também corrige pagar_fatura_cartao pra respeitar parcelamento:
-- uma compra de R$6.000 em 10x consome o limite inteiro na hora da compra,
-- mas só a parcela do mês entra na fatura atual — as outras parcelas vencem
-- nos meses seguintes. A função agora só cobra e quita a fatura do CICLO
-- ATUAL (mesmo cálculo que a tela "Fatura atual" usa), nunca as parcelas
-- futuras. Sem isso, clicar em "Pagar fatura atual" quitaria de uma vez
-- todas as parcelas em aberto de todos os meses, não só a do mês.
-- ============================================================

alter table cartoes_credito add column if not exists fatura_inicial numeric(12,2) not null default 0;

-- Função auxiliar: em qual "mês de fatura" (primeiro dia do mês, como date)
-- um lançamento cai, dado o dia de fechamento do cartão — replica em SQL a
-- mesma regra de mesDaFatura() no frontend (theme.js). Compras feitas depois
-- do fechamento entram na fatura do mês seguinte, não na atual.
create or replace function mes_fatura_lancamento(p_data date, p_dia_fechamento int)
returns date
language sql immutable
as $$
  select case
    when p_dia_fechamento is null or extract(day from p_data) <= p_dia_fechamento
      then date_trunc('month', p_data)::date
    else (date_trunc('month', p_data) + interval '1 month')::date
  end;
$$;

grant execute on function mes_fatura_lancamento(date, int) to authenticated;

-- Substitui pagar_fatura_cartao pra somar o fatura_inicial no total cobrado,
-- zerá-lo depois de pago (senão ele ficaria contando pra sempre), e — o mais
-- importante — só cobrar/quitar a fatura do CICLO ATUAL (o mesmo "bucket" que
-- a tela do cartão mostra como "Fatura atual"), nunca as parcelas futuras de
-- uma compra parcelada. Cartão de crédito não é uma conta de subtração
-- simples: uma compra de R$6.000 em 10x consome o limite inteiro na hora, mas
-- só a parcela do mês (R$600) entra na fatura atual — as outras 9 parcelas
-- continuam lá, esperando o mês delas chegar, e não podem ser cobradas/
-- quitadas junto com a fatura de hoje.
create or replace function pagar_fatura_cartao(p_cartao_id uuid, p_descricao text default null)
returns lancamentos
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_familia_id uuid := minha_familia_id();
  v_papel text := meu_papel();
  v_membro_id uuid := meu_membro_id();
  v_cartao cartoes_credito;
  v_mes_atual date;
  v_total numeric;
  v_lancamento lancamentos;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_papel <> 'dono' then
    raise exception 'Só o administrador pode pagar faturas.';
  end if;

  select * into v_cartao from cartoes_credito where id = p_cartao_id and familia_id = v_familia_id;
  if v_cartao.id is null then
    raise exception 'Cartão não encontrado.';
  end if;
  if v_cartao.conta_pagamento_id is null then
    raise exception 'Este cartão não tem uma conta de pagamento configurada.';
  end if;

  -- O "mês atual" da fatura é o menor bucket, entre os lançamentos em aberto,
  -- que já chegou ou está em curso — igual ao "mesAtual" calculado na tela do
  -- cartão (CartaoDetalhe.jsx). Sem nenhum lançamento nesse caso, cai no mês
  -- corrente mesmo (situação normal quando só existe fatura_inicial a pagar).
  select min(mes) into v_mes_atual
    from (
      select mes_fatura_lancamento(data, v_cartao.dia_fechamento) as mes
        from lancamentos
        where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto'
    ) t
    where mes >= date_trunc('month', current_date)::date;
  if v_mes_atual is null then
    v_mes_atual := date_trunc('month', current_date)::date;
  end if;

  select coalesce(v_cartao.fatura_inicial, 0) + coalesce(sum(valor), 0) into v_total
    from lancamentos
    where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto'
      and mes_fatura_lancamento(data, v_cartao.dia_fechamento) = v_mes_atual;

  if v_total <= 0 then
    raise exception 'Não há fatura em aberto para este cartão.';
  end if;

  insert into lancamentos (familia_id, membro_id, tipo, categoria, valor, descricao, data, conta_id)
    values (
      v_familia_id, v_membro_id, 'gasto', 'fatura_cartao', v_total,
      coalesce(nullif(trim(p_descricao), ''), concat('Fatura ', v_cartao.nome)),
      current_date, v_cartao.conta_pagamento_id
    )
    returning * into v_lancamento;

  -- Só marca como paga a fatura do ciclo atual — as parcelas futuras de
  -- compras parceladas continuam em aberto, esperando o mês delas chegar.
  update lancamentos set fatura_paga = true
    where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto' and id <> v_lancamento.id
      and mes_fatura_lancamento(data, v_cartao.dia_fechamento) = v_mes_atual;

  update cartoes_credito set fatura_inicial = 0 where id = p_cartao_id;

  return v_lancamento;
end;
$$;

grant execute on function pagar_fatura_cartao(uuid, text) to authenticated;

-- Fim. Confira no Table Editor se "cartoes_credito" ganhou a coluna
-- "fatura_inicial" (numérica, padrão 0).
