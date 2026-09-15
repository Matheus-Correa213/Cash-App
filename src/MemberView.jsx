import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C } from "./theme.js";

const wrap = { padding: 18, maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 };
const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 };
const h2 = { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: "0.02em" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const statBig = { fontSize: 26, fontWeight: 700, color: C.ink };
const statLabel = { fontSize: 12, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.06em" };
const lineItem = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` };

const CATEGORIAS = ["mercado", "lazer", "transporte", "saude", "roupa", "outros"];

function moeda(v) { return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`; }
function inicioMesISO() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

export default function MemberView({ membro }) {
  const [lancamentos, setLancamentos] = useState([]);
  const [resumoFamilia, setResumoFamilia] = useState(null);
  const [resumoCategorias, setResumoCategorias] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const { data: lanc, error: e1 } = await supabase
        .from("lancamentos").select("*").eq("membro_id", membro.id)
        .order("data", { ascending: false }).limit(100);
      if (e1) throw e1;
      setLancamentos(lanc || []);

      if (membro.permissoes?.ver_saldo_geral) {
        const { data: r1 } = await supabase.rpc("resumo_familia_do_membro");
        setResumoFamilia(r1 || null);
      }
      if (membro.permissoes?.ver_resumo_categorias) {
        const { data: r2 } = await supabase.rpc("resumo_categorias_do_membro");
        setResumoCategorias(r2 || null);
      }
    } catch (e) {
      setErro(e.message || "Erro ao carregar seus dados.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  const doMes = useMemo(() => lancamentos.filter((l) => l.data >= inicioMesISO()), [lancamentos]);
  const gastoDoMes = useMemo(() => doMes.filter((l) => l.tipo === "gasto").reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const mesada = Number(membro.mesada_mensal || 0);
  const restante = mesada - gastoDoMes;

  return (
    <div style={wrap}>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}

      <div style={row}>
        <div style={{ ...cardStyle, flex: 1, minWidth: 130 }}>
          <div style={statLabel}>Sua mesada</div>
          <div style={statBig}>{moeda(mesada)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 130 }}>
          <div style={statLabel}>Já gastou</div>
          <div style={statBig}>{moeda(gastoDoMes)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 130 }}>
          <div style={statLabel}>Sobra</div>
          <div style={{ ...statBig, color: restante >= 0 ? C.accent : C.danger }}>{moeda(restante)}</div>
        </div>
      </div>

      {resumoFamilia?.permitido && (
        <div style={cardStyle}>
          <div style={h2}>SALDO GERAL DA FAMÍLIA (MÊS)</div>
          <div style={row}>
            <div style={{ flex: 1 }}><div style={statLabel}>Gastos</div><div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{moeda(resumoFamilia.total_gastos)}</div></div>
            <div style={{ flex: 1 }}><div style={statLabel}>Receitas</div><div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{moeda(resumoFamilia.total_receitas)}</div></div>
            <div style={{ flex: 1 }}><div style={statLabel}>Saldo</div><div style={{ fontSize: 18, fontWeight: 700, color: resumoFamilia.saldo >= 0 ? C.accent : C.danger }}>{moeda(resumoFamilia.saldo)}</div></div>
          </div>
        </div>
      )}

      {resumoCategorias?.permitido && Object.keys(resumoCategorias.categorias || {}).length > 0 && (
        <div style={cardStyle}>
          <div style={h2}>GASTOS DA FAMÍLIA POR CATEGORIA (MÊS)</div>
          {Object.entries(resumoCategorias.categorias).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
            <div key={cat} style={lineItem}>
              <span style={{ fontSize: 14, color: C.ink, textTransform: "capitalize" }}>{cat}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{moeda(val)}</span>
            </div>
          ))}
        </div>
      )}

      <NovoGasto membro={membro} onSalvo={carregar} />

      <div style={cardStyle}>
        <div style={h2}>SEUS LANÇAMENTOS</div>
        {carregando && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Carregando…</div>}
        {!carregando && lancamentos.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Você ainda não lançou nada.</div>}
        {lancamentos.slice(0, 30).map((l) => (
          <div key={l.id} style={lineItem}>
            <div>
              <div style={{ fontSize: 14, color: C.ink }}>{l.descricao || l.categoria} <span style={{ color: C.inkFaint, fontSize: 12 }}>· {l.data}</span></div>
              <div style={{ fontSize: 12, color: C.inkFaint, textTransform: "capitalize" }}>{l.categoria}</div>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: l.tipo === "gasto" ? C.danger : C.accent }}>{l.tipo === "gasto" ? "-" : "+"}{moeda(l.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NovoGasto({ membro, onSalvo }) {
  const [categoria, setCategoria] = useState("mercado");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!valor || Number(valor) <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    try {
      const { error } = await supabase.from("lancamentos").insert({
        familia_id: membro.familia_id,
        membro_id: membro.id,
        tipo: "gasto",
        categoria, valor: Number(valor), descricao: descricao.trim() || null, data,
      });
      if (error) throw error;
      setValor(""); setDescricao("");
      onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form style={cardStyle} onSubmit={salvar}>
      <div style={h2}>LANÇAR UM GASTO SEU</div>
      {erro && <div style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      <div style={row}>
        <select style={input} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input style={input} type="number" step="0.01" placeholder="Valor" value={valor} onChange={(e) => setValor(e.target.value)} />
        <input style={input} type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      <input style={{ ...input, display: "block", width: "100%", marginTop: 10 }} placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Lançar"}</button>
      </div>
    </form>
  );
}
