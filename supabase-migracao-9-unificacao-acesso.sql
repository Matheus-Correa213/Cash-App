-- Migração 9 — Unificação do acesso da Alessia (acesso restrito) — 16/09/2026
--
-- Depois que ela reivindicou o convite direito (migração 8), o problema
-- seguinte apareceu: o "acesso restrito" dela era, na prática, um APP
-- DIFERENTE — uma tela separada (MemberView), sem a barra de baixo
-- (Painel/Receitas/Gastos/Mais), sem o visual redesenhado, sem chat com o
-- COSMO. O Matheus pediu explicitamente: mesmos menus, mesma aparência,
-- mesmo painel geral — só as EDIÇÕES que não são dela (mexer nas permissões
-- de alguém, pagar fatura, cadastrar conta/cartão/investimento) é que devem
-- ficar de fora. Isso foi resolvido no código do app (App.jsx passou a usar
-- sempre o mesmo "OwnerView", agora compartilhado, com botões de edição
-- escondidos quando quem está vendo não é o dono).
--
-- Esta migração cobre a parte de BANCO desse ajuste — dois pontos:
--
-- 1) resumo_familia_do_membro() tinha um bug de verdade (não só de
--    arquitetura): o campo "saldo" que ele devolve pra quem tem acesso
--    restrito ainda usava a fórmula antiga (receitas do mês − gastos do mês,
--    ou seja o FLUXO DE CAIXA do mês), a mesma que já tinha sido corrigida no
--    Painel do dono há algumas versões (16/09/2026, ver Painel.jsx) pra usar
--    o saldo REAL das contas (saldo_inicial + lançamentos de cada conta,
--    somando as contas correntes/carteiras da família — poupança fica de
--    fora, tratada à parte). Por isso o "SALDO GERAL DA FAMÍLIA" que a
--    Alessia via nunca batia com o que o Matheus via no Painel dele, mesmo
--    com a permissão "ver saldo geral" concedida. Corrigido abaixo, usando a
--    MESMA lógica de saldos_contas() (ponto 2), só que somada por cima de
--    TODAS as contas da família (não só as marcadas como visíveis pra
--    restrito) — é assim que ela consegue ver "o mesmo valor geral que o
--    Matheus vê", mesmo sem ter acesso ao detalhe de cada conta escondida
--    dela.
--
-- 2) saldos_contas() (usada por ContasCartoes.jsx e por Relatórios → Contas)
--    só respondia pra quem é dono (where ... and meu_papel() = 'dono') —
--    fazia sentido enquanto só o dono via essas telas. Agora que "Contas e
--    cartões" e "Relatórios" também aparecem no "Mais" dela (mesmos menus,
--    como pedido), ela precisa do saldo REAL de cada conta que já é visível
--    pra ela (visivel_para_restrito = true), senão essas telas mostrariam o
--    saldo_inicial parado no tempo em vez do saldo atual — uma inconsistência
--    nova que só apareceria por causa da unificação, não por falta de
--    permissão. Ajustado abaixo pra devolver, pra quem NÃO é dono, só as
--    linhas das contas já marcadas como visíveis pra ela — nenhuma conta
--    nova fica exposta, é a mesma regra de visibilidade que a tabela
--    "contas" já aplica no SELECT direto.
-- ============================================================

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

  -- Saldo REAL (dinheiro que existe de verdade nas contas da família), não o
  -- fluxo de caixa do mês — mesma conta que saldos_contas()/Painel.jsx já
  -- fazem: saldo_inicial de cada conta + todos os lançamentos dela, somando
  -- só as contas correntes/carteiras (tipo <> 'poupanca'), de TODAS as
  -- contas da família (esta função já é SECURITY DEFINER e só chega até
  -- aqui se a permissão "ver_saldo_geral" permitir — por isso pode olhar
  -- contas que não estão marcadas como visíveis pra ela: é exatamente esse
  -- número "geral" que ela tem permissão de ver, mesmo sem ver o detalhe de
  -- cada conta escondida).
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
