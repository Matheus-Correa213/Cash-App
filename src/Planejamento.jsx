import React, { useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda, mesAtualISO, nomeMes } from "./theme.js";
import { IconCheck, IconClock } from "./Icons.jsx";

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

export default function Planejamento({ familiaId, itens, pagamentos, valoresMes, frentesGasto, onAtualizado, onLancarAgora, onVoltar }) {
  const [mes, setMes] = useState(mesAtualISO());
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  // Ajuste rápido aberto embaixo de uma linha: { id, modo }.
  const [painel, setPainel] = useState(null);
  const [valorInformado, setValorInformado] = useState("");
  const [salvandoId, setSalvandoId] = useState(null);

  const itensDoMes = useMemo(() => {
    const pagamentoPorItem = new Map(
      (pagamentos || []).filter((p) => p.mes.slice(0, 7) === mes).map((p) => [p.item_id, p])
    );
    const valorMesPorItem = new Map(
      (valoresMes || []).filter((v) => v.mes.slice(0, 7) === mes).map((v) => [v.item_id, Number(v.valor)])
    );
    return itens
      .filter((i) => i.recorrente || (i.mes_especifico && i.mes_especifico.slice(0, 7) === mes))
      .map((i) => {
        const pagamento = pagamentoPorItem.get(i.id);
        const valorMes = valorMesPorItem.has(i.id) ? valorMesPorItem.get(i.id) : null;
        const padrao = i.valor_fixo != null ? Number(i.valor_fixo) : null;
        const previsto = valorMes != null ? valorMes : padrao; // null = sem valor nenhum
        const valorReal = pagamento ? Number(pagamento.valor_pago) : 0;
        return {
          ...i,
          pago: !!pagamento,
          valorReal,
          valorMes,
          previsto,
          // Aproximado = item variável usando só o valor padrão (nenhum valor do mês).
          aproximado: valorMes == null && i.tipo_valor === "variavel" && padrao != null,
          // O que entra na soma do previsto: o planejado; sem planejado mas já
          // pago, o próprio pago (o previsto nunca fica abaixo do que já saiu).
          previstoSoma: previsto != null ? previsto : valorReal,
        };
      })
      .sort((a, b) => {
        if (a.pago !== b.pago) return a.pago ? 1 : -1;
        const da = a.dia_vencimento ?? 99, db = b.dia_vencimento ?? 99;
        return da - db;
      });
  }, [itens, pagamentos, valoresMes, mes]);

  const totalPrevisto = itensDoMes.reduce((s, i) => s + i.previstoSoma, 0);
  const totalPago = itensDoMes.filter((i) => i.pago).reduce((s, i) => s + i.valorReal, 0);
  const totalFalta = itensDoMes.filter((i) => !i.pago).reduce((s, i) => s + i.previstoSoma, 0);
  const nAproximados = itensDoMes.filter((i) => !i.pago && i.aproximado).length;
  const nSemValor = itensDoMes.filter((i) => !i.pago && i.previsto == null).length;
  const avisosTopo = [];
  if (nAproximados) avisosTopo.push(`inclui ${nAproximados} ${nAproximados === 1 ? "valor aproximado" : "valores aproximados"}`);
  if (nSemValor) avisosTopo.push(`${nSemValor} ${nSemValor === 1 ? "item sem valor" : "itens sem valor"} (fora da soma)`);

  function frenteDe(categoria) {
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

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "6px 16px" }}>
        {itensDoMes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>Nenhum item de planejamento pra {nomeMes(mes)} ainda.</div>}
        {grupos.map((g) => {
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
        {g.itens.map((item) => {
          if (editandoId === item.id) {
            return (
              <div key={item.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
                <FormItem
                  familiaId={familiaId} frentesGasto={frentesGasto} mesAtual={mes} item={item} valorDoMes={item.valorMes}
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
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{item.nome}</div>
                {subtituloDe(item) && <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{subtituloDe(item)}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                {/* Tocar no valor abre o ajuste rápido: valor do mês (item em
                    aberto) ou valor pago (item já pago). */}
                <button
                  type="button"
                  onClick={() => abrirPainel(item, item.pago ? MODO.AJUSTAR_PAGO : MODO.VALOR_MES)}
                  style={{
                    border: "none", background: "transparent", padding: 0, cursor: "pointer",
                    fontSize: item.previsto == null && !item.pago ? 12.5 : 14, fontWeight: 800,
                    color: item.pago ? C.green : item.aproximado ? C.inkMute : item.previsto == null ? C.accent : C.ink,
                    textDecoration: "underline dotted", textUnderlineOffset: 3,
                  }}
                >
                  {textoValor}
                </button>
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
                    {item.tipo_valor === "variavel" ? "Voltar ao valor aproximado" : "Voltar ao valor de sempre"}
                  </button>
                )}
              </div>
            )}
            </div>
          );
        })}
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
  const partes = [];
  if (item.dia_vencimento) partes.push(`vence dia ${item.dia_vencimento}`);
  if (item.recorrente) partes.push("todo mês");
  if (!item.pago) {
    if (item.aproximado) partes.push("valor aproximado");
    else if (item.tipo_valor === "variavel" && item.previsto == null) partes.push("valor variável");
  } else if (item.previsto != null && Math.abs(item.valorReal - item.previsto) > 0.005) {
    // Pago diferente do planejado (juros, desconto): mostra o que estava previsto.
    partes.push(`previsto ${moeda(item.previsto)}`);
  }
  return partes.join(" · ");
}

// Formulário de criar/editar um item — nome, categoria, valor, dia de
// vencimento, e se é recorrente (aparece em TODOS os meses) ou de um mês
// específico só.
//
// Valor (migração 15): "fixo" = o valor de sempre (obrigatório); "variável" =
// muda todo mês, com um valor APROXIMADO opcional pros meses em que ainda não
// se sabe o real. Nos dois casos, o campo "Valor de <mês>" é o valor específico
// do mês que está aberto na tela (opcional) — vale só pra ele.
function FormItem({ familiaId, frentesGasto, mesAtual, item, valorDoMes, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(item?.nome || "");
  const [categoria, setCategoria] = useState(item?.categoria || frentesGasto[0]?.chave || "");
  const [tipoValor, setTipoValor] = useState(item?.tipo_valor || "fixo");
  const [valorFixo, setValorFixo] = useState(item?.valor_fixo != null ? String(item.valor_fixo) : "");
  const [valorMesStr, setValorMesStr] = useState(valorDoMes != null ? String(valorDoMes) : "");
  const [diaVencimento, setDiaVencimento] = useState(item?.dia_vencimento != null ? String(item.dia_vencimento) : "");
  const [recorrente, setRecorrente] = useState(item ? !!item.recorrente : true);
  const [mesEspecifico, setMesEspecifico] = useState(item?.mes_especifico ? item.mes_especifico.slice(0, 7) : mesAtual);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const rotuloMes = nomeMes(mesAtual);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome pro item (ex: Aluguel, Água, Luz)."); return; }
    if (tipoValor === "fixo" && (!valorFixo || Number(valorFixo) <= 0)) { setErro("Informe o valor fixo, ou troque pra \"valor variável\"."); return; }
    if (tipoValor === "variavel" && valorFixo !== "" && lerValor(valorFixo) == null) { setErro("O valor aproximado precisa ser um número válido."); return; }
    if (valorMesStr !== "" && lerValor(valorMesStr) == null) { setErro(`O valor de ${rotuloMes} precisa ser um número válido.`); return; }
    if (!recorrente && !mesEspecifico) { setErro("Escolha o mês desse item, ou marque como recorrente."); return; }
    setSalvando(true);
    try {
      const payload = {
        familia_id: familiaId,
        nome: nome.trim(),
        categoria,
        tipo_valor: tipoValor,
        // Fixo: o valor de sempre. Variável: o valor aproximado (opcional).
        valor_fixo: valorFixo !== "" ? Number(valorFixo) : null,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
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
      if (valorMesStr !== antes) {
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
      onSalvo();
      if (avisoMes) alert(avisoMes);
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
        <div style={{ marginTop: 10 }}>
          <Label>Valor de {rotuloMes} (opcional)</Label>
          <input style={{ ...campoInput, width: "100%", marginTop: 4 }} type="number" step="0.01" placeholder="0,00" value={valorMesStr} onChange={(e) => setValorMesStr(e.target.value)} />
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 4 }}>
            {tipoValor === "variavel"
              ? `Se você já sabe quanto vem em ${rotuloMes}, coloque aqui — vale só pra esse mês.`
              : `Só preencha se em ${rotuloMes} o valor for diferente do de sempre.`}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 140px" }}>
          <Label>Dia de vencimento</Label>
          <input style={{ ...campoInput, width: "100%", marginTop: 4, boxSizing: "border-box" }} type="number" min={1} max={31} placeholder="ex: 10" value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: C.ink, cursor: "pointer" }}>
        <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} />
        Recorrente — aparece todo mês
      </label>

      {!recorrente && (
        <div>
          <Label>Em qual mês esse item aparece</Label>
          <input style={{ ...campoInput, marginTop: 4 }} type="month" value={mesEspecifico} onChange={(e) => setMesEspecifico(e.target.value)} />
        </div>
      )}

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
