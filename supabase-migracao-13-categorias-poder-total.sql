-- Migração 13 — "poder total" sobre categorias (26/09/2026)
--
-- Pedido do Matheus: "Não existe essa de fixas, elas devem ser editadas ou
-- excluídas também. Poder total para mim, e o COSMO." As 6 frentes de gasto
-- e as 4 fontes de receita da doutrina financeira do COSMO (hoje hard-coded
-- em src/theme.js, sem linha na tabela `categorias`, por isso a tela
-- Categorias não deixava editar/excluir) viram categorias DE VERDADE — uma
-- linha na tabela igual a qualquer categoria personalizada — pra família
-- poder renomear, trocar cor/emoji ou até excluir qualquer uma delas, e pro
-- COSMO (chat) também poder mexer nelas via ferramenta.
--
-- Não existe (e não precisa existir) uma coluna "é fixa" nova: a diferença
-- entre "fixa" e "personalizada" deixa de existir de propósito. O app
-- continua com um fallback hard-coded (FRENTES_GASTO/FONTES_RECEITA em
-- theme.js) só para famílias muito antigas cujo backfill abaixo, por algum
-- motivo, não tenha rodado — mas a partir desta migração toda família (as
-- que já existem, via backfill; as novas, via criar_minha_familia) ganha as
-- 10 linhas reais e passa a tratá-las como qualquer categoria seria.
--
-- Efeito colateral visual esperado (avisar o Matheus): as 10 categorias da
-- doutrina passam a mostrar um EMOJI em vez do ícone SVG atual (mesma lógica
-- de emoji das categorias personalizadas desde a migração 12) — as cores
-- continuam exatamente as mesmas de hoje. Qualquer um pode trocar o emoji
-- depois, é só editar a categoria.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. É seguro rodar mais
-- de uma vez (backfill usa ON CONFLICT DO NOTHING).

-- 1) Backfill: cria as 10 categorias da doutrina para TODA família que já
--    existe e ainda não tem essas chaves (não sobrescreve nada — se a
--    família já tiver, por qualquer motivo, uma linha com essa chave, essa
--    linha existente é mantida do jeito que está).
insert into categorias (familia_id, tipo, chave, label, cor, cor_soft, icone)
select f.id, v.tipo, v.chave, v.label, v.cor, v.cor_soft, v.icone
from familias f
cross join (values
  ('gasto',   'dia_a_dia',    'Dia a dia',              '#0469FB', '#E7F0FE', '🛒'),
  ('gasto',   'recorrentes',  'Recorrentes',            '#7C5CFC', '#EFEAFE', '🔁'),
  ('gasto',   'reserva',      'Reserva/Investimentos',  '#E3A400', '#FFF6DA', '💰'),
  ('gasto',   'projetos',     'Projetos',               '#0EA5A0', '#E1F7F6', '📁'),
  ('gasto',   'casa_familia', 'Casa/família',           '#E85D8A', '#FDE9F0', '🏠'),
  ('gasto',   'saude',        'Saúde',                  '#F5934B', '#FFF1E4', '💊'),
  ('receita', 'trabalho',     'Trabalho principal',     '#0469FB', '#E7F0FE', '💼'),
  ('receita', 'correa_books', 'Corrêa Books',           '#E85D8A', '#FDE9F0', '📚'),
  ('receita', 'freelas',      'Freelas',                '#E3A400', '#FFF6DA', '⚡'),
  ('receita', 'outros',       'Outros',                 '#9AA2B5', '#EEF0F6', '⭐')
) as v(tipo, chave, label, cor, cor_soft, icone)
on conflict (familia_id, tipo, chave) do nothing;

-- 2) `criar_minha_familia`: a partir de agora, toda família NOVA já nasce
--    com as mesmas 10 categorias, na mesma transação que cria a família e o
--    membro dono (evita o caso de uma família nova sem nenhuma dessas
--    categorias "reais" até alguém criar na mão).
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

  -- Migração 13 (26/09/2026): as 10 categorias da doutrina financeira já
  -- nascem como linhas de verdade, editáveis/excluíveis desde o primeiro dia.
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
