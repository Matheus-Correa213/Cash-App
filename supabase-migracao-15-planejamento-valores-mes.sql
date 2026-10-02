-- ============================================================
-- CASH APP — Migração 15: valor de cada mês nos itens do planejamento
-- — 02/10/2026
-- Rode este script INTEIRO no SQL Editor do SEU projeto Supabase do
-- Cash App. Só ADICIONA uma tabela nova ("if not exists") — seguro rodar
-- mesmo em cima do banco já em produção, e não mexe em nenhum dado.
-- ============================================================

-- Por que existe: boletos variáveis (água, luz, internet) mudam de mês pra
-- mês, mas no mês que está sendo planejado a pessoa muitas vezes JÁ SABE o
-- valor. Agora cada item tem dois níveis de valor:
--   1) o valor "padrão" do item (planejamento_itens.valor_fixo): pra item
--      fixo é o valor de sempre; pra item variável é um valor APROXIMADO
--      (arredondado), usado nos meses em que ainda não se sabe o real;
--   2) o valor ESPECÍFICO de um mês, nesta tabela. Se existe uma linha pro
--      (item, mês), ela manda naquele mês; se não existe, vale o padrão.
-- Mudar o valor de outubro não mexe em novembro.
--
-- Isto é o valor PLANEJADO do mês. O valor efetivamente PAGO continua
-- separado, em planejamento_pagamentos.valor_pago (migração 14), e é
-- confirmado na hora de marcar como pago.
create table if not exists planejamento_valores_mes (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  -- Excluir o item do planejamento apaga também os valores de mês dele.
  item_id uuid not null references planejamento_itens(id) on delete cascade,
  -- Primeiro dia do mês (ex: '2026-10-01').
  mes date not null,
  valor numeric(12,2) not null check (valor >= 0),
  created_at timestamptz not null default now(),
  -- Um valor por item por mês.
  unique (item_id, mes)
);

alter table planejamento_valores_mes enable row level security;

-- Mesma filosofia do resto do planejamento: coisa do casal, os dois mexem
-- sem distinção de papel.
create policy "planejamento valores mes: familia ve e mexe" on planejamento_valores_mes
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on planejamento_valores_mes to authenticated;

-- Fim da migração 15. Depois de rodar, confira em Table Editor: aparece a
-- tabela nova "planejamento_valores_mes" com o cadeado de RLS ativo.
