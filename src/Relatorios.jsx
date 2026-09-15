import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C } from "./theme.js";

const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: "0.02em" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const input = { padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "9px 14px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "9px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 13.5, cursor: "pointer" };
const lineItem = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` };
const statLabel = { fontSize: 12, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.06em" };
const statBig = { fontSize: 22, fontWeight: 700, color: C.ink };

function moeda(v) { return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`; }
function mesAtualStr() { return new Date().toISOString().slice(0, 7); } // "YYYY-MM"
function primeiroDiaDoMes(mesStr) { return `${mesStr}-01`; }
function primeiroDiaProximoMes(mesStr) {
  const [ano, mes] = mesStr.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes, 1)); // mes já é 1-based -> vira o mês seguinte
  return d.toISOString().slice(0, 10);
}

const ABAS = [
  ["categorias", "Categorias"],
  ["entradas-saidas", "Entradas x Saídas"],
  ["contas", "Contas"],
  ["tags", "Tags"],
];

// Relatórios do Correa Cash, em abas — segue o formato descrito no
// MEGA-DOSSIE-COSMO-FINANCEIRO.md ("relatórios em abas: Categorias /
// Entradas x Saídas / Contas / Tags"). As três primeiras abas olham um mês
// por vez (o casal decide o que aconteceu naquele mês); a de Tags é o
// contrário de propósito — um projeto como "Casamento" ou "TCC" atravessa
// vários meses, então ali o total é sempre desde o início.
export default function Relatorios({ familiaId }) {
  const [aba, setAba] = useState("categorias");
  const [mes, setMes] = useState(mesAtualStr());

  return (
    <div>
      <div style={{ ...row, marginBottom: 4 }}>
        {ABAS.map(([v, l]) => (
          <button key={v} style={aba === v ? btn : btnGhost} onClick={() => setAba(v)}>{l}</button>
        ))}
      </div>

      {aba !== "tags" && (
        <div style={{ margin: "12px 0" }}>
          <label style={{ fontSize: 12.5, color: C.inkMute, marginRight: 8 }}>Mês:</label>
          <input style={input} type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </div>
      )}

      {aba === "categorias" && <RelatorioCategorias familiaId={familiaId} mes={mes} />}
      {aba === "entradas-saidas" && <RelatorioEntradasSaidas familiaId={familiaId} mes={mes} />}
      {aba === "contas" && <RelatorioContas familiaId={familiaId} />}
      {aba === "tags" && <RelatorioTags familiaId={familiaId} />}
    </div>
  );
}

function useLancamentosDoMes(familiaId, mes) {
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true); setErro("");
      try {
        const { data, error } = await supabase
          .from("lancamentos").select("*").eq("familia_id", familiaId)
          .gte("data", primeiroDiaDoMes(mes)).lt("data", primeiroDiaProximoMes(mes))
          .order("data", { ascending: false });
        if (error) throw error;
        if (!cancelado) setLancamentos(data || []);
      } catch (e) {
        if (!cancelado) setErro(e.message || "Erro ao carregar lançamentos do mês.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [familiaId, mes]);

  return { lancamentos, carregando, erro };
}

function RelatorioCategorias({ familiaId, mes }) {
  const { lancamentos, carregando, erro } = useLancamentosDoMes(familiaId, mes);
  const porCategoria = useMemo(() => {
    const m = {};
    for (const l of lancamentos) if (l.tipo === "gasto") m[l.categoria] = (m[l.categoria] || 0) + Number(l.valor);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [lancamentos]);
  const total = porCategoria.reduce((s, [, v]) => s + v, 0);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div style={cardStyle}>
      {erro && <div style={{ color: C.danger, marginBottom: 10 }}>{erro}</div>}
      <div style={h2}>GASTOS POR CATEGORIA</div>
      {porCategoria.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhum gasto neste mês.</div>}
      {porCategoria.map(([cat, val]) => (
        <div key={cat} style={lineItem}>
          <span style={{ fontSize: 14, color: C.ink, textTransform: "capitalize" }}>{cat}</span>
          <span style={{ fontSize: 14, color: C.ink }}>
            <b>{moeda(val)}</b> <span style={{ color: C.inkFaint, fontSize: 12 }}>({total > 0 ? ((val / total) * 100).toFixed(0) : 0}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function RelatorioEntradasSaidas({ familiaId, mes }) {
  const { lancamentos, carregando, erro } = useLancamentosDoMes(familiaId, mes);
  const receitas = useMemo(() => lancamentos.filter((l) => l.tipo === "receita"), [lancamentos]);
  const gastos = useMemo(() => lancamentos.filter((l) => l.tipo === "gasto"), [lancamentos]);
  const totalReceitas = receitas.reduce((s, l) => s + Number(l.valor), 0);
  const totalGastos = gastos.reduce((s, l) => s + Number(l.valor), 0);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}
      <div style={row}>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Entradas</div>
          <div style={{ ...statBig, color: C.accent }}>{moeda(totalReceitas)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Saídas</div>
          <div style={{ ...statBig, color: C.danger }}>{moeda(totalGastos)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Saldo</div>
          <div style={{ ...statBig, color: totalReceitas - totalGastos >= 0 ? C.accent : C.danger }}>{moeda(totalReceitas - totalGastos)}</div>
        </div>
      </div>
      <div style={cardStyle}>
        <div style={h2}>LANÇAMENTOS DO MÊS</div>
        {lancamentos.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nada lançado neste mês.</div>}
        {lancamentos.map((l) => (
          <div key={l.id} style={lineItem}>
            <span style={{ fontSize: 14, color: C.ink }}>{l.descricao || l.categoria} <span style={{ color: C.inkFaint, fontSize: 12 }}>· {l.data}</span></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: l.tipo === "gasto" ? C.danger : C.accent }}>{l.tipo === "gasto" ? "-" : "+"}{moeda(l.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelatorioContas({ familiaId }) {
  const [contas, setContas] = useState([]);
  const [saldos, setSaldos] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true); setErro("");
      try {
        const [{ data: c, error: e1 }, { data: s, error: e2 }] = await Promise.all([
          supabase.from("contas").select("*").eq("familia_id", familiaId).order("nome"),
          supabase.rpc("saldos_contas"),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (!cancelado) {
          setContas(c || []);
          setSaldos(Object.fromEntries((s || []).map((r) => [r.conta_id, r.saldo])));
        }
      } catch (e) {
        if (!cancelado) setErro(e.message || "Erro ao carregar contas.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [familiaId]);

  const totalGeral = Object.values(saldos).reduce((s, v) => s + Number(v), 0);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div style={cardStyle}>
      {erro && <div style={{ color: C.danger, marginBottom: 10 }}>{erro}</div>}
      <div style={h2}>SALDO POR CONTA</div>
      {contas.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhuma conta cadastrada ainda.</div>}
      {contas.map((c) => (
        <div key={c.id} style={lineItem}>
          <span style={{ fontSize: 14, color: C.ink }}>{c.nome}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{moeda(saldos[c.id] ?? c.saldo_inicial)}</span>
        </div>
      ))}
      {contas.length > 0 && (
        <div style={{ ...lineItem, borderBottom: "none", marginTop: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Total</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{moeda(totalGeral)}</span>
        </div>
      )}
    </div>
  );
}

function RelatorioTags({ familiaId }) {
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true); setErro("");
      try {
        // Tags são projetos que atravessam meses (ex: "Casamento", "TCC") — por
        // isso aqui é o total desde sempre, sem filtro de mês, diferente das
        // outras abas.
        const { data, error } = await supabase
          .from("lancamentos").select("tipo, valor, tag").eq("familia_id", familiaId)
          .not("tag", "is", null);
        if (error) throw error;
        if (!cancelado) setLancamentos((data || []).filter((l) => l.tag && l.tag.trim() !== ""));
      } catch (e) {
        if (!cancelado) setErro(e.message || "Erro ao carregar tags.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [familiaId]);

  const porTag = useMemo(() => {
    const m = {};
    for (const l of lancamentos) {
      const t = l.tag.trim();
      m[t] = m[t] || { gastos: 0, receitas: 0 };
      if (l.tipo === "gasto") m[t].gastos += Number(l.valor);
      else m[t].receitas += Number(l.valor);
    }
    return Object.entries(m).sort((a, b) => (b[1].gastos - b[1].receitas) - (a[1].gastos - a[1].receitas));
  }, [lancamentos]);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div style={cardStyle}>
      {erro && <div style={{ color: C.danger, marginBottom: 10 }}>{erro}</div>}
      <div style={h2}>POR TAG (TOTAL DESDE SEMPRE)</div>
      {porTag.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhum lançamento com tag ainda. Use tags livres (ex: "Casamento", "TCC") para acompanhar um projeto específico ao lançar um gasto ou receita.</div>}
      {porTag.map(([tag, v]) => (
        <div key={tag} style={lineItem}>
          <span style={{ fontSize: 14, color: C.ink }}>{tag}</span>
          <span style={{ fontSize: 14, color: C.ink }}>
            <span style={{ color: C.danger, fontWeight: 600 }}>-{moeda(v.gastos)}</span>
            {v.receitas > 0 && <span style={{ color: C.accent, fontWeight: 600, marginLeft: 8 }}>+{moeda(v.receitas)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
