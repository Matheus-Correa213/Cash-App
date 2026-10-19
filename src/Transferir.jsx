import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda } from "./theme.js";

// Transferência entre contas (migração 18, 19/10/2026) — pedido do Matheus:
// "preciso atualizar a forma de fazer transferência entre as contas no Correa
// Cash, hoje não temos essa opção."
//
// Transferência NÃO é gasto nem receita: o dinheiro só muda de conta. Por isso
// ela é gravada na tabela `transferencias` (e não em `lancamentos`) — nenhum
// total de gastos/receitas/categorias é afetado; só os saldos das duas contas
// (a RPC saldos_contas() soma o que entrou e subtrai o que saiu).
//
// Serve pra qualquer par de contas: banco → banco, banco → carteira (saque),
// carteira → banco (depósito), conta → poupança.

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Transferir({ membro, contas, onVoltar, onSalvo }) {
  const [saldos, setSaldos] = useState({});
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [origemId, setOrigemId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hojeISO());
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState("");

  const nomePorId = useMemo(() => Object.fromEntries(contas.map((c) => [c.id, c.nome])), [contas]);

  async function carregar() {
    const [{ data: s }, { data: h, error: eh }] = await Promise.all([
      supabase.rpc("saldos_contas"),
      supabase.from("transferencias").select("*").order("data", { ascending: false }).order("created_at", { ascending: false }).limit(30),
    ]);
    setSaldos(Object.fromEntries((s || []).map((r) => [r.conta_id, Number(r.saldo)])));
    if (eh) setErro(`Não consegui carregar as transferências (rodou a migração 18?): ${eh.message}`);
    setHistorico(h || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const saldoOrigem = origemId ? (saldos[origemId] ?? Number(contas.find((c) => c.id === origemId)?.saldo_inicial || 0)) : null;
  const valorNum = Number(valor);
  const faltaSaldo = saldoOrigem != null && valorNum > 0 && valorNum > saldoOrigem;

  function inverter() { setOrigemId(destinoId); setDestinoId(origemId); }

  async function transferir(e) {
    e.preventDefault();
    setErro(""); setFeito("");
    if (!origemId || !destinoId) { setErro("Escolha a conta de origem e a de destino."); return; }
    if (origemId === destinoId) { setErro("Origem e destino precisam ser contas diferentes."); return; }
    if (!(valorNum > 0)) { setErro("Informe um valor maior que zero."); return; }
    setSalvando(true);
    try {
      const { data: criada, error } = await supabase.from("transferencias").insert({
        familia_id: membro.familia_id, membro_id: membro.id,
        origem_conta_id: origemId, destino_conta_id: destinoId,
        valor: valorNum, data, descricao: descricao.trim() || null,
      }).select().single();
      if (error) throw error;
      if (!criada) throw new Error("A transferência não foi salva — o banco não confirmou.");
      setFeito(`Transferido ${moeda(valorNum)} de ${nomePorId[origemId]} para ${nomePorId[destinoId]}.`);
      setValor(""); setDescricao("");
      await carregar();
      onSalvo && onSalvo();
    } catch (e2) {
      setErro(e2.message || "Erro ao transferir.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(t) {
    if (!confirm(`Desfazer a transferência de ${moeda(t.valor)}? Os saldos das duas contas voltam ao que eram antes.`)) return;
    const { data: apagadas, error } = await supabase.from("transferencias").delete().eq("id", t.id).select();
    if (error) return alert(error.message);
    if (!apagadas || apagadas.length === 0) return alert("Essa transferência não foi desfeita — o banco não confirmou (só quem fez ou o administrador pode desfazer).");
    await carregar();
    onSalvo && onSalvo();
  }

  const seletor = { width: "100%", padding: "11px 12px", borderRadius: 10, border: `1.5px solid ${C.line}`, fontSize: 14, background: "#fff", boxSizing: "border-box" };
  const rotulo = { fontSize: 11.5, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 };

  function opcao(c) {
    const s = saldos[c.id];
    return <option key={c.id} value={c.id}>{c.nome}{c.titular ? ` (${c.titular})` : ""}{s != null ? ` — ${moeda(s)}` : ""}</option>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left", padding: 0 }}>‹ Voltar</button>}

      <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>Transferir entre contas</div>

      {contas.length < 2 ? (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, fontSize: 13.5, color: C.inkMute }}>
          Pra transferir você precisa de pelo menos duas contas cadastradas (em Mais → Contas e cartões).
        </div>
      ) : (
        <form onSubmit={transferir} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}
          {feito && <div style={{ color: C.greenTextAlt, fontSize: 13, fontWeight: 700 }}>✓ {feito}</div>}

          <div>
            <div style={rotulo}>Sai de</div>
            <select style={seletor} value={origemId} onChange={(e) => setOrigemId(e.target.value)}>
              <option value="">Escolha a conta de origem…</option>
              {contas.map(opcao)}
            </select>
          </div>

          <button type="button" onClick={inverter} disabled={!origemId && !destinoId} style={{ alignSelf: "center", border: `1px solid ${C.line}`, background: "#fff", color: C.inkMute, borderRadius: 100, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            ⇅ inverter
          </button>

          <div>
            <div style={rotulo}>Vai para</div>
            <select style={seletor} value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">Escolha a conta de destino…</option>
              {contas.filter((c) => c.id !== origemId).map(opcao)}
            </select>
          </div>

          <div>
            <div style={rotulo}>Valor</div>
            <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)}
              style={{ ...seletor, fontSize: 22, fontWeight: 800, color: C.ink }} />
            {faltaSaldo && (
              <div style={{ fontSize: 12, fontWeight: 600, color: C.coralText || C.danger, marginTop: 6 }}>
                Atenção: o saldo de {nomePorId[origemId]} é {moeda(saldoOrigem)} — essa transferência deixa a conta no negativo. Dá pra transferir mesmo assim.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input style={{ ...seletor, flex: "1 1 140px", width: "auto" }} type="date" value={data} onChange={(e) => setData(e.target.value)} />
            <input style={{ ...seletor, flex: "2 1 180px", width: "auto" }} placeholder="Observação (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>

          <button type="submit" disabled={salvando} style={{ padding: "13px 0", borderRadius: 12, border: "none", background: C.accent, color: "#fff", fontSize: 14.5, fontWeight: 800, cursor: "pointer" }}>
            {salvando ? "Transferindo…" : "Transferir"}
          </button>
        </form>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.inkFaint, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Transferências recentes</div>
        {carregando && <div style={{ fontSize: 13, color: C.inkFaint }}>Carregando…</div>}
        {!carregando && historico.length === 0 && <div style={{ fontSize: 13, color: C.inkFaint }}>Nenhuma transferência ainda.</div>}
        {historico.map((t) => {
          const podeDesfazer = membro.papel === "dono" || t.membro_id === membro.id;
          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{nomePorId[t.origem_conta_id] || "conta excluída"} → {nomePorId[t.destino_conta_id] || "conta excluída"}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{t.data}{t.descricao ? ` · ${t.descricao}` : ""}</div>
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{moeda(t.valor)}</span>
              {podeDesfazer && <button onClick={() => excluir(t)} style={{ border: "none", background: "transparent", color: C.danger, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>desfazer</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
