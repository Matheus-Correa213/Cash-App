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
  -- Migração 12 (25/09/2026) — liga/desliga o COSMO sugerindo categoria
  -- sozinho em lançamentos novos sem categoria escolhida manualmente.
  categorizacao_automatica boolean not null default true,
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
  preferencias_painel jsonb,
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
-- resumo_familia_do_membro() — CORRIGIDO na migração 9 (unificação do acesso
-- da Alessia, 16/09/2026): o "saldo" devolvido aqui usava receitas-gastos do
-- MÊS (fluxo de caixa), a mesma fórmula já corrigida no Painel do dono numa
-- versão anterior — por isso o "saldo geral" que um membro restrito via
-- nunca batia com o do dono. Agora usa o saldo REAL de todas as contas da
-- família (mesma lógica de saldos_contas(), somada por cima de TODAS as
-- contas, não só as visíveis pra ela — só chega até aqui quem já tem
-- permissão "ver_saldo_geral", então ver o número agregado é esperado, sem
-- expor o detalhe de cada conta escondida). Ver migração 9 para mais.
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
    c.saldo_inicial + coalesce((
      select sum(case when l.tipo = 'receita' then l.valor when l.tipo = 'gasto' then -l.valor else 0 end)
      from lancamentos l where l.conta_id = c.id
    ), 0)
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

-- ------------------------------------------------------------
-- Funções de ONBOARDING (correção 15/09/2026) — criar a família e reivindicar
-- um convite, como UMA operação atômica cada, rodando no servidor com
-- auth.uid() calculado ali mesmo (nunca o que o navegador manda). Antes, essas
-- duas ações eram feitas como insert/update direto do navegador contra as
-- políticas de RLS, e davam "new row violates row-level security policy" logo
-- depois do primeiro login — exatamente o momento mais frágil (o usuário
-- ainda não tem NENHUMA linha em "membros", que é o que as outras funções
-- auxiliares acima (minha_familia_id, meu_papel...) precisam pra funcionar).
-- Rodando como função seguem o mesmo princípio de segurança do restante do
-- schema: SECURITY DEFINER só pra poder escrever, mas com a checagem de
-- identidade (auth.uid()) feita dentro da própria função, não confiada ao
-- que foi enviado pelo cliente.
-- ------------------------------------------------------------
create or replace function criar_minha_familia(p_nome text)
returns membros
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_familia_id uuid;
  v_membro membros;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if exists (select 1 from membros where user_id = v_uid) then
    raise exception 'Você já faz parte de uma família no Cash App.';
  end if;
  insert into familias (nome, dono_user_id)
    values (concat('Família ', coalesce(nullif(trim(p_nome), ''), 'Corrêa')), v_uid)
    returning id into v_familia_id;
  insert into membros (familia_id, user_id, email, nome, papel, permissoes)
    values (
      v_familia_id, v_uid, v_email,
      coalesce(nullif(trim(p_nome), ''), 'Administrador(a)'),
      'dono',
      '{"ver_saldo_geral": true, "ver_gastos_dono": true, "ver_resumo_categorias": true}'::jsonb
    )
    returning * into v_membro;

  -- Migração 13 (26/09/2026, "poder total" sobre categorias): as 6 frentes
  -- de gasto e as 4 fontes de receita da doutrina financeira do COSMO já
  -- nascem como linhas de verdade na tabela `categorias` — editáveis e
  -- excluíveis desde o primeiro dia, sem distinção de "fixa" nenhuma. Ver
  -- supabase-migracao-13-categorias-poder-total.sql para o backfill das
  -- famílias que já existiam antes desta migração.
  insert into categorias (familia_id, tipo, chave, label, cor, cor_soft, icone)
  values
    (v_familia_id, 'gasto',   'dia_a_dia',    'Dia a dia',              '#0469FB', '#E7F0FE', '🛒'),
    (v_familia_id, 'gasto',   'recorrentes',  'Recorrentes',            '#7C5CFC', '#EFEAFE', '🔁'),
    (v_familia_id, 'gasto',   'reserva',      'Reserva/Investimentos',  '#E3A400', '#FFF6DA', '💰'),
    (v_familia_id, 'gasto',   'projetos',     'Projetos',               '#0EA5A0', '#E1F7F6', '📁'),
    (v_familia_id, 'gasto',   'casa_familia', 'Casa/família',           '#E85D8A', '#FDE9F0', '🏠'),
    (v_familia_id, 'gasto',   'saude',        'Saúde',                  '#F5934B', '#FFF1E4', '💊'),
    (v_familia_id, 'receita', 'trabalho',     'Trabalho principal',     '#0469FB', '#E7F0FE', '💼'),
    (v_familia_id, 'receita', 'correa_books', 'Corrêa Books',           '#E85D8A', '#FDE9F0', '📚'),
    (v_familia_id, 'receita', 'freelas',      'Freelas',                '#E3A400', '#FFF6DA', '⚡'),
    (v_familia_id, 'receita', 'outros',       'Outros',                 '#9AA2B5', '#EEF0F6', '⭐');

  return v_membro;
end;
$$;

create or replace function reivindicar_convite()
returns membros
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_membro membros;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_email is null then
    raise exception 'Não foi possível identificar seu e-mail.';
  end if;
  update membros set user_id = v_uid
    where user_id is null and email is not null and lower(email) = lower(v_email)
    returning * into v_membro;
  if v_membro.id is null then
    raise exception 'Nenhum convite pendente encontrado para este e-mail.';
  end if;
  return v_membro;
end;
$$;

-- Só responde SIM/NÃO pra "existe um convite pendente pro meu e-mail" — usada
-- pelo AuthGate ANTES de reivindicar_convite(), pra decidir se mostra a tela
-- "Convite encontrado". Precisa ser SECURITY DEFINER (ver migração 8):
-- uma busca comum feita pelo navegador de quem ainda não tem membro nenhum
-- não acha o convite, porque a política de SELECT em "membros" depende de
-- minha_familia_id(), que só existe depois de já ter um membro vinculado —
-- sem essa função, a pessoa convidada nunca via a tela de convite e acabava
-- criando uma família nova por engano.
create or replace function tenho_convite_pendente()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from membros
    where user_id is null and email is not null and lower(email) = lower(auth.email())
  );
$$;

grant execute on function criar_minha_familia(text) to authenticated;
grant execute on function reivindicar_convite() to authenticated;
grant execute on function tenho_convite_pendente() to authenticated;

grant execute on function minha_familia_id() to authenticated;
grant execute on function meu_papel() to authenticated;
grant execute on function meu_membro_id() to authenticated;
grant execute on function minhas_permissoes() to authenticated;
grant execute on function resumo_familia_do_membro() to authenticated;
grant execute on function resumo_categorias_do_membro() to authenticated;

-- ============================================================
-- A partir daqui: robustez (contas, cartões de crédito, investimentos) —
-- adicionado 15/09/2026. Ver supabase-migracao-2-robustez.sql se você já
-- tem um banco rodando e só precisa da parte nova.
-- ============================================================

create table if not exists contas (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  nome text not null,
  tipo text not null default 'corrente' check (tipo in ('corrente', 'poupanca', 'carteira', 'outro')),
  instituicao text,
  -- "Titular" (migração 3, 16/09/2026) — de quem é essa conta (você ou a
  -- Alessia), pra distinguir sem precisar de uma tabela nova.
  titular text,
  saldo_inicial numeric(12,2) not null default 0,
  visivel_para_restrito boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists cartoes_credito (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  conta_pagamento_id uuid references contas(id) on delete set null,
  nome text not null,
  bandeira text,
  titular text,
  limite numeric(12,2),
  dia_fechamento smallint check (dia_fechamento between 1 and 31),
  dia_vencimento smallint check (dia_vencimento between 1 and 31),
  -- Dívida que já existia no cartão antes de começar a lançar tudo pelo app
  -- (ver migração 6) — a fatura mostrada na tela é isto + soma dos gastos em
  -- aberto lançados depois; zera sozinha quando a fatura é paga pelo app.
  fatura_inicial numeric(12,2) not null default 0,
  -- Quanto do limite está preso em compras parceladas em andamento que ainda
  -- não têm lançamento individual no app (ver migração 7) — entra na conta
  -- de "disponível" mas NÃO na fatura atual, já que só vira fatura mês a mês.
  limite_comprometido_extra numeric(12,2) not null default 0,
  visivel_para_restrito boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists investimentos (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('renda_fixa', 'renda_variavel')),
  subtipo text,
  instituicao text,
  objetivo text check (objetivo in ('curto', 'medio', 'longo')),
  valor_aportado numeric(12,2) not null default 0,
  valor_atual numeric(12,2) not null default 0,
  data_aporte date not null default current_date,
  created_at timestamptz not null default now()
);

alter table lancamentos add column if not exists conta_id uuid references contas(id) on delete set null;
alter table lancamentos add column if not exists cartao_id uuid references cartoes_credito(id) on delete set null;
alter table lancamentos add column if not exists tag text;
alter table lancamentos add column if not exists fatura_paga boolean not null default false;

-- Parcelamento (migração 3, 16/09/2026) — CORREÇÃO 21/09/2026: estas 3
-- colunas e a função criar_compra_parcelada() (mais abaixo) tinham ficado
-- de fora deste script por engano — só existiam na migração 3 avulsa. Um
-- banco novo, rodando só este arquivo, não conseguia lançar nenhuma compra
-- parcelada (erro "function does not exist"). Cada parcela vira um
-- lançamento próprio, já datado no mês da fatura em que cai.
alter table lancamentos add column if not exists parcela_atual smallint;
alter table lancamentos add column if not exists parcela_total smallint;
alter table lancamentos add column if not exists compra_parcelada_id uuid;

create index if not exists idx_lancamentos_conta on lancamentos (conta_id);
create index if not exists idx_lancamentos_cartao on lancamentos (cartao_id);
create index if not exists idx_lancamentos_tag on lancamentos (tag);
create index if not exists idx_lancamentos_compra_parcelada on lancamentos (compra_parcelada_id);

alter table contas enable row level security;
alter table cartoes_credito enable row level security;
alter table investimentos enable row level security;

-- contas / cartoes_credito — ver migração 10 ("editar tudo", 16/09/2026):
-- antes só o dono editava, restrito só via as marcadas como visíveis. Agora
-- os dois editam (inserem/atualizam/excluem), dentro do que já é visível
-- pra cada um — a VISIBILIDADE (visivel_para_restrito) continua igual, só a
-- permissão de EDITAR deixou de ser exclusiva do dono.
create policy "contas: familia ve conforme visibilidade" on contas
  for select using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "contas: familia pode criar" on contas
  for insert with check (familia_id = minha_familia_id());

create policy "contas: familia pode editar conforme visibilidade" on contas
  for update using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "contas: familia pode excluir conforme visibilidade" on contas
  for delete using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "cartoes: familia ve conforme visibilidade" on cartoes_credito
  for select using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "cartoes: familia pode criar" on cartoes_credito
  for insert with check (familia_id = minha_familia_id());

create policy "cartoes: familia pode editar conforme visibilidade" on cartoes_credito
  for update using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

create policy "cartoes: familia pode excluir conforme visibilidade" on cartoes_credito
  for delete using (
    familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or visivel_para_restrito = true)
  );

-- "Pagar fatura atual" continua só do dono — é uma ação de movimentar
-- dinheiro (pagar_fatura_cartao já recusa quem não é dono, ver migração 6),
-- diferente de editar o CADASTRO da conta/cartão, que agora é liberado.

create policy "investimentos: so o dono ve e mexe" on investimentos
  for all using (familia_id = minha_familia_id() and meu_papel() = 'dono')
  with check (familia_id = minha_familia_id() and meu_papel() = 'dono');

-- Assinaturas (migração 3, 16/09/2026) — CORREÇÃO 21/09/2026: esta tabela
-- também tinha ficado de fora do script (só existia na migração 3 avulsa).
-- tipo_cobranca decide o comportamento: 'cartao' -> a assinatura já é
-- lançada nas parcelas/fatura do cartão normalmente; 'debito' -> o COSMO
-- confere o saldo da conta no dia da cobrança e, se der, lança sozinho.
create table if not exists assinaturas (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  nome text not null,
  categoria text not null default 'recorrentes',
  valor numeric(12,2) not null,
  dia_cobranca smallint not null check (dia_cobranca between 1 and 31),
  tipo_cobranca text not null check (tipo_cobranca in ('cartao', 'debito')),
  cartao_id uuid references cartoes_credito(id) on delete set null,
  conta_id uuid references contas(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Liga um lançamento de volta à assinatura que o gerou.
alter table lancamentos add column if not exists assinatura_id uuid references assinaturas(id) on delete set null;
create index if not exists idx_lancamentos_assinatura on lancamentos (assinatura_id);

alter table assinaturas enable row level security;

create policy "assinaturas: dono ve e mexe em tudo" on assinaturas
  for all using (familia_id = minha_familia_id() and meu_papel() = 'dono')
  with check (familia_id = minha_familia_id() and meu_papel() = 'dono');

grant select, insert, update, delete on assinaturas to authenticated;

-- categorias — migração 10 (16/09/2026): as 6 frentes de gasto e 4 fontes de
-- receita da doutrina financeira do COSMO (theme.js) continuam fixas — esta
-- tabela é pra CATEGORIAS EXTRAS que a própria família cria (nome + cor +
-- ícone), somadas às fixas em todo lugar que usa categoria.
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  tipo text not null check (tipo in ('gasto', 'receita')),
  chave text not null,
  label text not null,
  cor text not null default '#0469FB',
  cor_soft text not null default '#E7F0FE',
  icone text not null default 'estrela',
  created_at timestamptz not null default now(),
  unique (familia_id, tipo, chave)
);

alter table categorias enable row level security;

create policy "categorias: familia ve e mexe" on categorias
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on categorias to authenticated;

-- planejamento_itens (migração 12, 25/09/2026) — "lembrete de boletos": a
-- família cadastra contas que espera pagar (fixas ou de valor variável,
-- recorrentes todo mês ou de um mês específico), com dia de vencimento. O
-- "pago/não pago" NÃO fica aqui: desde a migração 14 (02/10/2026) é uma
-- marcação manual por item e por mês, na tabela planejamento_pagamentos logo
-- abaixo (antes era deduzido pela categoria do lançamento, o que marcava
-- vários itens de uma mesma categoria como pagos ao mesmo tempo).
create table if not exists planejamento_itens (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  nome text not null,
  categoria text not null,
  tipo_valor text not null default 'fixo' check (tipo_valor in ('fixo', 'variavel')),
  valor_fixo numeric(12,2),
  dia_vencimento smallint check (dia_vencimento between 1 and 31),
  recorrente boolean not null default true,
  mes_especifico date,
  created_at timestamptz not null default now()
);

alter table planejamento_itens enable row level security;

create policy "planejamento: familia ve e mexe" on planejamento_itens
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on planejamento_itens to authenticated;

-- planejamento_pagamentos (migração 14, 02/10/2026) — uma linha = "este item
-- foi pago neste mês". Sem linha = em aberto. Marcação manual feita na lista
-- do planejamento, independente dos lançamentos. valor_pago guarda o valor
-- que valeu naquele mês (fixo: valor_fixo na hora da marcação; variável: o
-- que a pessoa informou). unique (item_id, mes) impede marcação duplicada.
create table if not exists planejamento_pagamentos (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  item_id uuid not null references planejamento_itens(id) on delete cascade,
  mes date not null,
  valor_pago numeric(12,2) not null check (valor_pago >= 0),
  created_at timestamptz not null default now(),
  unique (item_id, mes)
);

alter table planejamento_pagamentos enable row level security;

create policy "planejamento pagamentos: familia ve e mexe" on planejamento_pagamentos
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on planejamento_pagamentos to authenticated;

-- planejamento_valores_mes (migração 15, 02/10/2026) — valor PLANEJADO de um
-- item num mês específico. Se existe linha pro (item, mês), ela manda; senão
-- vale o valor padrão do item (planejamento_itens.valor_fixo: fixo = valor de
-- sempre; variável = valor aproximado). O valor efetivamente PAGO é outra
-- coisa: planejamento_pagamentos.valor_pago.
create table if not exists planejamento_valores_mes (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  item_id uuid not null references planejamento_itens(id) on delete cascade,
  mes date not null,
  valor numeric(12,2) not null check (valor >= 0),
  created_at timestamptz not null default now(),
  unique (item_id, mes)
);

alter table planejamento_valores_mes enable row level security;

create policy "planejamento valores mes: familia ve e mexe" on planejamento_valores_mes
  for all using (familia_id = minha_familia_id())
  with check (familia_id = minha_familia_id());

grant select, insert, update, delete on planejamento_valores_mes to authenticated;

-- saldos_contas() — ampliado na migração 9 (unificação do acesso da
-- Alessia, 16/09/2026): antes só respondia pro dono, o que fazia sentido
-- enquanto só ele via "Contas e cartões"/"Relatórios". Agora que essas
-- telas também aparecem no "Mais" de quem tem acesso restrito (mesmos
-- menus, como pedido), esta função devolve, pra quem não é dono, o saldo
-- real só das contas JÁ marcadas como visíveis pra ela
-- (visivel_para_restrito = true) — nenhuma conta nova fica exposta, é a
-- mesma regra que a tabela "contas" já aplica no SELECT direto (ver a
-- política "contas: familia ve conforme visibilidade", migração 10).
create or replace function saldos_contas()
returns table(conta_id uuid, saldo numeric)
language sql security definer stable
as $$
  select c.id, c.saldo_inicial + coalesce(sum(
    case when l.tipo = 'receita' then l.valor
         when l.tipo = 'gasto' then -l.valor
         else 0 end
  ), 0) as saldo
  from contas c
  left join lancamentos l on l.conta_id = c.id
  where c.familia_id = minha_familia_id()
    and (meu_papel() = 'dono' or c.visivel_para_restrito = true)
  group by c.id, c.saldo_inicial;
$$;

-- Em qual "mês de fatura" (primeiro dia do mês, como date) um lançamento
-- cai, dado o dia de fechamento do cartão — replica em SQL a mesma regra de
-- mesDaFatura() no frontend (theme.js). Compras feitas depois do fechamento
-- entram na fatura do mês seguinte, não na atual.
create or replace function mes_fatura_lancamento(p_data date, p_dia_fechamento int)
returns date
language sql immutable
as $$
  select case
    when p_dia_fechamento is null or extract(day from p_data) <= p_dia_fechamento
      then date_trunc('month', p_data)::date
    else (date_trunc('month', p_data) + interval '1 month')::date
  end;
$$;

-- pagar_fatura_cartao só cobra e quita a fatura do CICLO ATUAL (mesmo
-- cálculo que a tela "Fatura atual" usa), nunca as parcelas futuras de uma
-- compra parcelada — cartão de crédito não é uma conta de subtração simples:
-- uma compra de R$6.000 em 10x consome o limite inteiro na hora, mas só a
-- parcela do mês entra na fatura atual.
create or replace function pagar_fatura_cartao(p_cartao_id uuid, p_descricao text default null)
returns lancamentos
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_familia_id uuid := minha_familia_id();
  v_papel text := meu_papel();
  v_membro_id uuid := meu_membro_id();
  v_cartao cartoes_credito;
  v_mes_atual date;
  v_total numeric;
  v_lancamento lancamentos;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_papel <> 'dono' then
    raise exception 'Só o administrador pode pagar faturas.';
  end if;

  select * into v_cartao from cartoes_credito where id = p_cartao_id and familia_id = v_familia_id;
  if v_cartao.id is null then
    raise exception 'Cartão não encontrado.';
  end if;
  if v_cartao.conta_pagamento_id is null then
    raise exception 'Este cartão não tem uma conta de pagamento configurada.';
  end if;

  select min(mes) into v_mes_atual
    from (
      select mes_fatura_lancamento(data, v_cartao.dia_fechamento) as mes
        from lancamentos
        where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto'
    ) t
    where mes >= date_trunc('month', current_date)::date;
  if v_mes_atual is null then
    v_mes_atual := date_trunc('month', current_date)::date;
  end if;

  select coalesce(v_cartao.fatura_inicial, 0) + coalesce(sum(valor), 0) into v_total
    from lancamentos
    where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto'
      and mes_fatura_lancamento(data, v_cartao.dia_fechamento) = v_mes_atual;

  if v_total <= 0 then
    raise exception 'Não há fatura em aberto para este cartão.';
  end if;

  insert into lancamentos (familia_id, membro_id, tipo, categoria, valor, descricao, data, conta_id)
    values (
      v_familia_id, v_membro_id, 'gasto', 'fatura_cartao', v_total,
      coalesce(nullif(trim(p_descricao), ''), concat('Fatura ', v_cartao.nome)),
      current_date, v_cartao.conta_pagamento_id
    )
    returning * into v_lancamento;

  update lancamentos set fatura_paga = true
    where cartao_id = p_cartao_id and fatura_paga = false and tipo = 'gasto' and id <> v_lancamento.id
      and mes_fatura_lancamento(data, v_cartao.dia_fechamento) = v_mes_atual;

  update cartoes_credito set fatura_inicial = 0 where id = p_cartao_id;

  return v_lancamento;
end;
$$;

grant execute on function saldos_contas() to authenticated;
grant execute on function mes_fatura_lancamento(date, int) to authenticated;
grant execute on function pagar_fatura_cartao(uuid, text) to authenticated;

-- criar_compra_parcelada (migração 3, 16/09/2026; CORREÇÃO 21/09/2026: tinha
-- ficado de fora deste script, só existia na migração 3 avulsa — um banco
-- novo rodando só este arquivo não conseguia lançar nenhuma compra
-- parcelada). Insere as N parcelas de uma compra no cartão como N
-- lançamentos atômicos (tudo ou nada), cada um já com a data certa (um mês
-- depois do outro).
--
-- p_valor_parcela_manual (migração 11, 21/09/2026) — quando a operadora
-- cobra juros no parcelamento, a parcela que aparece na fatura NÃO é o
-- valor da compra dividido igualmente. Quando esse parâmetro vem
-- preenchido, ele manda: todas as parcelas saem com esse valor exato (o
-- total "de verdade", com juros e tudo, passa a ser valor_parcela ×
-- parcelas). Sem ele, continua dividindo p_valor_total igualmente, com a
-- última parcela absorvendo o arredondamento — exatamente como sempre foi.
create or replace function criar_compra_parcelada(
  p_cartao_id uuid,
  p_membro_id uuid,
  p_categoria text,
  p_descricao text,
  p_valor_total numeric,
  p_parcelas int,
  p_data_compra date,
  p_tag text default null,
  p_valor_parcela_manual numeric default null
)
returns uuid
language plpgsql security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_familia_id uuid := minha_familia_id();
  v_papel text := meu_papel();
  v_meu_membro_id uuid := meu_membro_id();
  v_grupo_id uuid := gen_random_uuid();
  v_valor_parcela numeric;
  v_soma_parcial numeric := 0;
  v_valor_desta numeric;
  i int;
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_familia_id is null then
    raise exception 'Você não pertence a nenhuma família no Cash App.';
  end if;
  if v_papel <> 'dono' and p_membro_id <> v_meu_membro_id then
    raise exception 'Você só pode lançar compras em seu próprio nome.';
  end if;
  if p_parcelas is null or p_parcelas < 1 or p_parcelas > 24 then
    raise exception 'Número de parcelas inválido (use entre 1 e 24).';
  end if;

  if p_valor_parcela_manual is not null then
    if p_valor_parcela_manual <= 0 then
      raise exception 'Valor da parcela inválido.';
    end if;
    v_valor_parcela := round(p_valor_parcela_manual, 2);
  else
    if p_valor_total is null or p_valor_total <= 0 then
      raise exception 'Valor da compra inválido.';
    end if;
    v_valor_parcela := round(p_valor_total / p_parcelas, 2);
  end if;

  for i in 1..p_parcelas loop
    if p_valor_parcela_manual is not null then
      v_valor_desta := v_valor_parcela;
    elsif i = p_parcelas then
      v_valor_desta := round(p_valor_total - v_soma_parcial, 2);
    else
      v_valor_desta := v_valor_parcela;
      v_soma_parcial := v_soma_parcial + v_valor_desta;
    end if;

    insert into lancamentos (
      familia_id, membro_id, tipo, categoria, valor, descricao, data,
      cartao_id, tag, parcela_atual, parcela_total, compra_parcelada_id
    ) values (
      v_familia_id, p_membro_id, 'gasto', p_categoria, v_valor_desta,
      case when p_parcelas > 1 then coalesce(nullif(trim(p_descricao), ''), 'Compra parcelada') || ' (' || i || '/' || p_parcelas || ')'
           else nullif(trim(p_descricao), '') end,
      (p_data_compra + make_interval(months => i - 1))::date,
      p_cartao_id, nullif(trim(p_tag), ''),
      case when p_parcelas > 1 then i else null end,
      case when p_parcelas > 1 then p_parcelas else null end,
      case when p_parcelas > 1 then v_grupo_id else null end
    );
  end loop;

  return v_grupo_id;
end;
$$;

grant execute on function criar_compra_parcelada(uuid, uuid, text, text, numeric, int, date, text, numeric) to authenticated;

-- ============================================================
-- Chat do COSMO persistente — adicionado 16/09/2026. Ver
-- supabase-migracao-5-chat-persistente.sql se você já tem um banco rodando.
-- Cada pessoa só vê a PRÓPRIA conversa (não é um chat da família).
-- ============================================================

create table if not exists chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  membro_id uuid not null references membros(id) on delete cascade,
  autor text not null check (autor in ('usuario', 'cosmo')),
  texto text,
  propostas jsonb,
  confirmadas jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_mensagens_membro on chat_mensagens (membro_id, created_at);

alter table chat_mensagens enable row level security;

create policy "chat: cada um ve e mexe so na propria conversa" on chat_mensagens
  for all using (membro_id = meu_membro_id())
  with check (membro_id = meu_membro_id());

grant select, insert, update, delete on chat_mensagens to authenticated;

-- Fim do script. Depois de rodar, confira em Table Editor se as tabelas
-- (familias, membros, lancamentos, contas, cartoes_credito, investimentos,
-- assinaturas, categorias, chat_mensagens) aparecem, cada uma com o cadeado
-- de RLS ativado (ícone ao lado do nome).
