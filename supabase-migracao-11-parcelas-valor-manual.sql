-- ============================================================
-- CASH APP — Migração 11: parcela com valor manual (juros) +
-- correção de um buraco no supabase-schema.sql — 21/09/2026
-- Rode este script INTEIRO no SQL Editor do SEU projeto Supabase do
-- Cash App. Ele só ADICIONA/SUBSTITUI coisas — pode rodar com
-- segurança mesmo já tendo rodado a migração 3 antes (é exatamente
-- o caso do seu banco: ele já tem criar_compra_parcelada(), esta
-- migração troca essa função por uma versão nova, compatível com a
-- antiga).
-- ============================================================

-- Pedido do Matheus (21/09/2026): "nem sempre a parcela é sem juros" — a
-- operadora do cartão às vezes cobra juros no parcelamento, e nesse caso o
-- valor que aparece na fatura NÃO é a compra dividida igualmente. Esta
-- migração adiciona um parâmetro NOVO (com valor padrão nulo, por isso é
-- seguro rodar por cima da função antiga sem quebrar nada que já chama ela
-- do jeito de sempre): quando o app manda um valor manual de parcela, essa
-- função para de tentar dividir p_valor_total e passa a usar o valor
-- informado em TODAS as parcelas (o total "de verdade", com juros, é
-- valor_parcela × número de parcelas). Sem esse parâmetro, continua
-- exatamente como antes: divide p_valor_total igualmente, com a última
-- parcela absorvendo o arredondamento.
--
-- Note também que o limite de parcelas continua sendo 1 a 24 (nunca foi
-- alterado) — o pedido do Matheus de oferecer "de 1 a 15" no app é uma
-- escolha da TELA (o formulário de Novo lançamento), não uma restrição do
-- banco; o banco já aceitava mais do que isso.
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
      -- Valor informado pelo usuário pra cada parcela (já com juros, se
      -- houver) — todas as parcelas saem iguais, sem ajuste de
      -- arredondamento na última, porque não existe mais um "total teórico"
      -- pra bater certinho.
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

-- Fim da migração 11. Não precisa conferir nada visualmente no Table Editor
-- desta vez — é só uma função, sem tabela nova. Pra testar: lance uma
-- compra parcelada marcando "valor da parcela veio diferente" no app e veja
-- se as parcelas saem com o valor que você digitou.
