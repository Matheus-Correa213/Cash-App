-- ============================================================
-- CASH APP — Migração 3: redesign (contas reais, parcelamento,
-- assinaturas) — 16/09/2026
-- Rode este script INTEIRO no SQL Editor do SEU projeto Supabase do
-- Cash App, depois de já ter rodado supabase-schema.sql (com a
-- migração de robustez) alguma vez. Ele só ADICIONA coisas novas —
-- pode rodar com segurança mesmo que parte já exista (tudo usa
-- "if not exists" / "add column if not exists").
-- ============================================================

-- 1) "Titular" em contas e cartões — pra saber de quem é cada um (você ou a
--    Alessia) sem precisar de uma tabela nova. É só um texto livre.
alter table contas add column if not exists titular text;
alter table cartoes_credito add column if not exists titular text;

-- 2) Parcelamento — cada parcela de uma compra parcelada vira UM lançamento
--    próprio, já datado no mês da fatura em que vai cair (isso é o que
--    permite calcular "prévia das próximas faturas" sem nenhuma lógica
--    especial de leitura: é só somar lançamentos futuros por mês).
alter table lancamentos add column if not exists parcela_atual smallint;
alter table lancamentos add column if not exists parcela_total smallint;
alter table lancamentos add column if not exists compra_parcelada_id uuid;

create index if not exists idx_lancamentos_compra_parcelada on lancamentos (compra_parcelada_id);

-- 3) Assinaturas — tabela nova. tipo_cobranca decide o comportamento:
--    'cartao'  -> a assinatura já é lançada nas parcelas/fatura do cartão
--                 normalmente (sem lógica especial de confirmação);
--    'debito'  -> o COSMO confere o saldo da conta no dia da cobrança e,
--                 se der, lança sozinho (ver api/verificar-assinaturas.js).
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

-- Liga um lançamento de volta à assinatura que o gerou (pra tela de
-- Assinaturas conseguir mostrar "confirmado hoje às..." sem adivinhar).
alter table lancamentos add column if not exists assinatura_id uuid references assinaturas(id) on delete set null;
create index if not exists idx_lancamentos_assinatura on lancamentos (assinatura_id);

alter table assinaturas enable row level security;

create policy "assinaturas: dono ve e mexe em tudo" on assinaturas
  for all using (familia_id = minha_familia_id() and meu_papel() = 'dono')
  with check (familia_id = minha_familia_id() and meu_papel() = 'dono');

grant select, insert, update, delete on assinaturas to authenticated;

-- ------------------------------------------------------------
-- 4) criar_compra_parcelada — insere as N parcelas de uma compra no cartão
--    como N lançamentos atômicos (tudo ou nada), cada um já com a data
--    certa (um mês depois do outro) e o valor certo (a última parcela
--    absorve a diferença de arredondamento, pra soma bater exatamente com
--    o valor total da compra).
-- ------------------------------------------------------------
create or replace function criar_compra_parcelada(
  p_cartao_id uuid,
  p_membro_id uuid,
  p_categoria text,
  p_descricao text,
  p_valor_total numeric,
  p_parcelas int,
  p_data_compra date,
  p_tag text default null
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
  if p_valor_total is null or p_valor_total <= 0 then
    raise exception 'Valor da compra inválido.';
  end if;

  v_valor_parcela := round(p_valor_total / p_parcelas, 2);

  for i in 1..p_parcelas loop
    if i = p_parcelas then
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

grant execute on function criar_compra_parcelada(uuid, uuid, text, text, numeric, int, date, text) to authenticated;

-- Fim da migração 3. Depois de rodar: confira em Table Editor se a tabela
-- "assinaturas" apareceu com o cadeado de RLS ativo, e se "contas" e
-- "cartoes_credito" ganharam a coluna "titular".
