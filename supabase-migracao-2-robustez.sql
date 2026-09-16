-- ============================================================
-- CORREA CASH — Migração 2: robustez (contas, cartões, investimentos)
-- Rode este script INTEIRO no SQL Editor do projeto Supabase do
-- Correa Cash. É incremental — NÃO rode o supabase-schema.sql de novo,
-- ele já existe no seu banco e daria erro de "já existe".
-- ============================================================

-- 4) Contas: onde o dinheiro efetivamente mora (corrente, poupança, carteira...).
-- Um lançamento agora pode dizer DE QUAL conta saiu ou para qual conta entrou,
-- em vez de só ter uma categoria solta.
create table if not exists contas (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  nome text not null,
  tipo text not null default 'corrente' check (tipo in ('corrente', 'poupanca', 'carteira', 'outro')),
  instituicao text,
  saldo_inicial numeric(12,2) not null default 0,
  visivel_para_restrito boolean not null default false,
  created_at timestamptz not null default now()
);

-- 5) Cartões de crédito: o gasto no cartão não desconta a conta na hora — ele
-- se acumula como "fatura em aberto" até o dono marcar como paga (função
-- pagar_fatura_cartao mais abaixo), que aí sim gera UM lançamento na conta
-- que paga a fatura. Isso evita contar o mesmo dinheiro duas vezes.
create table if not exists cartoes_credito (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  conta_pagamento_id uuid references contas(id) on delete set null,
  nome text not null,
  bandeira text,
  limite numeric(12,2),
  dia_fechamento smallint check (dia_fechamento between 1 and 31),
  dia_vencimento smallint check (dia_vencimento between 1 and 31),
  visivel_para_restrito boolean not null default false,
  created_at timestamptz not null default now()
);

-- 6) Investimentos — visão de patrimônio. Só o dono mexe aqui (ver política
-- abaixo) — planejamento financeiro de fundo continua sendo decisão dele,
-- igual já foi combinado para o resto do Correa Cash.
create table if not exists investimentos (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('renda_fixa', 'renda_variavel')),
  subtipo text,
  instituicao text,
  objetivo text check (objetivo in ('curto', 'medio', 'longo')),
  valor_aportado numeric(12,2) not null default 0,
  valor_atual numeric(12,2) not null default 0,
  data_aporte date not null default current_date,
  created_at timestamptz not null default now()
);

-- lancamentos ganha: de qual conta saiu/entrou, se foi feito no cartão, uma
-- tag livre por projeto (ex: "Casamento" — mesmo princípio do MEGA-DOSSIE-
-- COSMO-FINANCEIRO.md, tag solta além da categoria fixa), e um sinalizador
-- de fatura já paga (pra pagar_fatura_cartao não contar o mesmo gasto 2x).
alter table lancamentos add column if not exists conta_id uuid references contas(id) on delete set null;
alter table lancamentos add column if not exists cartao_id uuid references cartoes_credito(id) on delete set null;
alter table lancamentos add column if not exists tag text;
alter table lancamentos add column if not exists fatura_paga boolean not null default false;

create index if not exists idx_lancamentos_conta on lancamentos (conta_id);
create index if not exists idx_lancamentos_cartao on lancamentos (cartao_id);
create index if not exists idx_lancamentos_tag on lancamentos (tag);

alter table contas enable row level security;
alter table cartoes_credito enable row level security;
alter table investimentos enable row level security;

-- Políticas: contas — o dono mexe em tudo; o membro restrito só ENXERGA as
-- contas que o dono marcou como visíveis (precisa ver o nome pra escolher de
-- onde saiu o gasto dela quando lançar, mas não a lista toda nem o saldo).
--
-- Correção 16/09/2026: "create policy" NÃO aceita "if not exists" (diferente
-- de "create table"/"alter table add column") — rodar este script uma
-- segunda vez batia em "policy already exists" e abortava o resto do script
-- no meio. Agora cada política tem um "drop policy if exists" na frente, o
-- que a torna de fato segura de rodar de novo quantas vezes precisar.
drop policy if exists "contas: dono ve e mexe em tudo" on contas;
create policy "contas: dono ve e mexe em tudo" on contas
  for all using (familia_id = minha_familia_id() and meu_papel() = 'dono')
  with check (familia_id = minha_familia_id() and meu_papel() = 'dono');

drop policy if exists "contas: membro ve as marcadas como visiveis" on contas;
create policy "contas: membro ve as marcadas como visiveis" on contas
  for select using (familia_id = minha_familia_id() and visivel_para_restrito = true);

-- Políticas: cartões — mesmo princípio das contas.
drop policy if exists "cartoes: dono ve e mexe em tudo" on cartoes_credito;
create policy "cartoes: dono ve e mexe em tudo" on cartoes_credito
  for all using (familia_id = minha_familia_id() and meu_papel() = 'dono')
  with check (familia_id = minha_familia_id() and meu_papel() = 'dono');

drop policy if exists "cartoes: membro ve os marcados como visiveis" on cartoes_credito;
create policy "cartoes: membro ve os marcados como visiveis" on cartoes_credito
  for select using (familia_id = minha_familia_id() and visivel_para_restrito = true);

-- Políticas: investimentos — só o dono, sem exceção.
drop policy if exists "investimentos: so o dono ve e mexe" on investimentos;
create policy "investimentos: so o dono ve e mexe" on investimentos
  for all using (familia_id = minha_familia_id() and meu_papel() = 'dono')
  with check (familia_id = minha_familia_id() and meu_papel() = 'dono');

-- ------------------------------------------------------------
-- Saldo de cada conta = saldo inicial + todas as receitas com essa conta
-- - todos os gastos com essa conta. SECURITY DEFINER pra somar TODOS os
-- lançamentos históricos da conta (não só os últimos que o app carregou na
-- tela), mas só devolve algo quando quem chama é o dono.
-- ------------------------------------------------------------
create or replace function saldos_contas()
returns table(conta_id uuid, saldo numeric)
language sql security definer stable
as $$
  select c.id, c.saldo_inicial + coalesce(sum(
    case when l.tipo = 'receita' then l.valor
         when l.tipo = 'gasto' then -l.valor
         else 0 end
  ), 0) as saldo
  from contas c
  left join lancamentos l on l.conta_id = c.id
  where c.familia_id = minha_familia_id() and meu_papel() = 'dono'
  group by c.id, c.saldo_inicial;
$$;

-- ------------------------------------------------------------
-- Pagar a fatura de um cartão: soma tudo que ainda não foi pago, cria UM
-- lançamento de gasto na conta que paga a fatura, e marca os lançamentos
-- originais do cartão como "fatura_paga" pra não entrarem na conta soma de
-- novo no mês seguinte. Tudo como UMA operação atômica (mesmo motivo do
-- criar_minha_familia/reivindicar_convite: nunca deixar o trabalho pela
-- metade, e nunca confiar em valor calculado no navegador).
-- ------------------------------------------------------------
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

  select coalesce(sum(valor), 0) into v_total
    from lancamentos
    where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto';

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

  update lancamentos set fatura_paga = true
    where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto' and id <> v_lancamento.id;

  return v_lancamento;
end;
$$;

grant execute on function saldos_contas() to authenticated;
grant execute on function pagar_fatura_cartao(uuid, text) to authenticated;

-- Fim da migração. Confira em Table Editor se "contas", "cartoes_credito" e
-- "investimentos" apareceram, todas com o cadeado de RLS ativado.
