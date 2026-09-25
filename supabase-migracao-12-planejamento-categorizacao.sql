-- ============================================================
-- CASH APP — Migração 12: planejamento financeiro + categorização
-- automática pelo COSMO — 25/09/2026
-- Rode este script INTEIRO no SQL Editor do SEU projeto Supabase do
-- Cash App. Só ADICIONA coisas novas (colunas com "if not exists",
-- tabela nova) — seguro rodar mesmo em cima do banco já em produção.
-- ============================================================

-- 1) Liga/desliga a categorização automática do COSMO em lançamentos novos
-- sem categoria escolhida manualmente. Fica em "familias" (é uma preferência
-- da família toda, não de uma pessoa só) — só o dono edita (mesma regra que
-- já vale pra qualquer outro campo de "familias", ver policy "familia: dono
-- pode atualizar").
alter table familias add column if not exists categorizacao_automatica boolean not null default true;

-- 2) planejamento_itens — "lembrete de boletos" pedido pelo Matheus: contas
-- que a família espera pagar (fixas ou de valor variável, recorrentes todo
-- mês ou de um mês específico), com dia de vencimento. Não guarda "pago/não
-- pago" — isso é calculado na hora, batendo a categoria do item contra os
-- lançamentos reais daquele mês (ver comentário em Planejamento.jsx): se já
-- existe um gasto lançado naquela categoria naquele mês, o item aparece como
-- pago, com o valor real; sem isso, fica em aberto. Evita ter duas fontes de
-- verdade (um "pago" manual que podia dessincronizar do lançamento de
-- verdade).
create table if not exists planejamento_itens (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  nome text not null,
  -- Chave de uma frente de gasto (fixa ou personalizada) — é o campo usado
  -- pra casar com lancamentos.categoria na hora de saber se já foi pago.
  categoria text not null,
  tipo_valor text not null default 'fixo' check (tipo_valor in ('fixo', 'variavel')),
  -- Só usado quando tipo_valor = 'fixo' — o valor esperado (ex: aluguel,
  -- assinatura). Quando 'variavel' (ex: água, luz), fica null: o valor real
  -- só aparece quando o lançamento correspondente é feito.
  valor_fixo numeric(12,2),
  dia_vencimento smallint check (dia_vencimento between 1 and 31),
  recorrente boolean not null default true,
  -- Só usado quando recorrente = false: em qual mês (primeiro dia do mês,
  -- ex: '2026-10-01') esse item específico aparece no planejamento.
  mes_especifico date,
  created_at timestamptz not null default now()
);

alter table planejamento_itens enable row level security;

-- Mesma filosofia das migrações 9/10 ("editar tudo"): planejamento é coisa
-- do casal, os dois criam/editam/excluem sem distinção de papel.
create policy "planejamento: familia ve e mexe" on planejamento_itens
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on planejamento_itens to authenticated;

-- Nota: EDITAR lançamentos (valor, categoria, conta/cartão) já funcionava
-- sem nenhuma mudança de banco — a policy "lancamentos: dono edita tudo,
-- membro edita so o proprio" (migração original) já permite atualizar
-- qualquer coluna, não só criar/excluir. A novidade desta leva é só a TELA
-- que faltava pra usar isso.

-- Fim da migração 12. Depois de rodar, confira em Table Editor: "familias"
-- ganhou a coluna categorizacao_automatica, e a tabela nova
-- "planejamento_itens" aparece com o cadeado de RLS ativo.
