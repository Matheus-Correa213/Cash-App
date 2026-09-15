-- ============================================================
-- CORREA CASH — Migração 4: personalização (16/09/2026)
-- Rode depois das migrações 1, 2 e 3.
--
-- O que ela faz: adiciona UMA coluna nova, pra guardar quais widgets cada
-- pessoa escolheu deixar no painel dela, e em que ordem. Não mexe em RLS
-- nem em nenhuma tabela existente — as políticas que já existem pra
-- "membros" (o dono pode editar qualquer linha da própria família,
-- incluindo a dele mesmo) e pra "contas"/"cartoes_credito" (o dono
-- pode ver e mexer em tudo) já cobrem tudo que essa rodada precisa.
-- ============================================================

alter table membros add column if not exists preferencias_painel jsonb;

-- Fim. Nada pra conferir manualmente — a coluna começa nula (null) pra quem
-- já existe, e o app já trata "nulo" como "mostrar os widgets padrão", então
-- ninguém perde nada até entrar em Painel → engrenagem → Personalizar.
