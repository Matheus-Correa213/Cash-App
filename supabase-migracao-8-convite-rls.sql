-- ============================================================
-- CORREA CASH — Migração 8: convite pendente bloqueado por RLS (16/09/2026)
-- Rode depois da migração 7.
--
-- Por quê: quando você cadastra a Alessia em Mais → Membros (email dela,
-- ainda sem user_id), e ela depois cria a conta dela mesma no app com esse
-- MESMO e-mail, o app deveria mostrar a ela a tela "Convite encontrado".
-- Só que a checagem que decide isso (AuthGate.jsx) faz uma busca comum na
-- tabela "membros" pelo navegador dela — e a política de RLS que permite ver
-- linhas de "membros" só libera quando `familia_id = minha_familia_id()`.
-- Só que `minha_familia_id()` já pressupõe que a pessoa TEM um membro
-- vinculado (`user_id = auth.uid()`) — pra alguém que acabou de criar a
-- conta e ainda não está em NENHUMA família, isso dá NULL, e
-- `familia_id = NULL` nunca é verdadeiro em SQL. Resultado: a busca não
-- encontra o convite (mesmo ele existindo!), o app conclui que não há
-- convite nenhum, e ela acaba caindo na tela "Bem-vindo, vamos criar sua
-- família" — criando uma família NOVA e separada da sua, em vez de entrar
-- na sua.
--
-- Fix: uma função no banco (SECURITY DEFINER, como as outras já existentes
-- pra esse fluxo) que só responde SIM/NÃO pra "existe um convite pendente
-- pro meu e-mail" — ela roda com privilégio total dentro do banco, então não
-- esbarra na mesma trava de RLS, mas continua super restrita (só confirma
-- se existe, não expõe nenhum dado de outras famílias).
-- ============================================================

create or replace function tenho_convite_pendente()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from membros
    where user_id is null and email is not null and lower(email) = lower(auth.email())
  );
$$;

grant execute on function tenho_convite_pendente() to authenticated;

-- Fim. Não precisa alterar nada no Table Editor — é só uma função nova.
-- ATENÇÃO: se a Alessia já criou uma conta e caiu em "criar família" por
-- causa desse bug, ela agora tem uma família própria (vazia) e um convite
-- seu ainda pendente, esperando o e-mail dela. Veja no chat as instruções
-- de como consertar isso com segurança (não precisa pedir pra ela criar
-- outra conta).
