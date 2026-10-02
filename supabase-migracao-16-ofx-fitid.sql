-- ============================================================
-- CASH APP — Migração 16: importar fatura do cartão por OFX — 02/10/2026
-- Rode este script INTEIRO no SQL Editor do SEU projeto Supabase do
-- Cash App. Só ADICIONA uma coluna e um índice ("if not exists") — seguro
-- rodar em cima do banco em produção, e não mexe em nenhum dado.
-- ============================================================

-- Por que existe: o arquivo OFX do banco dá a cada transação um código único
-- (FITID). Guardando esse código no lançamento, importar o MESMO arquivo (ou um
-- arquivo novo que repita compras antigas) nunca duplica nada — o app reconhece
-- "essa compra já veio do banco". Lançamentos feitos à mão têm a coluna vazia.
alter table lancamentos add column if not exists ofx_fitid text;

-- Um FITID só pode existir uma vez por cartão (o índice é parcial: só vale
-- onde o código existe, então lançamentos sem OFX não são afetados).
create unique index if not exists idx_lancamentos_cartao_ofx_fitid
  on lancamentos (cartao_id, ofx_fitid)
  where ofx_fitid is not null;

-- Fim da migração 16. Nenhuma política nova: quem já lança/edita lançamentos
-- continua com o mesmo acesso.
