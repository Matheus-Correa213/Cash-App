import React, { useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda, mesAtualISO, nomeMes } from "./theme.js";
import { IconCheck, IconClock, IconCosmo } from "./Icons.jsx";
import { itensDoMesComFaturas } from "./planejamentoCalculo.js";

// Planejamento financeiro — pedido do Matheus (leva 12, 25/09/2026): "uma
// tela de planejamento financeiro, onde eu posso escrever os gastos
// previstos do mês, quais são recorrentes e essas ficam aparecendo no
// planejamento de todos os meses, e conforme o mês muda e eu vou pagando,
// ele vai ticando que paguei aquela conta do planejamento... É um lembrete
// de boletos."
//
// "PAGO" é uma MARCAÇÃO MANUAL, feita aqui na lista, por item e por mês
// (migração 14, 02/10/2026 — pedido do Matheus depois de um bug real). Antes
// (migração 12) o "pago" era deduzido batendo categoria + mês contra os
// lançamentos; como vários itens usam a mesma categoria (ex: "Boletos
// Recorrentes" com Parcela do Empréstimo, Parcela do Cartão e Internet), um
// único lançamento de R$ 183,25 marcava os três como pagos, todos com o mesmo
// valor. Decisão dele: "vamos deixar o pago como um item para marcar fora do
// lançamento, na tela que fica a lista do planejamento — aí evita erros."
// Uma linha em planejamento_pagamentos (item_id + mes) = pago naquele mês; sem
// linha = em aberto. Lançar o gasto de verdade (botão "lançar agora", Gastos,
// chat do COSMO) NÃO marca nada sozinho, e marcar como pago NÃO cria
// lançamento — são duas coisas separadas de propósito.
//
// DOIS VALORES, SEPARADOS (migração 15, 02/10/2026 — pedido do Matheus):
// boletos variáveis mudam de mês pra mês, mas no mês que ele está planejando
// muitas vezes já sabe o valor.
//   • PREVISTO (planejado) de um item num mês = o valor ESPECÍFICO daquele mês
//     (planejamento_valores_mes), se existir; senão o valor PADRÃO do item
//     (planejamento_itens.valor_fixo): pra item fixo é o valor de sempre; pra
//     item variável é um valor APROXIMADO (arredondado), que aparece com "~".
//     Item variável sem nenhum dos dois fica "sem valor" e fora da soma.
//   • PAGO (planejamento_pagamentos.valor_pago) é outro número, confirmado na
//     hora de marcar como pago — já vem preenchido com o previsto, e a pessoa
//     ajusta se pagou diferente (juros, desconto). Decisão explícita dele: "quero
//     separar o pago, ele pode confirmar na hora que for marcar como pago".
// Mudar o valor de outubro não mexe em novembro. Tocar no valor da linha abre
// o ajuste rápido (valor do mês, ou o valor pago se o item já está pago).

const MODO = { PAGAR: "pagar", VALOR_MES: "valorMes", AJUSTAR_PAGO: "ajustarPago" };

function lerValor(str) {
  if (str === "" || str == null) return null;
  const n = Number(String(str).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function mensagemTabelaFaltando(error, tabela, migracao, acao) {
  const faltando = new RegExp(`${tabela}|relation|does not exist|schema cache`, "i").test(error?.message || "");
  return faltando ? `${acao} — rode a migração ${migracao} no Supabase.` : error?.message || acao;
}

export default function Planejamento({ familiaId, itens, pagamentos, valoresMes, vencimentosMes, frentesGasto, cartoes, lancamentosCartao, onAtualizado, onLancarAgora, onPerguntarCosmo, onAbrirCartao, onVoltar }) {
  const [mes, setMes] = useState(mesAtualISO());
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  // Ajuste rápido aberto embaixo de uma linha: { id, modo }.
  const [painel, setPainel] = useState(null);
  const [valorInformado, setValorInformado] = useState("");
  const [salvandoId, setSalvandoId] = useState(null);
  // Duas formas de olhar a mesma lista (pedido do Matheus, 02/10/2026): "por
  // categoria" (a de sempre) e "por vencimento". Na visão por vencimento dá
  // pra filtrar: tudo / só com data / só sem data.
  const [visao, setVisao] = useState("categoria");
  const [filtroData, setFiltroData] = useState("tudo");

  // Itens digitados + a fatura de cada cartão (calculada ao vivo dos lançamentos
  // do cartão — ver faturasDeCartaoDoMes em planejamentoCalculo.js).
  const itensDoMes = useMemo(
    () => itensDoMesComFaturas({ itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, mes }),
    [itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, mes]
  );

  const totalPrevisto = itensDoMes.reduce((s, i) => s + i.previstoSoma, 0);
  const totalPago = itensDoMes.filter((i) => i.pago).reduce((s, i) => s + i.valorReal, 0);
  const totalFalta = itensDoMes.filter((i) => !i.pago).reduce((s, i) => s + i.previstoSoma, 0);
  const nAproximados = itensDoMes.filter((i) => !i.pago && i.aproximado).length;
  const nSemValor = itensDoMes.filter((i) => !i.pago && i.previsto == null).length;
  const avisosTopo = [];
  if (nAproximados) avisosTopo.push(`inclui ${nAproximados} ${nAproximados === 1 ? "valor aproximado" : "valores aproximados"}`);
  // Venceu em mês anterior (mês do vencimento escolhido ao editar) e não foi pago.
  const nVencidosAntes = itensDoMes.filter((i) => !i.pago && i.vencidoAntes).length;
  if (nVencidosAntes) avisosTopo.unshift(`${nVencidosAntes} ${nVencidosAntes === 1 ? "item venceu" : "itens venceram"} em mês anterior`);
  const nFaturasAbertas = itensDoMes.filter((i) => i.ehCartao && i.aberta).length;
  if (nFaturasAbertas) avisosTopo.push(`${nFaturasAbertas} ${nFaturasAbertas === 1 ? "fatura de cartão ainda recebendo compras" : "faturas de cartão ainda recebendo compras"}`);
  if (nSemValor) avisosTopo.push(`${nSemValor} ${nSemValor === 1 ? "item sem valor" : "itens sem valor"} (fora da soma)`);

  function frenteDe(categoria) {
    if (categoria === "__cartao__") return { chave: categoria, label: "Cartões de crédito", cor: C.purple, corSoft: C.purpleSoft, Icone: null, emoji: "💳" };
    return frentesGasto.find((f) => f.chave === categoria) || { chave: categoria, label: categoria, cor: C.inkMute, corSoft: C.line, Icone: null, emoji: null };
  }

  // Itens agrupados por categoria (pedido do Matheus, 02/10/2026: "quero ver
  // as categorias acima da linha dos lançamentos"). Cada grupo ganha um
  // cabeçalho com o nome da categoria e o subtotal pago/previsto dela. Grupos
  // com algo ainda em aberto vêm primeiro; grupo todo pago desce pro fim. No
  // empate, vale a ordem das categorias na tela Categorias. Dentro do grupo
  // mantém a ordem de itensDoMes (em aberto primeiro, depois por vencimento).
  const grupos = useMemo(() => {
    const porCategoria = new Map();
    for (const i of itensDoMes) {
      if (!porCategoria.has(i.categoria)) porCategoria.set(i.categoria, []);
      porCategoria.get(i.categoria).push(i);
    }
    const posicao = (c) => { const idx = frentesGasto.findIndex((f) => f.chave === c); return idx === -1 ? 999 : idx; };
    return [...porCategoria.entries()]
      .map(([categoria, lista]) => ({
        categoria,
        itens: lista,
        aberto: lista.some((i) => !i.pago),
        previsto: lista.reduce((s, i) => s + i.previstoSoma, 0),
        pago: lista.filter((i) => i.pago).reduce((s, i) => s + i.valorReal, 0),
      }))
      .sort((a, b) => (a.aberto === b.aberto ? 0 : a.aberto ? -1 : 1) || posicao(a.categoria) - posicao(b.categoria));
  }, [itensDoMes, frentesGasto]);

  // Visão por vencimento (pedido do Matheus, 02/10/2026): "poder filtrar por
  // datas de vencimento. E os que não têm data marcada é porque não têm
  // realmente uma data, são coisas pessoais, sem data exata." Então item sem
  // dia_vencimento NÃO é "esquecido": vai pro grupo "Sem data" e nunca conta
  // como atrasado. Com data: em aberto fica separado por urgência (só faz
  // sentido comparar com "hoje" no mês atual — num mês passado tudo que está
  // em aberto está atrasado; num mês futuro ainda não venceu nada).
  const gruposVencimento = useMemo(() => {
    const hoje = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const isoDe = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const hojeISO = isoDe(hoje);
    const mesHoje = hojeISO.slice(0, 7);
    const em7 = isoDe(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 7));
    // Data de vencimento "de verdade": a de outro mês (mês do vencimento escolhido
    // ao editar), ou o dia do item dentro do mês que está na tela.
    const dataDe = (i) => i.vencimentoOutroMes || `${mes}-${pad2(i.dia_vencimento)}`;
    const ordem = (a, b) => dataDe(a).localeCompare(dataDe(b)) || a.nome.localeCompare(b.nome);
    const comData = itensDoMes.filter((i) => i.dia_vencimento != null);
    const semData = itensDoMes.filter((i) => i.dia_vencimento == null);
    const abertos = comData.filter((i) => !i.pago).sort(ordem);
    const pagos = comData.filter((i) => i.pago).sort(ordem);
    const nomeDoMesLocal = nomeMes(mes).split(" ")[0];
    const lista = [];
    lista.push({ chave: "atrasados", titulo: "Atrasados", cor: C.coralText, itens: abertos.filter((i) => dataDe(i) < hojeISO) });
    if (mes === mesHoje) {
      lista.push({ chave: "hoje", titulo: "Vence hoje", cor: C.amberText, itens: abertos.filter((i) => dataDe(i) === hojeISO) });
      lista.push({ chave: "semana", titulo: "Próximos 7 dias", cor: C.accent, itens: abertos.filter((i) => dataDe(i) > hojeISO && dataDe(i) <= em7) });
      lista.push({ chave: "depois", titulo: "Mais pra frente neste mês", cor: C.inkMute, itens: abertos.filter((i) => dataDe(i) > em7) });
    } else if (mes > mesHoje) {
      lista.push({ chave: "mes", titulo: `Vencimentos de ${nomeDoMesLocal}`, cor: C.accent, itens: abertos.filter((i) => dataDe(i) >= hojeISO) });
    }
    lista.push({ chave: "pagos", titulo: "Pagos", cor: C.green, itens: pagos, pagos: true });
    lista.push({ chave: "semdata", titulo: "Sem data · pessoais", cor: C.purple, itens: semData, semData: true });
    return lista
      .filter((g) => g.itens.length > 0)
      .filter((g) => filtroData === "tudo" || (filtroData === "sem" ? g.semData : !g.semData))
      .map((g) => ({
        ...g,
        total: g.pagos
          ? g.itens.reduce((s, i) => s + i.valorReal, 0)
          : g.itens.filter((i) => !i.pago).reduce((s, i) => s + i.previstoSoma, 0),
      }));
  }, [itensDoMes, mes, filtroData]);

  const nomeDoMes = nomeMes(mes).split(" ")[0];

  function abrirPainel(item, modo) {
    let inicial = "";
    if (modo === MODO.PAGAR) inicial = item.previsto != null ? item.previsto : "";
    else if (modo === MODO.VALOR_MES) inicial = item.previsto != null ? item.previsto : "";
    else if (modo === MODO.AJUSTAR_PAGO) inicial = item.valorReal;
    setPainel({ id: item.id, modo });
    setValorInformado(String(inicial));
  }

  function fecharPainel() {
    setPainel(null);
    setValorInformado("");
  }

  // Grava "pago" pra (item, mês escolhido). upsert em (item_id, mes) — tocar
  // duas vezes seguidas não duplica nem dá erro. `.select()` + checagem de
  // linhas pelo mesmo motivo de sempre (RLS barrando vira "sucesso" com 0
  // linhas).
  async function gravarPago(item, valor) {
    setSalvandoId(item.id);
    try {
      const { data, error } = await supabase
        .from("planejamento_pagamentos")
        .upsert({ familia_id: familiaId, item_id: item.id, mes: `${mes}-01`, valor_pago: valor }, { onConflict: "item_id,mes" })
        .select();
      if (error) throw new Error(mensagemTabelaFaltando(error, "planejamento_pagamentos", 14, "Não consegui salvar o pagamento"));
      if (!data || data.length === 0) throw new Error(`"${item.nome}" não foi atualizado — o banco não confirmou nenhuma alteração.`);
      fecharPainel();
      onAtualizado();
    } catch (e) {
      alert(e.message || "Erro ao salvar o pagamento.");
    } finally {
      setSalvandoId(null);
    }
  }

  // Valor PLANEJADO deste item só neste mês (planejamento_valores_mes).
  async function gravarValorMes(item, valor) {
    setSalvandoId(item.id);
    try {
      const { data, error } = await supabase
        .from("planejamento_valores_mes")
        .upsert({ familia_id: familiaId, item_id: item.id, mes: `${mes}-01`, valor }, { onConflict: "item_id,mes" })
        .select();
      if (error) throw new Error(mensagemTabelaFaltando(error, "planejamento_valores_mes", 15, "Não consegui salvar o valor do mês"));
      if (!data || data.length === 0) throw new Error(`"${item.nome}" não foi atualizado — o banco não confirmou nenhuma alteração.`);
      fecharPainel();
      onAtualizado();
    } catch (e) {
      alert(e.message || "Erro ao salvar o valor do mês.");
    } finally {
      setSalvandoId(null);
    }
  }

  // Tira o valor específico do mês: o item volta a usar o valor padrão/aproximado.
  async function removerValorMes(item) {
    setSalvandoId(item.id);
    try {
      const { error } = await supabase
        .from("planejamento_valores_mes")
        .delete()
        .eq("item_id", item.id)
        .eq("mes", `${mes}-01`)
        .select();
      if (error) throw new Error(mensagemTabelaFaltando(error, "planejamento_valores_mes", 15, "Não consegui remover o valor do mês"));
      fecharPainel();
      onAtualizado();
    } catch (e) {
      alert(e.message || "Erro ao remover o valor do mês.");
    } finally {
      setSalvandoId(null);
    }
  }

  async function confirmarPainel(item) {
    const valor = lerValor(valorInformado);
    if (valor == null) {
      return alert(painel?.modo === MODO.VALOR_MES ? `Informe o valor de ${nomeDoMes}.` : "Informe o valor pago neste mês.");
    }
    if (painel.modo === MODO.VALOR_MES) return gravarValorMes(item, valor);
    return gravarPago(item, valor);
  }

  async function desmarcarPago(item) {
    setSalvandoId(item.id);
    try {
      const { data, error } = await supabase
        .from("planejamento_pagamentos")
        .delete()
        .eq("item_id", item.id)
        .eq("mes", `${mes}-01`)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(`"${item.nome}" não foi desmarcado — o banco não confirmou nenhuma alteração.`);
      onAtualizado();
    } catch (e) {
      alert(e.message || "Erro ao desmarcar.");
    } finally {
      setSalvandoId(null);
    }
  }

  async function excluir(id) {
    if (!confirm("Excluir este item do planejamento? (isso não mexe em nenhum lançamento já feito, só no lembrete)")) return;
    const { error } = await supabase.from("planejamento_itens").delete().eq("id", id);
    if (error) return alert(error.message);
    onAtualizado();
  }

  // Fatura de cartão: linha automática (valor ao vivo), sem marcar pago / editar /
  // excluir — pagar é "Pagar fatura" na tela do cartão, e o valor vem das compras.
  function linhaCartao(item) {
    return (
      <div key={item.id} style={{ borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: item.pago ? C.greenSoft : C.purpleSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {item.pago ? <IconCheck size={16} color={C.green} strokeWidth={2.3} /> : <span style={{ fontSize: 16, lineHeight: 1 }}>💳</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, wordBreak: "break-word" }}>{item.nome}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{subtituloDe(item)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: item.pago ? C.green : C.ink }}>{moeda(item.previsto)}</span>
            {item.pago
              ? <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green, display: "flex", alignItems: "center", gap: 3 }}><IconCheck size={11} color={C.green} strokeWidth={2.5} /> paga</span>
              : item.aberta && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.purple }}>atualizando</span>}
            {onAbrirCartao && (
              <button onClick={() => onAbrirCartao(item.cartaoId)} style={{ border: "none", background: "transparent", color: C.accent, fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                {item.pago ? "ver cartão ›" : "ver / pagar ›"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Uma linha de item — a mesma nas duas visões (por categoria e por vencimento).
  function linha(item) {
    if (item.ehCartao) return linhaCartao(item);
    if (editandoId === item.id) {
      return (
        <div key={item.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
          <FormItem
            familiaId={familiaId} frentesGasto={frentesGasto} mesAtual={mes} item={item} valorDoMes={item.valorMes} vencimentoDoMes={item.vencimentoOutroMes}
            onSalvo={() => { setEditandoId(null); onAtualizado(); }}
            onCancelar={() => setEditandoId(null)}
          />
        </div>
      );
    }
    const f = frenteDe(item.categoria);
    const Icone = f.Icone;
    const salvandoEste = salvandoId === item.id;
    const painelAberto = painel && painel.id === item.id ? painel.modo : null;
    const textoValor = item.pago
      ? moeda(item.valorReal)
      : item.previsto != null ? `${item.aproximado ? "~" : ""}${moeda(item.previsto)}` : "definir valor";
    // Tocar no valor: item pago → ajusta o valor pago; variável → valor
    // do mês; fixo/de um mês só SEM valor → abre o editar (é lá que se
    // define); fixo com valor → nada a ajustar, fixo é fixo.
    const acaoValor = item.pago
      ? () => abrirPainel(item, MODO.AJUSTAR_PAGO)
      : item.tipo_valor === "variavel"
        ? () => abrirPainel(item, MODO.VALOR_MES)
        : item.previsto == null
          ? () => { fecharPainel(); setEditandoId(item.id); }
          : null;
    return (
      <div key={item.id} style={{ borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: item.pago ? C.greenSoft : f.corSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {item.pago ? (
            <IconCheck size={16} color={C.green} strokeWidth={2.3} />
          ) : f.emoji ? (
            <span style={{ fontSize: 16, lineHeight: 1 }}>{f.emoji}</span>
          ) : (
            Icone && <Icone size={16} color={f.cor} strokeWidth={1.9} />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>
            {item.nome}
            {item.vencidoAntes && <span style={{ marginLeft: 8, background: C.coralSoft || "#FDECEC", color: C.coralText, borderRadius: 100, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: "0.04em" }}>VENCIDO</span>}
          </div>
          {subtituloDe(item) && <div style={{ fontSize: 11, fontWeight: 600, color: item.vencidoAntes ? C.coralText : C.inkFaint }}>{subtituloDe(item)}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {/* Tocar no valor abre o ajuste rápido (ver `acaoValor`). Item
              fixo com valor não tem o que ajustar: vira texto puro. */}
          {acaoValor ? (
            <button
              type="button"
              onClick={acaoValor}
              style={{
                border: "none", background: "transparent", padding: 0, cursor: "pointer",
                fontSize: item.previsto == null && !item.pago ? 12.5 : 14, fontWeight: 800,
                color: item.pago ? C.green : item.aproximado ? C.inkMute : item.previsto == null ? C.accent : C.ink,
                textDecoration: "underline dotted", textUnderlineOffset: 3,
              }}
            >
              {textoValor}
            </button>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{textoValor}</span>
          )}
          {item.pago ? (
            <>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green, display: "flex", alignItems: "center", gap: 3 }}><IconCheck size={11} color={C.green} strokeWidth={2.5} /> pago</span>
              <button
                onClick={() => desmarcarPago(item)} disabled={salvandoEste}
                style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" }}
              >
                {salvandoEste ? "…" : "desmarcar"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => abrirPainel(item, MODO.PAGAR)} disabled={salvandoEste}
                style={{ border: `1.5px solid ${C.green}`, background: "transparent", color: C.green, fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: "3px 9px", borderRadius: 100, display: "flex", alignItems: "center", gap: 4 }}
              >
                <IconCheck size={11} color={C.green} strokeWidth={2.5} /> marcar pago
              </button>
              <button
                // Pré-preenche o lançamento só com valor CONFIRMADO (do mês ou
                // fixo) — o aproximado não vira lançamento por engano.
                onClick={() => onLancarAgora && onLancarAgora({ ...item, valor_preset: item.previsto != null && !item.aproximado ? item.previsto : "" })}
                style={{ border: "none", background: "transparent", color: C.accent, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 3 }}
              >
                <IconClock size={11} color={C.accent} strokeWidth={2.2} /> lançar agora
              </button>
            </>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 4 }}>
          <button onClick={() => { fecharPainel(); setEditandoId(item.id); }} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 11, cursor: "pointer" }}>editar</button>
          <button onClick={() => excluir(item.id)} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 11, cursor: "pointer" }}>excluir</button>
        </div>
      </div>
      {painelAberto && (
        <div style={{ padding: "0 0 12px 48px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, marginBottom: 6 }}>
            {painelAberto === MODO.VALOR_MES ? `Valor de ${nomeDoMes} (só neste mês)` : `Valor pago em ${nomeDoMes}`}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ ...campoInput, width: 104 }} type="number" step="0.01" min="0" inputMode="decimal"
              placeholder="0,00" value={valorInformado} autoFocus
              onChange={(e) => setValorInformado(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarPainel(item); } }}
            />
            <button
              onClick={() => confirmarPainel(item)} disabled={salvandoEste}
              style={{ padding: "8px 13px", borderRadius: 10, border: "none", background: painelAberto === MODO.VALOR_MES ? C.purple : C.green, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              {salvandoEste ? "Salvando…" : painelAberto === MODO.PAGAR ? "Confirmar pago" : painelAberto === MODO.VALOR_MES ? "Salvar valor" : "Salvar valor pago"}
            </button>
            <button onClick={fecharPainel} style={{ padding: "8px 11px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" }}>
              Cancelar
            </button>
          </div>
          {painelAberto === MODO.VALOR_MES && item.valorMes != null && (
            <button
              onClick={() => removerValorMes(item)} disabled={salvandoEste}
              style={{ marginTop: 8, border: "none", background: "transparent", color: C.accent, fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >
              Voltar ao valor aproximado
            </button>
          )}
        </div>
      )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>}

      <div style={{ background: C.purpleSoft, borderRadius: 22, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5B3FD9" }}>Planejamento · {nomeMes(mes)}</div>
          <input
            type="month" value={mes} onChange={(e) => { setMes(e.target.value); fecharPainel(); }}
            style={{ padding: "6px 10px", borderRadius: 9, border: "1.5px solid #5B3FD9", background: "#fff", color: "#5B3FD9", fontSize: 12.5, fontWeight: 700 }}
          />
        </div>
        {/* Pedido do Matheus (02/10/2026): o número em destaque é o PREVISTO do
            mês; o pago e o que falta ficam numa linha menor embaixo. */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#5B3FD9AA", marginTop: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Previsto pra este mês</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: "#5B3FD9", lineHeight: 1.1, marginTop: 2 }}>{moeda(totalPrevisto)}</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "#5B3FD9" }}>
          <span>Pago {moeda(totalPago)}</span>
          <span style={{ color: "#5B3FD9AA" }}>Falta {moeda(totalFalta)}</span>
        </div>
        {avisosTopo.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: "#5B3FD9AA" }}>{avisosTopo.join(" · ")}</div>
        )}
      </div>

      {onPerguntarCosmo && (
        <button
          onClick={() => onPerguntarCosmo(mes)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 12, border: `1.5px solid ${C.accent}`, background: C.accentSoft, color: C.accent, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
        >
          <IconCosmo size={16} color={C.accent} strokeWidth={1.9} /> Estratégia de pagamento com o COSMO
        </button>
      )}

      {!mostrarForm && (
        <button onClick={() => setMostrarForm(true)} style={{ padding: "13px 0", borderRadius: 12, border: "none", background: C.purple, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          + Novo item do planejamento
        </button>
      )}
      {mostrarForm && (
        <FormItem
          familiaId={familiaId} frentesGasto={frentesGasto} mesAtual={mes} valorDoMes={null}
          onSalvo={() => { setMostrarForm(false); onAtualizado(); }}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Chip ativo={visao === "categoria"} cor={C.purple} onClick={() => setVisao("categoria")}>Por categoria</Chip>
        <Chip ativo={visao === "vencimento"} cor={C.purple} onClick={() => setVisao("vencimento")}>Por vencimento</Chip>
      </div>
      {visao === "vencimento" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: -6 }}>
          <Chip ativo={filtroData === "tudo"} cor={C.accent} onClick={() => setFiltroData("tudo")}>Tudo</Chip>
          <Chip ativo={filtroData === "com"} cor={C.accent} onClick={() => setFiltroData("com")}>Com data</Chip>
          <Chip ativo={filtroData === "sem"} cor={C.accent} onClick={() => setFiltroData("sem")}>Sem data</Chip>
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "6px 16px" }}>
        {itensDoMes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>Nenhum item de planejamento pra {nomeMes(mes)} ainda.</div>}
        {visao === "vencimento" && itensDoMes.length > 0 && gruposVencimento.length === 0 && (
          <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>{filtroData === "sem" ? "Nenhum item sem data neste mês." : "Nenhum item com data de vencimento neste mês."}</div>
        )}
        {visao === "vencimento" && gruposVencimento.map((g) => (
          <div key={g.chave}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 0 4px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: g.cor }}>{g.titulo}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint }}>{g.pagos ? `${moeda(g.total)} pagos` : `${moeda(g.total)} a pagar`}</div>
            </div>
            {g.semData && (
              <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint, paddingBottom: 2 }}>Coisas sem vencimento fixo — você paga quando puder.</div>
            )}
            {g.itens.map(linha)}
          </div>
        ))}
        {visao === "categoria" && grupos.map((g) => {
          const fg = frenteDe(g.categoria);
          return (
        <div key={g.categoria}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 0 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: fg.cor }}>
              {fg.emoji ? <span style={{ fontSize: 14, lineHeight: 1 }}>{fg.emoji}</span> : fg.Icone && <fg.Icone size={14} color={fg.cor} strokeWidth={2} />}
              {fg.label}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint }}>{moeda(g.pago)} de {moeda(g.previsto)}</div>
          </div>
        {g.itens.map(linha)}
        </div>
          );
        })}
      </div>
    </div>
  );
}

// Subtítulo de cada linha. A categoria NÃO entra aqui — ela é o cabeçalho do
// grupo, acima das linhas (ver `grupos` no componente).
function subtituloDe(item) {
  if (item.ehCartao) {
    const p = [];
    if (item.dia_vencimento) p.push(`vence dia ${item.dia_vencimento}`);
    if (item.pago) p.push("fatura paga");
    else if (item.aberta) {
      const d = item.diasParaFechar;
      p.push(d === 0 ? "fecha hoje" : d === 1 ? "fecha amanhã" : `fecha dia ${item.diaFechamento}, em ${d} dias`);
      p.push("sobe a cada compra");
    } else if (item.fechaEm) p.push(`fechada dia ${item.diaFechamento}`);
    return p.join(" · ");
  }
  const partes = [];
  if (item.vencimentoOutroMes) {
    // Vencimento em OUTRO mês (ex: 28/09 numa conta de outubro): mostra a data completa.
    const [a, m, d] = item.vencimentoOutroMes.split("-");
    partes.push(`${item.pago ? "venceu" : item.vencidoAntes ? "VENCEU" : "vence"} ${d}/${m}/${a}`);
  } else if (item.dia_vencimento) partes.push(`vence dia ${item.dia_vencimento}`);
  if (item.recorrente) partes.push("todo mês");
  else if (item.mes_especifico) partes.push(`só em ${nomeMes(item.mes_especifico.slice(0, 7)).split(" ")[0]}`);
  if (!item.pago) {
    if (item.aproximado) partes.push("valor aproximado");
    else if (item.tipo_valor === "variavel" && item.previsto == null) partes.push("valor variável");
  } else if (item.previsto != null && Math.abs(item.valorReal - item.previsto) > 0.005) {
    // Pago diferente do planejado (juros, desconto): mostra o que estava previsto.
    partes.push(`previsto ${moeda(item.previsto)}`);
  }
  return partes.join(" · ");
}

// Formulário de criar/editar um item — nome, categoria, QUANDO aparece, valor
// e dia de vencimento.
//
// Quando aparece (pedido do Matheus, 02/10/2026: "nem tudo é recorrente, tem
// coisas exclusivas de outubro e de cada mês"): escolha bem visível no topo,
// "Todo mês" ou "Só em um mês" (com o mês). Item de um mês só tem UM campo de
// valor, opcional (não existe "outros meses" pra ele) e é gravado como fixo.
//
// Valor de item que aparece todo mês: "fixo" = um valor só, o de sempre
// (obrigatório) — "se é fixo, é fixo"; "variável" = muda todo mês, com um
// valor APROXIMADO opcional pros meses em que ainda não se sabe o real e, só
// aqui, o campo "Valor de <mês>": o valor específico do mês que está aberto na
// tela (migração 15), que vale só pra ele.
function FormItem({ familiaId, frentesGasto, mesAtual, item, valorDoMes, vencimentoDoMes, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(item?.nome || "");
  const [categoria, setCategoria] = useState(item?.categoria || frentesGasto[0]?.chave || "");
  const [tipoValor, setTipoValor] = useState(item?.tipo_valor || "fixo");
  const [valorFixo, setValorFixo] = useState(item?.valor_fixo != null ? String(item.valor_fixo) : "");
  const [valorMesStr, setValorMesStr] = useState(valorDoMes != null ? String(valorDoMes) : "");
  const [diaVencimento, setDiaVencimento] = useState(item?.dia_vencimento != null ? String(item.dia_vencimento) : "");
  const [recorrente, setRecorrente] = useState(item ? !!item.recorrente : true);
  const [mesEspecifico, setMesEspecifico] = useState(item?.mes_especifico ? item.mes_especifico.slice(0, 7) : mesAtual);
  // Mês do vencimento (migração 17): por padrão é o mês em edição; dá pra trocar
  // por um mês ANTERIOR — aí o item aparece como vencido e vira prioridade.
  const [mesVencEscolhido, setMesVencEscolhido] = useState(vencimentoDoMes ? vencimentoDoMes.slice(0, 7) : null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const rotuloMes = nomeMes(mesAtual);
  const refMes = recorrente ? mesAtual : mesEspecifico; // mês em que o item aparece
  const mesVenc = mesVencEscolhido && mesVencEscolhido < refMes ? mesVencEscolhido : refMes;
  const venceOutroMes = mesVenc !== refMes;
  const opcoesMesVenc = (() => {
    const [a, m] = (refMes || mesAtual).split("-").map(Number);
    const lista = [];
    for (let k = 0; k <= 6; k++) lista.push(new Date(Date.UTC(a, m - 1 - k, 1)).toISOString().slice(0, 7));
    if (mesVenc && !lista.includes(mesVenc)) lista.push(mesVenc);
    return lista;
  })();
  const rotuloMesVenc = (ym) => { const n = nomeMes(ym); return n.charAt(0).toUpperCase() + n.slice(1); };
  function trocarMesVenc(ym) {
    setMesVencEscolhido(ym === refMes ? null : ym);
    // Voltou pro mês padrão: o dia volta a ser o do próprio item (o do mês anterior era só daquele mês).
    if (ym === refMes && recorrente) setDiaVencimento(item?.diaDoItem != null ? String(item.diaDoItem) : "");
  }
  // "Valor de <mês>" só existe pra item variável que aparece todo mês.
  const usaValorDoMes = recorrente && tipoValor === "variavel";

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome pro item (ex: Aluguel, Água, Luz)."); return; }
    if (!recorrente && !mesEspecifico) { setErro("Escolha o mês desse item, ou troque pra \"Todo mês\"."); return; }
    if (recorrente && tipoValor === "fixo" && (!valorFixo || Number(valorFixo) <= 0)) { setErro("Informe o valor fixo, ou troque pra \"valor variável\"."); return; }
    if (valorFixo !== "" && lerValor(valorFixo) == null) { setErro(recorrente ? "O valor aproximado precisa ser um número válido." : "O valor precisa ser um número válido."); return; }
    if (usaValorDoMes && valorMesStr !== "" && lerValor(valorMesStr) == null) { setErro(`O valor de ${rotuloMes} precisa ser um número válido.`); return; }
    const diaNum = diaVencimento ? Number(diaVencimento) : null;
    if (diaNum != null && (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 31)) { setErro("O dia de vencimento precisa ser de 1 a 31."); return; }
    if (venceOutroMes && diaNum == null) { setErro(`Informe o dia do vencimento em ${rotuloMesVenc(mesVenc)}.`); return; }
    setSalvando(true);
    try {
      const payload = {
        familia_id: familiaId,
        nome: nome.trim(),
        categoria,
        // Item de um mês só é sempre "fixo" (um valor, ou ainda sem valor).
        tipo_valor: recorrente ? tipoValor : "fixo",
        // Fixo: o valor de sempre. Variável: o valor aproximado (opcional).
        // Um mês só: o valor do item (opcional).
        valor_fixo: valorFixo !== "" ? Number(valorFixo) : null,
        // Item que aparece todo mês e venceu em outro mês neste mês: o dia digitado é só
        // desse mês (vai pra planejamento_vencimentos_mes) — o dia de sempre do item não muda.
        dia_vencimento: recorrente && venceOutroMes ? (item?.diaDoItem ?? null) : diaNum,
        recorrente,
        mes_especifico: recorrente ? null : `${mesEspecifico}-01`,
      };
      let itemId = item?.id;
      if (item) {
        // `.select()` no update, de propósito — mesmo motivo de sempre (RLS
        // bloqueando um update aparece como sucesso com 0 linhas, sem isso).
        const { data, error } = await supabase.from("planejamento_itens").update(payload).eq("id", item.id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error(`"${nome}" não foi atualizado — o banco não confirmou nenhuma alteração.`);
      } else {
        const { data, error } = await supabase.from("planejamento_itens").insert(payload).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error(`"${nome}" não foi criado — o banco não confirmou nenhuma alteração.`);
        itemId = data[0].id;
      }

      // Valor específico do mês: só mexe se mudou. Preenchido → grava; esvaziado
      // (e existia) → remove, e o item volta ao valor padrão/aproximado. Se isso
      // falhar, o item já foi salvo — avisa e segue, em vez de travar o form
      // (tentar de novo duplicaria o item).
      let avisoMes = "";
      const antes = valorDoMes != null ? String(valorDoMes) : "";
      if (usaValorDoMes && valorMesStr !== antes) {
        try {
          if (valorMesStr !== "") {
            const { error } = await supabase
              .from("planejamento_valores_mes")
              .upsert({ familia_id: familiaId, item_id: itemId, mes: `${mesAtual}-01`, valor: Number(valorMesStr) }, { onConflict: "item_id,mes" })
              .select();
            if (error) throw new Error(mensagemTabelaFaltando(error, "planejamento_valores_mes", 15, "O item foi salvo, mas não consegui salvar o valor do mês"));
          } else {
            const { error } = await supabase.from("planejamento_valores_mes").delete().eq("item_id", itemId).eq("mes", `${mesAtual}-01`).select();
            if (error) throw new Error(mensagemTabelaFaltando(error, "planejamento_valores_mes", 15, "O item foi salvo, mas não consegui remover o valor do mês"));
          }
        } catch (e2) {
          avisoMes = e2.message;
        }
      }
      // Mês do vencimento: só mexe se mudou. Mês anterior → grava a data completa;
      // voltou pro padrão (e existia) → remove. Falhou: o item já foi salvo — avisa e segue.
      const antesVenc = vencimentoDoMes ? vencimentoDoMes.slice(0, 10) : null;
      let avisoVenc = "";
      try {
        if (venceOutroMes) {
          const [ay, am] = mesVenc.split("-").map(Number);
          const ultimo = new Date(Date.UTC(ay, am, 0)).getUTCDate();
          const novo = `${mesVenc}-${String(Math.min(diaNum, ultimo)).padStart(2, "0")}`;
          if (novo !== antesVenc) {
            const { data, error } = await supabase
              .from("planejamento_vencimentos_mes")
              .upsert({ familia_id: familiaId, item_id: itemId, mes: `${refMes}-01`, vencimento: novo }, { onConflict: "item_id,mes" })
              .select();
            if (error) throw new Error(mensagemTabelaFaltando(error, "planejamento_vencimentos_mes", 17, "O item foi salvo, mas não consegui salvar o mês do vencimento"));
            if (!data || data.length === 0) throw new Error("O item foi salvo, mas o banco não confirmou o mês do vencimento.");
          }
        } else if (antesVenc) {
          const { error } = await supabase.from("planejamento_vencimentos_mes").delete().eq("item_id", itemId).eq("mes", `${refMes}-01`).select();
          if (error) throw new Error(mensagemTabelaFaltando(error, "planejamento_vencimentos_mes", 17, "O item foi salvo, mas não consegui voltar o vencimento pro mês padrão"));
        }
      } catch (e3) {
        avisoVenc = e3.message;
      }
      onSalvo();
      if (avisoMes) alert(avisoMes);
      if (avisoVenc) alert(avisoVenc);
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ background: C.card, border: `1.5px solid ${C.purple}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {erro && <div style={{ color: C.danger, fontSize: 12.5 }}>{erro}</div>}

      <input style={campoInput} placeholder="Nome (ex: Aluguel, Água, Luz, Internet)" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />

      <div>
        <Label>Frente de gasto</Label>
        <select style={{ ...campoInput, width: "100%", marginTop: 4 }} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {frentesGasto.map((f) => <option key={f.chave} value={f.chave}>{f.label}</option>)}
        </select>
      </div>

      <div>
        <Label>Quando aparece</Label>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Chip ativo={recorrente} cor={C.purple} onClick={() => setRecorrente(true)}>Todo mês</Chip>
          <Chip ativo={!recorrente} cor={C.purple} onClick={() => setRecorrente(false)}>Só em um mês</Chip>
        </div>
        {!recorrente && (
          <div style={{ marginTop: 10 }}>
            <Label>Em qual mês</Label>
            <input style={{ ...campoInput, width: "100%", marginTop: 4 }} type="month" value={mesEspecifico} onChange={(e) => setMesEspecifico(e.target.value)} />
          </div>
        )}
      </div>

      {recorrente ? (
        <div>
          <Label>Valor</Label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <Chip ativo={tipoValor === "fixo"} cor={C.purple} onClick={() => setTipoValor("fixo")}>Fixo (sempre o mesmo)</Chip>
            <Chip ativo={tipoValor === "variavel"} cor={C.purple} onClick={() => setTipoValor("variavel")}>Variável (muda todo mês)</Chip>
          </div>
          <div style={{ marginTop: 10 }}>
            <Label>{tipoValor === "fixo" ? "Valor de sempre" : "Valor aproximado nos outros meses (opcional)"}</Label>
            <input style={{ ...campoInput, width: "100%", marginTop: 4 }} type="number" step="0.01" placeholder="0,00" value={valorFixo} onChange={(e) => setValorFixo(e.target.value)} />
            {tipoValor === "variavel" && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 4 }}>Um valor arredondado pros meses em que você ainda não sabe quanto vem. Aparece com "~" na lista.</div>
            )}
          </div>
          {usaValorDoMes && (
            <div style={{ marginTop: 10 }}>
              <Label>Valor de {rotuloMes} (opcional)</Label>
              <input style={{ ...campoInput, width: "100%", marginTop: 4 }} type="number" step="0.01" placeholder="0,00" value={valorMesStr} onChange={(e) => setValorMesStr(e.target.value)} />
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 4 }}>Se você já sabe quanto vem em {rotuloMes}, coloque aqui — vale só pra esse mês.</div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <Label>Valor (opcional)</Label>
          <input style={{ ...campoInput, width: "100%", marginTop: 4 }} type="number" step="0.01" placeholder="0,00" value={valorFixo} onChange={(e) => setValorFixo(e.target.value)} />
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 4 }}>Se ainda não sabe quanto vem, deixe em branco e defina depois.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 120px" }}>
          <Label>{recorrente && venceOutroMes ? `Dia (só em ${rotuloMesVenc(mesVenc).split(" ")[0]})` : "Dia de vencimento"}</Label>
          <input style={{ ...campoInput, width: "100%", marginTop: 4, boxSizing: "border-box" }} type="number" min={1} max={31} placeholder="ex: 10" value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} />
        </div>
        <div style={{ flex: "2 1 170px" }}>
          <Label>Mês do vencimento</Label>
          <select aria-label="Mês do vencimento" style={{ ...campoInput, width: "100%", marginTop: 4 }} value={mesVenc} onChange={(e) => trocarMesVenc(e.target.value)}>
            {opcoesMesVenc.map((ym) => <option key={ym} value={ym}>{rotuloMesVenc(ym)}{ym === refMes ? " (padrão)" : ""}</option>)}
          </select>
        </div>
        {venceOutroMes && (
          <div style={{ flexBasis: "100%", fontSize: 11.5, fontWeight: 700, color: C.coralText }}>
            Venceu em {rotuloMesVenc(mesVenc)}: o item aparece como VENCIDO e sobe como prioridade de pagamento{recorrente ? ` (só em ${rotuloMes}, os outros meses não mudam)` : ""}.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={salvando} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: C.purple, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" onClick={onCancelar} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 13, cursor: "pointer" }}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

const campoInput = { padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, boxSizing: "border-box" };

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</div>;
}

function Chip({ ativo, cor, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 12px", borderRadius: 100, fontSize: 12, fontWeight: 700, cursor: "pointer",
        border: `1.5px solid ${ativo ? cor : C.line}`,
        background: ativo ? cor : "#fff",
        color: ativo ? "#fff" : C.inkMute,
      }}
    >
      {children}
    </button>
  );
}
