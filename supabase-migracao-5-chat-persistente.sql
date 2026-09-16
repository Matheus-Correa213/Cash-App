-- ============================================================
-- CORREA CASH — Migração 5: chat do COSMO persistente (16/09/2026)
-- Rode depois das migrações 1, 2, 3 e 4.
--
-- Por quê: até agora, a conversa com o COSMO só existia na memória da
-- tela (React) enquanto você não saía dela — ao voltar pro Painel e abrir o
-- chat de novo, tudo sumia e começava do zero. Essa migração cria uma
-- tabela pra guardar cada mensagem (sua e do COSMO) e o estado de cada
-- proposta (pendente/confirmada), pra a conversa sobreviver a sair e voltar
-- da tela, fechar o app, ou trocar de aparelho.
--
-- Cada pessoa só vê a PRÓPRIA conversa com o COSMO — não é um chat da
-- família, é individual (a Alessia e você têm históricos separados).
-- ============================================================

create table if not exists chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  membro_id uuid not null references membros(id) on delete cascade,
  autor text not null check (autor in ('usuario', 'cosmo')),
  texto text,
  propostas jsonb,        -- array de { natureza, dados } — null pra mensagens do usuário
  confirmadas jsonb,       -- array paralelo de booleans (uma por proposta)
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_mensagens_membro on chat_mensagens (membro_id, created_at);

alter table chat_mensagens enable row level security;

drop policy if exists "chat: cada um ve e mexe so na propria conversa" on chat_mensagens;
create policy "chat: cada um ve e mexe so na propria conversa" on chat_mensagens
  for all using (membro_id = meu_membro_id())
  with check (membro_id = meu_membro_id());

grant select, insert, update, delete on chat_mensagens to authenticated;

-- Fim. Nada pra migrar de conversas antigas — elas só existiam na tela e já
-- se perderam antes desta correção; a partir de agora, toda mensagem nova
-- fica salva. Confira em Table Editor se "chat_mensagens" apareceu com o
-- cadeado de RLS ativo.
