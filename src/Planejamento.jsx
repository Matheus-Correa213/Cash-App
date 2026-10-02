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
// "Pago" é uma MARCAÇÃO MANUAL, feita aqui na lista, por item e por mês
// (migração 14, 02/10/2026 — pedido do Matheus depois de um bug real). Antes
// (migração 12) o "pago" era deduzido batendo categoria + mês contra os
// lançamentos; como vários itens usam a mesma categoria (ex: "Boletos
// Recorrentes" com Parcela do Empréstimo, Parcela do Cartão e Internet), um
// único lançamento de R$ 183,25 marcava os três como pagos, todos com o mesmo
// valor. Decisão dele: "vamos deixar o pago como um item para marcar fora do
// lançamento, na tela que fica a lista do planejamento — aí evita erros."
//
// Por isso: uma linha em planejamento_pagamentos (item_id + mes) = pago
// naquele mês; sem linha = em aberto. Lançar o gasto de verdade (botão
// "lançar agora", Gastos, chat do COSMO) NÃO marca nada sozinho, e marcar
// como pago NÃO cria lançamento — são duas coisas separadas de propósito.
// Item fixo grava o valor_fixo do momento da marcação; item variável pede o
// valor do mês na hora de marcar.

export default function Planejamento({ familiaId, itens, pagamentos, frentesGasto, onAtualizado, onLancarAgora, onVoltar }) {
  const [mes, setMes] = useState(mesAtualISO());
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  // Item variável sendo marcado como pago: mostra o campo de valor embaixo
  // da linha antes de gravar.
  const [pagandoId, setPagandoId] = useState(null);
  const [valorInformado, setValorInformado] = useState("");
  const [salvandoPagId, setSalvandoPagId] = useState(null);

  const itensDoMes = useMemo(() => {
    const pagamentoPorItem = new Map(
      (pagamentos || []).filter((p) => p.mes.slice(0, 7) === mes).map((p) => [p.item_id, p])
    );
    return itens
      .filter((i) => i.recorrente || (i.mes_especifico && i.mes_especifico.slice(0, 7) === mes))
      .map((i) => {
        const pagamento = pagamentoPorItem.get(i.id);
        return { ...i, pago: !!pagamento, valorReal: pagamento ? Number(pagamento.valor_pago) : 0 };
      })
      .sort((a, b) => {
        if (a.pago !== b.pago) return a.pago ? 1 : -1;
        const da = a.dia_vencimento ?? 99, db = b.dia_vencimento ?? 99;
        return da - db;
      });
  }, [itens, pagamentos, mes]);

  const totalPrevisto = itensDoMes.reduce((s, i) => s + (i.pago ? i.valorReal : Number(i.valor_fixo || 0)), 0);
  const totalPago = itensDoMes.filter((i) => i.pago).reduce((s, i) => s + i.valorReal, 0);

  function frenteDe(categoria) {
    return frentesGasto.find((f) => f.chave === categoria) || { chave: categoria, label: categoria, cor: C.inkMute, corSoft: C.line, Icone: null, emoji: null };
  }

  // Grava "pago" pra (item, mês escolhido). upsert em (item_id, mes) — tocar
  // duas vezes seguidas não duplica nem dá erro. `.select()` + checagem de
  // linhas pelo mesmo motivo de sempre (RLS barrando vira "sucesso" com 0
  // linhas).
  async function gravarPago(item, valor) {
    setSalvandoPagId(item.id);
    try {
      const { data, error } = await supabase
        .from("planejamento_pagamentos")
        .upsert({ familia_id: familiaId, item_id: item.id, mes: `${mes}-01`, valor_pago: valor }, { onConflict: "item_id,mes" })
        .select();
      if (error) {
        const faltaMigracao = /planejamento_pagamentos|relation|does not exist|schema cache/i.test(error.message || "");
        throw new Error(faltaMigracao ? "Não consegui marcar como pago — rode a migração 14 no Supabase (supabase-migracao-14-planejamento-pagamentos.sql)." : error.message);
      }
      if (!data || data.length === 0) throw new Error(`"${item.nome}" não foi marcado como pago — o banco não confirmou nenhuma alteração.`);
      setPagandoId(null);
      setValorInformado("");
      onAtualizado();
    } catch (e) {
      alert(e.message || "Erro ao marcar como pago.");
    } finally {
      setSalvandoPagId(null);
    }
  }

  function marcarPago(item) {
    if (item.tipo_valor === "fixo") return gravarPago(item, Number(item.valor_fixo || 0));
    // Variável: o valor muda todo mês, então pergunta antes de gravar.
    setPagandoId(item.id);
    setValorInformado("");
  }

  async function confirmarValorVariavel(item) {
    const valor = Number(String(valorInformado).replace(",", "."));
    if (!valorInformado || !Number.isFinite(valor) || valor < 0) return alert("Informe o valor pago neste mês.");
    await gravarPago(item, valor);
  }

  async function desmarcarPago(item) {
    setSalvandoPagId(item.id);
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
      setSalvandoPagId(null);
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
            type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 9, border: "1.5px solid #5B3FD9", background: "#fff", color: "#5B3FD9", fontSize: 12.5, fontWeight: 700 }}
          />
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: "#5B3FD9", marginTop: 4 }}>{moeda(totalPago)} <span style={{ fontSize: 15, fontWeight: 700, color: "#5B3FD9AA" }}>de {moeda(totalPrevisto)}</span></div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5B3FD9", marginTop: 2 }}>pago até agora, do previsto pra este mês</div>
      </div>

      {!mostrarForm && (
        <button onClick={() => setMostrarForm(true)} style={{ padding: "13px 0", borderRadius: 12, border: "none", background: C.purple, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          + Novo item do planejamento
        </button>
      )}
      {mostrarForm && (
        <FormItem
          familiaId={familiaId} frentesGasto={frentesGasto} mesAtual={mes}
          onSalvo={() => { setMostrarForm(false); onAtualizado(); }}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "6px 16px" }}>
        {itensDoMes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>Nenhum item de planejamento pra {nomeMes(mes)} ainda.</div>}
        {itensDoMes.map((item) => {
          if (editandoId === item.id) {
            return (
              <div key={item.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
                <FormItem
                  familiaId={familiaId} frentesGasto={frentesGasto} mesAtual={mes} item={item}
                  onSalvo={() => { setEditandoId(null); onAtualizado(); }}
                  onCancelar={() => setEditandoId(null)}
                />
              </div>
            );
          }
          const f = frenteDe(item.categoria);
          const Icone = f.Icone;
          const salvandoEste = salvandoPagId === item.id;
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
                <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>
                  {f.label}{item.dia_vencimento ? ` · vence dia ${item.dia_vencimento}` : ""}{item.recorrente ? " · todo mês" : ""}
                  {item.tipo_valor === "variavel" && !item.pago ? " · valor variável" : ""}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: item.pago ? C.green : C.ink }}>
                  {item.pago ? moeda(item.valorReal) : (item.tipo_valor === "fixo" ? moeda(item.valor_fixo) : "em aberto")}
                </span>
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
                      onClick={() => marcarPago(item)} disabled={salvandoEste}
                      style={{ border: `1.5px solid ${C.green}`, background: "transparent", color: C.green, fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: "3px 9px", borderRadius: 100, display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <IconCheck size={11} color={C.green} strokeWidth={2.5} /> {salvandoEste ? "…" : "marcar pago"}
                    </button>
                    <button
                      onClick={() => onLancarAgora && onLancarAgora(item)}
                      style={{ border: "none", background: "transparent", color: C.accent, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 3 }}
                    >
                      <IconClock size={11} color={C.accent} strokeWidth={2.2} /> lançar agora
                    </button>
                  </>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 4 }}>
                <button onClick={() => setEditandoId(item.id)} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 11, cursor: "pointer" }}>editar</button>
                <button onClick={() => excluir(item.id)} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 11, cursor: "pointer" }}>excluir</button>
              </div>
            </div>
            {pagandoId === item.id && !item.pago && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 12px 48px", flexWrap: "wrap" }}>
                <input
                  style={{ ...campoInput, width: 130 }} type="number" step="0.01" min="0" inputMode="decimal"
                  placeholder={`Valor de ${nomeMes(mes).split(" ")[0]}`} value={valorInformado} autoFocus
                  onChange={(e) => setValorInformado(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmarValorVariavel(item); } }}
                />
                <button onClick={() => confirmarValorVariavel(item)} disabled={salvandoEste} style={{ padding: "8px 13px", borderRadius: 10, border: "none", background: C.green, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                  {salvandoEste ? "Salvando…" : "Confirmar pago"}
                </button>
                <button onClick={() => { setPagandoId(null); setValorInformado(""); }} style={{ padding: "8px 11px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" }}>
                  Cancelar
                </button>
              </div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Formulário de criar/editar um item — nome, categoria, se o valor é fixo ou
// variável (água/luz mudam todo mês; aluguel/assinatura não), dia de
// vencimento, e se é recorrente (aparece em TODOS os meses) ou de um mês
// específico só.
function FormItem({ familiaId, frentesGasto, mesAtual, item, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(item?.nome || "");
  const [categoria, setCategoria] = useState(item?.categoria || frentesGasto[0]?.chave || "");
  const [tipoValor, setTipoValor] = useState(item?.tipo_valor || "fixo");
  const [valorFixo, setValorFixo] = useState(item?.valor_fixo != null ? String(item.valor_fixo) : "");
  const [diaVencimento, setDiaVencimento] = useState(item?.dia_vencimento != null ? String(item.dia_vencimento) : "");
  const [recorrente, setRecorrente] = useState(item ? !!item.recorrente : true);
  const [mesEspecifico, setMesEspecifico] = useState(item?.mes_especifico ? item.mes_especifico.slice(0, 7) : mesAtual);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome pro item (ex: Aluguel, Água, Luz)."); return; }
    if (tipoValor === "fixo" && (!valorFixo || Number(valorFixo) <= 0)) { setErro("Informe o valor fixo, ou troque pra \"valor variável\"."); return; }
    if (!recorrente && !mesEspecifico) { setErro("Escolha o mês desse item, ou marque como recorrente."); return; }
    setSalvando(true);
    try {
      const payload = {
        familia_id: familiaId,
        nome: nome.trim(),
        categoria,
        tipo_valor: tipoValor,
        valor_fixo: tipoValor === "fixo" ? Number(valorFixo) : null,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        recorrente,
        mes_especifico: recorrente ? null : `${mesEspecifico}-01`,
      };
      if (item) {
        // `.select()` no update, de propósito — mesmo motivo de sempre (RLS
        // bloqueando um update aparece como sucesso com 0 linhas, sem isso).
        const { data, error } = await supabase.from("planejamento_itens").update(payload).eq("id", item.id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error(`"${nome}" não foi atualizado — o banco não confirmou nenhuma alteração.`);
      } else {
        const { error } = await supabase.from("planejamento_itens").insert(payload);
        if (error) throw error;
      }
      onSalvo();
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
        {tipoValor === "fixo" && (
          <input style={{ ...campoInput, width: "100%", marginTop: 8 }} type="number" step="0.01" placeholder="0,00" value={valorFixo} onChange={(e) => setValorFixo(e.target.value)} />
        )}
        {tipoValor === "variavel" && (
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 6 }}>Sem valor fixo — quando você marcar o item como pago, o app pergunta o valor daquele mês.</div>
        )}
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
