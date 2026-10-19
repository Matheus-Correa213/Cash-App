-- ============================================================
-- CORREA CASH — Migração 18: transferências entre contas + anexos (19/10/2026)
-- Rode depois da migração 17. É aditiva e pode ser rodada mais de uma vez.
--
-- Pedidos do Matheus (19/10/2026):
--   1) "Eu preciso atualizar a forma de fazer transferência entre as contas
--      no Correa Cash, hoje não temos essa opção."
--   2) "Precisamos poder anexar PDF, fotos e tudo no Cash App, e mais de um
--      anexo de uma vez."
--
-- TRANSFERÊNCIA não é gasto nem receita: o dinheiro só muda de conta. Por isso
-- ela mora numa tabela própria (e NÃO em `lancamentos`): assim nenhum total de
-- gastos/receitas/categorias/relatórios é afetado por ela, e o saldo de cada
-- conta passa a somar o que entrou e subtrair o que saiu por transferência.
--
-- ANEXOS: o arquivo fica num bucket PRIVADO do Supabase Storage ("anexos"),
-- numa pasta por família (<familia_id>/...), e a tabela `anexos` guarda o
-- vínculo (com um lançamento, ou solto quando veio do chat/importação).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Transferências entre contas
-- ------------------------------------------------------------
create table if not exists transferencias (
  id uuid primary key default gen_random_uuid(),
  -- Os dois ids têm como padrão os de quem está logado (as políticas de RLS
  -- abaixo conferem que são mesmo os dele) — o app pode omitir os dois.
  familia_id uuid not null default minha_familia_id() references familias(id) on delete cascade,
  membro_id uuid not null default meu_membro_id() references membros(id) on delete cascade,
  -- on delete set null (e não cascade): excluir uma conta não pode apagar
  -- sozinho o histórico da outra ponta — mesmo comportamento de `lancamentos`
  -- (que ficam "sem conta associada" quando a conta é excluída).
  origem_conta_id uuid references contas(id) on delete set null,
  destino_conta_id uuid references contas(id) on delete set null,
  valor numeric(12,2) not null check (valor > 0),
  data date not null default current_date,
  descricao text,
  created_at timestamptz not null default now(),
  -- Só proíbe origem = destino; aceita null (conta excluída) sem travar a exclusão.
  check (origem_conta_id is null or destino_conta_id is null or origem_conta_id <> destino_conta_id)
);

create index if not exists idx_transferencias_familia_data on transferencias (familia_id, data desc);
create index if not exists idx_transferencias_origem on transferencias (origem_conta_id);
create index if not exists idx_transferencias_destino on transferencias (destino_conta_id);

alter table transferencias enable row level security;

-- Quem vê: o dono vê tudo da família; quem tem acesso restrito vê as próprias
-- e as que tocam uma conta que já é visível pra ela (a subconsulta em
-- "contas" já passa pelo RLS de contas, então só enxerga o que ela enxerga).
drop policy if exists "transferencias: ver" on transferencias;
create policy "transferencias: ver" on transferencias
  for select using (
    familia_id = minha_familia_id()
    and (
      meu_papel() = 'dono'
      or membro_id = meu_membro_id()
      or exists (select 1 from contas c where c.id = transferencias.origem_conta_id)
      or exists (select 1 from contas c where c.id = transferencias.destino_conta_id)
    )
  );

-- Quem cria: sempre em nome próprio, e só entre contas que a própria pessoa
-- enxerga (o dono enxerga todas; quem tem acesso restrito, só as liberadas).
drop policy if exists "transferencias: criar" on transferencias;
create policy "transferencias: criar" on transferencias
  for insert with check (
    familia_id = minha_familia_id()
    and membro_id = meu_membro_id()
    and exists (select 1 from contas c where c.id = origem_conta_id)
    and exists (select 1 from contas c where c.id = destino_conta_id)
  );

drop policy if exists "transferencias: editar" on transferencias;
create policy "transferencias: editar" on transferencias
  for update using (
    familia_id = minha_familia_id() and (meu_papel() = 'dono' or membro_id = meu_membro_id())
  ) with check (
    familia_id = minha_familia_id()
    and exists (select 1 from contas c where c.id = origem_conta_id)
    and exists (select 1 from contas c where c.id = destino_conta_id)
  );

drop policy if exists "transferencias: excluir" on transferencias;
create policy "transferencias: excluir" on transferencias
  for delete using (
    familia_id = minha_familia_id() and (meu_papel() = 'dono' or membro_id = meu_membro_id())
  );

grant select, insert, update, delete on transferencias to authenticated;

-- ------------------------------------------------------------
-- 2) saldos_contas(): agora soma o que entrou e tira o que saiu por transferência
-- (mesma assinatura de antes, então nada no app que já chama essa função quebra)
-- ------------------------------------------------------------
create or replace function saldos_contas()
returns table(conta_id uuid, saldo numeric)
language sql security definer stable
as $$
  select c.id,
    c.saldo_inicial
    + coalesce((
        select sum(case when l.tipo = 'receita' then l.valor
                        when l.tipo = 'gasto' then -l.valor
                        else 0 end)
        from lancamentos l where l.conta_id = c.id
      ), 0)
    + coalesce((select sum(t.valor) from transferencias t where t.destino_conta_id = c.id), 0)
    - coalesce((select sum(t.valor) from transferencias t where t.origem_conta_id = c.id), 0)
    as saldo
  from contas c
  where c.familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or c.visivel_para_restrito = true);
$$;

grant execute on function saldos_contas() to authenticated;

-- ------------------------------------------------------------
-- 3) resumo_familia_do_membro(): o saldo geral também considera transferências
-- (ex: mover dinheiro pra uma poupança tira da soma "sem poupança")
-- ------------------------------------------------------------
create or replace function resumo_familia_do_membro()
returns jsonb
language plpgsql security definer stable
as $$
declare
  fam_id uuid := minha_familia_id();
  papel_atual text := meu_papel();
  pode_ver boolean := coalesce((minhas_permissoes() ->> 'ver_saldo_geral')::boolean, false);
  inicio date := date_trunc('month', current_date)::date;
  total_gastos numeric := 0;
  total_receitas numeric := 0;
  saldo_real numeric := 0;
begin
  if fam_id is null then
    return jsonb_build_object('permitido', false, 'erro', 'sem familia');
  end if;
  if papel_atual <> 'dono' and not pode_ver then
    return jsonb_build_object('permitido', false);
  end if;

  select coalesce(sum(valor) filter (where tipo = 'gasto'), 0), coalesce(sum(valor) filter (where tipo = 'receita'), 0)
    into total_gastos, total_receitas
    from lancamentos
    where familia_id = fam_id and data >= inicio;

  select coalesce(sum(
    c.saldo_inicial
    + coalesce((
        select sum(case when l.tipo = 'receita' then l.valor when l.tipo = 'gasto' then -l.valor else 0 end)
        from lancamentos l where l.conta_id = c.id
      ), 0)
    + coalesce((select sum(t.valor) from transferencias t where t.destino_conta_id = c.id), 0)
    - coalesce((select sum(t.valor) from transferencias t where t.origem_conta_id = c.id), 0)
  ), 0)
  into saldo_real
  from contas c
  where c.familia_id = fam_id and c.tipo <> 'poupanca';

  return jsonb_build_object(
    'permitido', true,
    'total_gastos', total_gastos,
    'total_receitas', total_receitas,
    'saldo', saldo_real
  );
end;
$$;

grant execute on function resumo_familia_do_membro() to authenticated;

-- ------------------------------------------------------------
-- 4) Anexos (PDF, fotos, Word, planilhas... vários de uma vez)
-- ------------------------------------------------------------
create table if not exists anexos (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null default minha_familia_id() references familias(id) on delete cascade,
  membro_id uuid default meu_membro_id() references membros(id) on delete set null,
  -- Preenchido quando o arquivo é um comprovante de um lançamento; vazio
  -- quando o arquivo veio solto (chat, importação ainda não confirmada).
  lancamento_id uuid references lancamentos(id) on delete cascade,
  -- Caminho dentro do bucket "anexos": <familia_id>/<uuid>-<nome>.
  caminho text not null,
  nome text not null,
  mime_type text,
  tamanho bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_anexos_lancamento on anexos (lancamento_id);
create index if not exists idx_anexos_familia on anexos (familia_id);

alter table anexos enable row level security;

-- Ver: anexo de lançamento → quem enxerga o lançamento (a subconsulta passa
-- pelo RLS de lancamentos); anexo solto → só quem enviou (ou o dono).
drop policy if exists "anexos: ver" on anexos;
create policy "anexos: ver" on anexos
  for select using (
    familia_id = minha_familia_id()
    and (
      meu_papel() = 'dono'
      or membro_id = meu_membro_id()
      or (lancamento_id is not null and exists (select 1 from lancamentos l where l.id = anexos.lancamento_id))
    )
  );

drop policy if exists "anexos: criar" on anexos;
create policy "anexos: criar" on anexos
  for insert with check (
    familia_id = minha_familia_id()
    and membro_id = meu_membro_id()
    and (lancamento_id is null or exists (select 1 from lancamentos l where l.id = lancamento_id))
  );

drop policy if exists "anexos: excluir" on anexos;
create policy "anexos: excluir" on anexos
  for delete using (
    familia_id = minha_familia_id() and (meu_papel() = 'dono' or membro_id = meu_membro_id())
  );

grant select, insert, delete on anexos to authenticated;

-- Bucket privado (nunca público: os arquivos são comprovantes e extratos).
-- Limite de 20 MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

-- Dentro do bucket, cada família só mexe na PRÓPRIA pasta (o primeiro
-- segmento do caminho é o familia_id).
drop policy if exists "anexos storage: ver" on storage.objects;
create policy "anexos storage: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = minha_familia_id()::text);

drop policy if exists "anexos storage: enviar" on storage.objects;
create policy "anexos storage: enviar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] = minha_familia_id()::text);

drop policy if exists "anexos storage: excluir" on storage.objects;
create policy "anexos storage: excluir" on storage.objects
  for delete to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = minha_familia_id()::text);

-- ------------------------------------------------------------
-- 5) Anexos nas mensagens do chat (cada mensagem guarda a lista de arquivos
-- enviados: [{caminho, nome, mime_type, tamanho}])
-- ------------------------------------------------------------
alter table chat_mensagens add column if not exists anexos jsonb;

-- Fim da migração 18. Confira no Table Editor se apareceram as tabelas
-- "transferencias" e "anexos", e em Storage o bucket "anexos" (privado).
