-- ============================================================
-- CORREA CASH — Migração 17: mês do vencimento no Planejamento (02/10/2026)
-- Rode depois da migração 16.
--
-- Pedido do Matheus: "tem item que venceu em outro mês" — ao editar um item do
-- Planejamento, além do DIA do vencimento, poder escolher o MÊS (o mês que está
-- em edição é o padrão, mas dá pra trocar por um mês anterior). Item com
-- vencimento num mês anterior aparece como VENCIDO e sobe como prioridade de
-- pagamento (tela e COSMO).
--
-- Vale só pro mês em que o item aparece (um valor por item por mês, igual ao
-- valor específico do mês da migração 15): a conta de outubro que venceu em
-- 28/09 não muda a conta de novembro.
-- ============================================================

create table if not exists planejamento_vencimentos_mes (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  -- Excluir o item do planejamento apaga também os vencimentos de mês dele.
  item_id uuid not null references planejamento_itens(id) on delete cascade,
  -- Primeiro dia do mês em que o item aparece no planejamento (ex: '2026-10-01').
  mes date not null,
  -- A data de vencimento de verdade (ex: '2026-09-28'), de outro mês.
  vencimento date not null,
  created_at timestamptz not null default now(),
  unique (item_id, mes)
);

alter table planejamento_vencimentos_mes enable row level security;

drop policy if exists "planejamento vencimentos mes: familia ve e mexe" on planejamento_vencimentos_mes;
create policy "planejamento vencimentos mes: familia ve e mexe" on planejamento_vencimentos_mes
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on planejamento_vencimentos_mes to authenticated;

-- Fim da migração 17. Confira no Table Editor se apareceu a tabela
-- "planejamento_vencimentos_mes".
