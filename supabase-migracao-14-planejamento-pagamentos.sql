-- ============================================================
-- CASH APP — Migração 14: "pago" do planejamento vira marcação manual
-- por item e por mês — 02/10/2026
-- Rode este script INTEIRO no SQL Editor do SEU projeto Supabase do
-- Cash App. Só ADICIONA uma tabela nova ("if not exists") — seguro rodar
-- mesmo em cima do banco já em produção, e não mexe em nenhum dado.
-- ============================================================

-- Por que existe: na migração 12 o "pago" não era gravado, era deduzido
-- batendo categoria + mês contra os lançamentos. Só que vários itens do
-- planejamento podem usar a MESMA categoria (ex: "Boletos Recorrentes" com
-- Parcela do Empréstimo, Parcela do Cartão, Internet...) — um único
-- lançamento nessa categoria marcava todos como pagos, com o mesmo valor.
-- Agora o "pago" é uma marcação feita na própria lista do planejamento,
-- separada do lançamento, uma linha por (item, mês).
--
-- Uma linha aqui = "este item foi pago neste mês". Sem linha = em aberto.
-- Recorrente funciona sozinho: o mesmo item pode estar pago em outubro e em
-- aberto em novembro, porque cada mês é uma linha separada.
create table if not exists planejamento_pagamentos (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  -- Excluir o item do planejamento apaga também o histórico de "pago" dele.
  item_id uuid not null references planejamento_itens(id) on delete cascade,
  -- Primeiro dia do mês pago (ex: '2026-10-01').
  mes date not null,
  -- Valor que valeu naquele mês: pra item fixo, o valor_fixo no momento da
  -- marcação (editar o valor do item depois não reescreve o passado); pra
  -- item variável (água, luz), o valor que a pessoa informou ao marcar.
  valor_pago numeric(12,2) not null check (valor_pago >= 0),
  created_at timestamptz not null default now(),
  -- Garante uma marcação por item por mês (marcar duas vezes não duplica).
  unique (item_id, mes)
);

alter table planejamento_pagamentos enable row level security;

-- Mesma filosofia do planejamento: coisa do casal, os dois marcam e
-- desmarcam sem distinção de papel.
create policy "planejamento pagamentos: familia ve e mexe" on planejamento_pagamentos
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on planejamento_pagamentos to authenticated;

-- Fim da migração 14. Depois de rodar, confira em Table Editor: aparece a
-- tabela nova "planejamento_pagamentos" com o cadeado de RLS ativo. Os itens
-- que antes apareciam como "pago" por causa de um lançamento na mesma
-- categoria voltam a aparecer em aberto — é só marcar de novo, um por um.
