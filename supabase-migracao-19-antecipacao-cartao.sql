-- Migração 19 (20/10/2026): pagamento antecipado / estorno no cartão de crédito.
-- Modelo: linha NEGATIVA no cartão (categoria 'fatura_cartao', valor < 0) que reduz fatura e libera limite;
-- opcionalmente uma linha de saída na conta (mesmo antecipacao_id) quando o dinheiro saiu de uma conta.
-- Já aplicada em produção.

alter table lancamentos add column if not exists antecipacao_id uuid;
create index if not exists lancamentos_antecipacao_idx on lancamentos (antecipacao_id) where antecipacao_id is not null;

create or replace function public.antecipar_pagamento_cartao(p_cartao_id uuid, p_valor numeric, p_conta_id uuid default null, p_data date default current_date, p_descricao text default null, p_estorno boolean default false)
 returns lancamentos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_familia_id uuid := minha_familia_id();
  v_membro_id uuid := meu_membro_id();
  v_cartao cartoes_credito;
  v_valor numeric := round(coalesce(p_valor, 0), 2);
  v_devido numeric;
  v_antecipacao uuid := gen_random_uuid();
  v_credito lancamentos;
  v_conta uuid := case when p_estorno then null else p_conta_id end;
  v_data date := coalesce(p_data, current_date);
begin
  if v_uid is null then raise exception 'Não autenticado.'; end if;
  if meu_papel() <> 'dono' then raise exception 'Só o administrador pode lançar pagamento ou estorno no cartão.'; end if;
  if v_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;

  select * into v_cartao from cartoes_credito where id = p_cartao_id and familia_id = v_familia_id;
  if v_cartao.id is null then raise exception 'Cartão não encontrado.'; end if;
  if v_conta is not null and not exists (select 1 from contas where id = v_conta and familia_id = v_familia_id) then
    raise exception 'Conta não encontrada.';
  end if;

  select coalesce(v_cartao.fatura_inicial, 0) + coalesce(sum(valor), 0) into v_devido
    from lancamentos
    where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto';
  if v_valor > v_devido then
    raise exception 'O cartão deve R$ % em aberto — o valor passa disso.', to_char(greatest(v_devido, 0), 'FM999999990.00');
  end if;

  insert into lancamentos (familia_id, membro_id, tipo, categoria, valor, descricao, data, cartao_id, antecipacao_id)
    values (
      v_familia_id, v_membro_id, 'gasto', 'fatura_cartao', -v_valor,
      coalesce(nullif(trim(p_descricao), ''), case when p_estorno then 'Estorno / reembolso' else 'Pagamento antecipado' end),
      v_data, p_cartao_id, v_antecipacao
    )
    returning * into v_credito;

  if v_conta is not null then
    insert into lancamentos (familia_id, membro_id, tipo, categoria, valor, descricao, data, conta_id, antecipacao_id)
      values (
        v_familia_id, v_membro_id, 'gasto', 'fatura_cartao', v_valor,
        concat('Antecipação de fatura ', v_cartao.nome), v_data, v_conta, v_antecipacao
      );
  end if;

  return v_credito;
end;
$function$;
