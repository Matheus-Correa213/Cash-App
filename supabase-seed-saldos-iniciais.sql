-- ============================================================
-- CORREA CASH — Seed dos saldos iniciais (16/09/2026)
-- Rode este script INTEIRO no SQL Editor do SEU projeto Supabase do
-- Cash App, depois de já ter rodado as migrações 1, 2 e 3.
--
-- O que ele faz: cadastra as 5 contas/carteiras, os 2 cartões de
-- crédito, e "abre" a fatura atual de cada cartão com UM lançamento
-- de ajuste — pra você começar a usar o app HOJE com os saldos reais
-- de agora, sem precisar recriar tudo que já aconteceu este mês.
--
-- É seguro rodar mais de uma vez: cada bloco só insere se ainda não
-- existir uma conta/cartão com aquele nome na sua família.
-- ============================================================

-- 1) Contas e carteiras físicas
insert into contas (familia_id, nome, tipo, instituicao, titular, saldo_inicial, visivel_para_restrito)
select (select id from familias limit 1), v.nome, v.tipo, v.instituicao, v.titular, v.saldo, v.visivel
from (values
  ('Carteira Alessia', 'carteira', null,               'Alessia', 72.00,    true),
  ('Nubank Croma',     'corrente', 'Nubank',            'Alessia', 381.75,   true),
  ('Inter',            'corrente', 'Inter',             'Matheus', 1051.38,  false),
  ('Mercado Pago',     'corrente', 'Mercado Pago',      'Matheus', 7.96,     false),
  ('Revolut',          'corrente', 'Revolut',           'Matheus', 42.54,    false),
  ('BB',               'corrente', 'Banco do Brasil',   'Matheus', 2.99,     false),
  ('Carteira Matheus', 'carteira', null,                'Matheus', 72.00,    false)
) as v(nome, tipo, instituicao, titular, saldo, visivel)
where not exists (
  select 1 from contas c
  where c.familia_id = (select id from familias limit 1) and c.nome = v.nome
);

-- 2) Cartões de crédito
insert into cartoes_credito (familia_id, nome, bandeira, titular, limite, dia_fechamento, dia_vencimento, visivel_para_restrito)
select (select id from familias limit 1), v.nome, v.bandeira, v.titular, v.limite, v.fechamento, v.vencimento, v.visivel
from (values
  ('Nubank Platinum',    'Nubank', 'Alessia', 16400.00, 20, 28, true),
  ('Mercado Pago (Visa)', 'Visa',  'Matheus',   500.00, 29,  5, false)
) as v(nome, bandeira, titular, limite, fechamento, vencimento, visivel)
where not exists (
  select 1 from cartoes_credito k
  where k.familia_id = (select id from familias limit 1) and k.nome = v.nome
);

-- 3) Fatura atual de cada cartão — um lançamento de ajuste, datado de hoje,
--    categoria "ajuste_inicial" (não é uma das 6 frentes de gasto de
--    verdade, de propósito — assim ele não entra na estatística de "dia a
--    dia" nem nenhuma outra, e ainda aparece separado no app).
insert into lancamentos (familia_id, membro_id, tipo, categoria, valor, descricao, data, cartao_id, fatura_paga)
select
  (select id from familias limit 1),
  (select id from membros where familia_id = (select id from familias limit 1) and papel = 'dono' limit 1),
  'gasto', 'ajuste_inicial', 2784.54,
  'Saldo inicial da fatura atual (fecha dia 20/09, vence dia 28/09) — importado antes de usar o app',
  current_date,
  (select id from cartoes_credito where familia_id = (select id from familias limit 1) and nome = 'Nubank Platinum' limit 1),
  false
where not exists (
  select 1 from lancamentos l
  where l.familia_id = (select id from familias limit 1) and l.categoria = 'ajuste_inicial'
    and l.cartao_id = (select id from cartoes_credito where familia_id = (select id from familias limit 1) and nome = 'Nubank Platinum' limit 1)
);

insert into lancamentos (familia_id, membro_id, tipo, categoria, valor, descricao, data, cartao_id, fatura_paga)
select
  (select id from familias limit 1),
  (select id from membros where familia_id = (select id from familias limit 1) and papel = 'dono' limit 1),
  'gasto', 'ajuste_inicial', 491.28,
  'Saldo inicial da fatura atual (fecha dia 29/09, vence dia 05/10) — importado antes de usar o app',
  current_date,
  (select id from cartoes_credito where familia_id = (select id from familias limit 1) and nome = 'Mercado Pago (Visa)' limit 1),
  false
where not exists (
  select 1 from lancamentos l
  where l.familia_id = (select id from familias limit 1) and l.categoria = 'ajuste_inicial'
    and l.cartao_id = (select id from cartoes_credito where familia_id = (select id from familias limit 1) and nome = 'Mercado Pago (Visa)' limit 1)
);

-- Fim. Confira em Table Editor: "contas" com 7 linhas, "cartoes_credito"
-- com 2 linhas, "lancamentos" com 2 novas linhas categoria "ajuste_inicial".
