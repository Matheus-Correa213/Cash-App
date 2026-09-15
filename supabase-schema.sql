-- ============================================================
-- CASH APP — Schema do Supabase (Correa Tech)
-- Rode este script INTEIRO, de uma vez, no SQL Editor do seu
-- projeto Supabase NOVO do Cash App (não é o projeto do COSMO).
-- ============================================================

-- 1) Família: o "dono" da informação financeira em conjunto (você e a Alessia).
create table if not exists familias (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'Minha Família',
  dono_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2) Membros: liga cada login (auth.users) a uma família, com um papel.
--    user_id começa NULO quando você cadastra um convite pelo e-mail da pessoa
--    antes dela ter criado a conta — ver a política "reivindicar convite" abaixo.
create table if not exists membros (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  nome text not null,
  papel text not null check (papel in ('dono', 'restrito')),
  mesada_mensal numeric(12,2) default 0,
  permissoes jsonb not null default '{"ver_saldo_geral": false, "ver_gastos_dono": false, "ver_resumo_categorias": false}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id)
);

-- 3) Lançamentos: os gastos e receitas de verdade, sempre ligados à família.
create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  membro_id uuid not null references membros(id) on delete cascade,
  tipo text not null check (tipo in ('gasto', 'receita')),
  categoria text not null default 'outros',
  valor numeric(12,2) not null,
  descricao text,
  data date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_lancamentos_familia on lancamentos (familia_id);
create index if not exists idx_lancamentos_data on lancamentos (data);

-- ------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER)
-- Por que existem: se as políticas de RLS da tabela "membros" fizessem uma
-- consulta direta em "membros" pra saber seu papel, o Postgres entraria numa
-- recursão (a política precisa ler a tabela que ela mesma protege). Estas
-- funções rodam com um "selo" que ignora RLS só pra achar UM dado (seu
-- próprio registro), e são usadas DENTRO das políticas — sem recursão.
-- ------------------------------------------------------------
create or replace function minha_familia_id()
returns uuid
language sql security definer stable
as $$
  select familia_id from membros where user_id = auth.uid() limit 1;
$$;

create or replace function meu_papel()
returns text
language sql security definer stable
as $$
  select papel from membros where user_id = auth.uid() limit 1;
$$;

create or replace function meu_membro_id()
returns uuid
language sql security definer stable
as $$
  select id from membros where user_id = auth.uid() limit 1;
$$;

create or replace function minhas_permissoes()
returns jsonb
language sql security definer stable
as $$
  select permissoes from membros where user_id = auth.uid() limit 1;
$$;

-- ------------------------------------------------------------
-- Ativar RLS (Row Level Security) — sem isso, qualquer pessoa logada
-- conseguiria ler/editar os dados de qualquer família.
-- ------------------------------------------------------------
alter table familias enable row level security;
alter table membros enable row level security;
alter table lancamentos enable row level security;

-- Políticas: familias
create policy "familia: membros da familia podem ver" on familias
  for select using (id = minha_familia_id());

create policy "familia: dono pode criar a propria familia" on familias
  for insert with check (dono_user_id = auth.uid());

create policy "familia: dono pode atualizar" on familias
  for update using (dono_user_id = auth.uid());

-- Políticas: membros
create policy "membros: qualquer um da familia ve os membros da familia" on membros
  for select using (familia_id = minha_familia_id());

create policy "membros: dono pode convidar/adicionar" on membros
  for insert with check (meu_papel() = 'dono' and familia_id = minha_familia_id());

create policy "membros: dono pode editar (papel, mesada, permissoes)" on membros
  for update using (meu_papel() = 'dono' and familia_id = minha_familia_id());

create policy "membros: dono pode remover" on membros
  for delete using (meu_papel() = 'dono' and familia_id = minha_familia_id());

-- Política especial: permite que a PESSOA CONVIDADA (ainda sem user_id
-- preenchido) se auto-vincule ao criar a conta com o MESMO e-mail que o
-- dono cadastrou no convite. Sem isso, só o dono poderia preencher esse
-- vínculo, e ele não tem como saber o UUID da conta dela de antemão.
create policy "membros: reivindicar convite pelo proprio email" on membros
  for update using (user_id is null and email is not null and lower(email) = lower(auth.email()))
  with check (user_id = auth.uid());

-- Políticas: lancamentos
create policy "lancamentos: dono ve tudo, membro ve o proprio (+ o que a permissao liberar)" on lancamentos
  for select using (
    familia_id = minha_familia_id()
    and (
      meu_papel() = 'dono'
      or membro_id = meu_membro_id()
      or coalesce((minhas_permissoes() ->> 'ver_gastos_dono')::boolean, false) = true
    )
  );

create policy "lancamentos: dono lanca por qualquer um, membro so o proprio" on lancamentos
  for insert with check (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or membro_id = meu_membro_id())
  );

create policy "lancamentos: dono edita tudo, membro edita so o proprio" on lancamentos
  for update using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or membro_id = meu_membro_id())
  );

create policy "lancamentos: dono exclui tudo, membro exclui so o proprio" on lancamentos
  for delete using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or membro_id = meu_membro_id())
  );

-- ------------------------------------------------------------
-- Funções de RESUMO (respeitam a permissão "ver_saldo_geral" /
-- "ver_resumo_categorias" sem nunca expor os lançamentos individuais do
-- dono pra quem só tem acesso restrito). São SECURITY DEFINER de propósito:
-- conseguem olhar todos os lançamentos da família, mas só devolvem números
-- agregados (somas), e só se a permissão do membro que está chamando permitir.
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
  return jsonb_build_object(
    'permitido', true,
    'total_gastos', total_gastos,
    'total_receitas', total_receitas,
    'saldo', total_receitas - total_gastos
  );
end;
$$;

create or replace function resumo_categorias_do_membro()
returns jsonb
language plpgsql security definer stable
as $$
declare
  fam_id uuid := minha_familia_id();
  papel_atual text := meu_papel();
  pode_ver boolean := coalesce((minhas_permissoes() ->> 'ver_resumo_categorias')::boolean, false);
  inicio date := date_trunc('month', current_date)::date;
  resultado jsonb;
begin
  if fam_id is null or (papel_atual <> 'dono' and not pode_ver) then
    return jsonb_build_object('permitido', false);
  end if;
  select coalesce(jsonb_object_agg(categoria, total), '{}'::jsonb) into resultado
  from (
    select categoria, sum(valor) as total
    from lancamentos
    where familia_id = fam_id and tipo = 'gasto' and data >= inicio
    group by categoria
  ) t;
  return jsonb_build_object('permitido', true, 'categorias', resultado);
end;
$$;

grant execute on function minha_familia_id() to authenticated;
grant execute on function meu_papel() to authenticated;
grant execute on function meu_membro_id() to authenticated;
grant execute on function minhas_permissoes() to authenticated;
grant execute on function resumo_familia_do_membro() to authenticated;
grant execute on function resumo_categorias_do_membro() to authenticated;

-- Fim do script. Depois de rodar, confira em Table Editor se as 3 tabelas
-- (familias, membros, lancamentos) aparecem, cada uma com o cadeado de RLS
-- ativado (ícone ao lado do nome da tabela).
