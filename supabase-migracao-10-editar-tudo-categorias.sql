-- Migração 10 — "editar tudo" + categorias personalizadas — 16/09/2026
--
-- Dois pedidos do Matheus na mesma rodada:
--
-- 1) Testando como a Alessia (acesso restrito) numa aba anônima, ele tentou
--    corrigir o titular de um cartão pelo chat e recebeu "0 linhas
--    afetadas" — isso não era bug, era a regra "só o dono mexe em
--    contas/cartões" (RLS) fazendo exatamente o que fazia antes. Decisão
--    dele: quer que os DOIS (dono e restrito) possam editar (e criar e
--    excluir) contas e cartões, sem distinção — tanto pela tela quanto pelo
--    chat. A VISIBILIDADE continua igual (visivel_para_restrito ainda
--    decide o que ela enxerga) — o que muda é que, pro que ela já enxerga,
--    ela agora também pode mexer.
--
-- 2) "Criar categorias, isso é essencial, temos categorias limitadas" — as
--    6 frentes de gasto e 4 fontes de receita da doutrina financeira do
--    COSMO (theme.js) continuam fixas (é o vocabulário oficial dos apps do
--    Correa Tech) — o que esta migração adiciona é uma tabela nova pra
--    CATEGORIAS EXTRAS, criadas pela própria família, com nome + cor +
--    ícone escolhidos numa tela própria (Categorias.jsx) — aparecem
--    somadas às fixas em todo lugar que usa categoria (Gastos, Receitas,
--    Novo lançamento, Importar, chat do COSMO).
-- ============================================================

-- ------------------------------------------------------------
-- 1) contas / cartoes_credito — editar sem distinção de papel
-- ------------------------------------------------------------
drop policy if exists "contas: dono ve e mexe em tudo" on contas;
drop policy if exists "contas: membro ve as marcadas como visiveis" on contas;

-- Continua havendo uma diferença: quem tem acesso restrito só vê (e só
-- edita/exclui) as contas já marcadas como visíveis pra ela
-- (visivel_para_restrito) — isso não mudou. O que mudou é que, antes, ela
-- só tinha permissão de SELECT; agora tem INSERT/UPDATE/DELETE também,
-- igual ao dono, dentro do que ela já enxerga.
create policy "contas: familia ve conforme visibilidade" on contas
  for select using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "contas: familia pode criar" on contas
  for insert with check (familia_id = minha_familia_id());

create policy "contas: familia pode editar conforme visibilidade" on contas
  for update using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "contas: familia pode excluir conforme visibilidade" on contas
  for delete using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

drop policy if exists "cartoes: dono ve e mexe em tudo" on cartoes_credito;
drop policy if exists "cartoes: membro ve os marcados como visiveis" on cartoes_credito;

create policy "cartoes: familia ve conforme visibilidade" on cartoes_credito
  for select using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "cartoes: familia pode criar" on cartoes_credito
  for insert with check (familia_id = minha_familia_id());

create policy "cartoes: familia pode editar conforme visibilidade" on cartoes_credito
  for update using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "cartoes: familia pode excluir conforme visibilidade" on cartoes_credito
  for delete using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

-- Nota: "Pagar fatura atual" continua só do dono — isso é uma ação de
-- movimentar dinheiro (RPC pagar_fatura_cartao já recusa quem não é dono,
-- ver supabase-migracao-6-fatura-inicial.sql), diferente de editar o
-- CADASTRO da conta/cartão, que é o que o Matheus pediu pra abrir aqui.

-- ------------------------------------------------------------
-- 2) categorias personalizadas
-- ------------------------------------------------------------
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  tipo text not null check (tipo in ('gasto', 'receita')),
  chave text not null,
  label text not null,
  cor text not null default '#0469FB',
  cor_soft text not null default '#E7F0FE',
  icone text not null default 'estrela',
  created_at timestamptz not null default now(),
  unique (familia_id, tipo, chave)
);

alter table categorias enable row level security;

drop policy if exists "categorias: familia ve e mexe" on categorias;
create policy "categorias: familia ve e mexe" on categorias
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on categorias to authenticated;
