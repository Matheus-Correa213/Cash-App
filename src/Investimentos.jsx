import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C } from "./theme.js";

const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: "0.02em" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };
const lineItem = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${C.line}`, gap: 10 };
const statLabel = { fontSize: 12, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.06em" };
const statBig = { fontSize: 22, fontWeight: 700, color: C.ink };

function moeda(v) { return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`; }

const TIPOS = [
  ["renda_fixa", "Renda fixa"],
  ["renda_variavel", "Renda variável"],
];
const OBJETIVOS = [
  ["curto", "Curto prazo"],
  ["medio", "Médio prazo"],
  ["longo", "Longo prazo"],
];
const nomeObjetivo = (o) => OBJETIVOS.find((x) => x[0] === o)?.[1] || "—";
const nomeTipo = (t) => TIPOS.find((x) => x[0] === t)?.[1] || t;

// A tela de Investimentos segue o mesmo princípio do resto do Correa Cash:
// só o dono vê e mexe aqui (política "investimentos: so o dono ve e mexe" no
// banco) — é visão de patrimônio do casal, não de mesada. O objetivo (curto/
// médio/longo prazo) e a separação renda fixa x variável seguem direto o
// que já está no DOUTRINA-ECONOMICA-COSMO.md / MEGA-DOSSIE-COSMO-FINANCEIRO.md.
export default function Investimentos({ familiaId }) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const { data, error } = await supabase
        .from("investimentos").select("*").eq("familia_id", familiaId)
        .order("data_aporte", { ascending: false });
      if (error) throw error;
      setItens(data || []);
    } catch (e) {
      setErro(e.message || "Erro ao carregar investimentos.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, [familiaId]);

  async function excluir(id) {
    if (!confirm("Excluir este investimento?")) return;
    const { error } = await supabase.from("investimentos").delete().eq("id", id);
    if (error) return alert(error.message);
    carregar();
  }

  const totalAportado = useMemo(() => itens.reduce((s, i) => s + Number(i.valor_aportado), 0), [itens]);
  const totalAtual = useMemo(() => itens.reduce((s, i) => s + Number(i.valor_atual), 0), [itens]);
  const ganho = totalAtual - totalAportado;
  const ganhoPct = totalAportado > 0 ? (ganho / totalAportado) * 100 : 0;

  const porTipo = useMemo(() => {
    const m = {};
    for (const i of itens) {
      const t = i.tipo;
      m[t] = m[t] || { aportado: 0, atual: 0 };
      m[t].aportado += Number(i.valor_aportado);
      m[t].atual += Number(i.valor_atual);
    }
    return m;
  }, [itens]);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;

  return (
    <div>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}

      <div style={row}>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Total aportado</div>
          <div style={statBig}>{moeda(totalAportado)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Valor atual</div>
          <div style={statBig}>{moeda(totalAtual)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Ganho/perda</div>
          <div style={{ ...statBig, color: ganho >= 0 ? C.accent : C.danger }}>
            {ganho >= 0 ? "+" : ""}{moeda(ganho)} <span style={{ fontSize: 13, fontWeight: 600 }}>({ganhoPct.toFixed(1)}%)</span>
          </div>
        </div>
      </div>

      {Object.keys(porTipo).length > 0 && (
        <div style={cardStyle}>
          <div style={h2}>POR TIPO</div>
          {TIPOS.map(([v, l]) => porTipo[v] && (
            <div key={v} style={lineItem}>
              <span style={{ fontSize: 14, color: C.ink }}>{l}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
                {moeda(porTipo[v].atual)} <span style={{ color: C.inkFaint, fontWeight: 400 }}>(aportado {moeda(porTipo[v].aportado)})</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={cardStyle}>
        <div style={h2}>SEUS INVESTIMENTOS</div>
        {itens.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, marginBottom: 10 }}>Nenhum investimento cadastrado ainda.</div>}
        {itens.map((i) => {
          const g = Number(i.valor_atual) - Number(i.valor_aportado);
          return (
            <div key={i.id} style={lineItem}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{i.nome}</div>
                <div style={{ fontSize: 12, color: C.inkFaint }}>
                  {nomeTipo(i.tipo)}{i.subtipo ? ` · ${i.subtipo}` : ""}{i.instituicao ? ` · ${i.instituicao}` : ""} · {nomeObjetivo(i.objetivo)} · desde {i.data_aporte}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{moeda(i.valor_atual)}</span>
                <span style={{ fontSize: 12, color: g >= 0 ? C.accent : C.danger }}>{g >= 0 ? "+" : ""}{moeda(g)}</span>
                <button style={btnGhost} onClick={() => excluir(i.id)}>Excluir</button>
              </div>
            </div>
          );
        })}
        {!mostrarForm && <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => setMostrarForm(true)}>+ Adicionar investimento</button>}
        {mostrarForm && <NovoInvestimento familiaId={familiaId} onSalvo={() => { setMostrarForm(false); carregar(); }} onCancelar={() => setMostrarForm(false)} />}
      </div>
    </div>
  );
}

function NovoInvestimento({ familiaId, onSalvo, onCancelar }) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("renda_fixa");
  const [subtipo, setSubtipo] = useState("");
  const [instituicao, setInstituicao] = useState("");
  const [objetivo, setObjetivo] = useState("medio");
  const [valorAportado, setValorAportado] = useState("");
  const [valorAtual, setValorAtual] = useState("");
  const [dataAporte, setDataAporte] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!valorAportado || Number(valorAportado) < 0) { setErro("Informe o valor aportado."); return; }
    setSalvando(true);
    try {
      const { error } = await supabase.from("investimentos").insert({
        familia_id: familiaId,
        nome: nome.trim(),
        tipo,
        subtipo: subtipo.trim() || null,
        instituicao: instituicao.trim() || null,
        objetivo,
        valor_aportado: Number(valorAportado) || 0,
        valor_atual: valorAtual === "" ? Number(valorAportado) || 0 : Number(valorAtual),
        data_aporte: dataAporte,
      });
      if (error) throw error;
      onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
      {erro && <div style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      <div style={row}>
        <input style={input} placeholder="Nome (ex: Tesouro Selic, Ações XPTO)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <select style={input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={{ ...row, marginTop: 10 }}>
        <input style={input} placeholder="Subtipo (opcional, ex: CDB, Ações)" value={subtipo} onChange={(e) => setSubtipo(e.target.value)} />
        <input style={input} placeholder="Instituição (opcional)" value={instituicao} onChange={(e) => setInstituicao(e.target.value)} />
        <select style={input} value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
          {OBJETIVOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={{ ...row, marginTop: 10 }}>
        <input style={input} type="number" step="0.01" placeholder="Valor aportado" value={valorAportado} onChange={(e) => setValorAportado(e.target.value)} />
        <input style={input} type="number" step="0.01" placeholder="Valor atual (opcional, padrão = aportado)" value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} />
        <input style={input} type="date" value={dataAporte} onChange={(e) => setDataAporte(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar investimento"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
