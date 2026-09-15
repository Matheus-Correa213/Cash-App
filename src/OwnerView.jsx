import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C } from "./AuthGate.jsx";

const wrap = { padding: 18, maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 };
const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 };
const h2 = { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: "0.02em" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const select = { ...input };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };
const statBig = { fontSize: 26, fontWeight: 700, color: C.ink };
const statLabel = { fontSize: 12, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.06em" };
const lineItem = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` };

const CATEGORIAS = ["mercado", "casa", "lazer", "transporte", "saude", "mesada", "contas", "outros"];

function moeda(v) { return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`; }
function inicioMesISO() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

export default function OwnerView({ membro, onMembroAtualizado }) {
  const [lancamentos, setLancamentos] = useState([]);
  const [membros, setMembros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("visao"); // visao | membros

  async function carregarTudo() {
    setCarregando(true); setErro("");
    try {
      const [{ data: lanc, error: e1 }, { data: memb, error: e2 }] = await Promise.all([
        supabase.from("lancamentos").select("*").order("data", { ascending: false }).order("created_at", { ascending: false }).limit(200),
        supabase.from("membros").select("*").eq("familia_id", membro.familia_id).order("papel", { ascending: false }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setLancamentos(lanc || []);
      setMembros(memb || []);
    } catch (e) {
      setErro(e.message || "Erro ao carregar dados.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregarTudo(); }, []);

  const doMes = useMemo(() => lancamentos.filter((l) => l.data >= inicioMesISO()), [lancamentos]);
  const totalGastos = useMemo(() => doMes.filter((l) => l.tipo === "gasto").reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const totalReceitas = useMemo(() => doMes.filter((l) => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const porCategoria = useMemo(() => {
    const m = {};
    for (const l of doMes) if (l.tipo === "gasto") m[l.categoria] = (m[l.categoria] || 0) + Number(l.valor);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [doMes]);
  const nomePorMembroId = useMemo(() => Object.fromEntries(membros.map((m) => [m.id, m.nome])), [membros]);

  async function excluirLancamento(id) {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("lancamentos").delete().eq("id", id);
    if (error) return alert(error.message);
    carregarTudo();
  }

  return (
    <div style={wrap}>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}

      <div style={row}>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Gastos do mês</div>
          <div style={statBig}>{moeda(totalGastos)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Receitas do mês</div>
          <div style={statBig}>{moeda(totalReceitas)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Saldo do mês</div>
          <div style={{ ...statBig, color: totalReceitas - totalGastos >= 0 ? C.accent : C.danger }}>{moeda(totalReceitas - totalGastos)}</div>
        </div>
      </div>

      <div style={row}>
        <button style={aba === "visao" ? btn : btnGhost} onClick={() => setAba("visao")}>Visão geral</button>
        <button style={aba === "membros" ? btn : btnGhost} onClick={() => setAba("membros")}>Membros e permissões</button>
      </div>

      {aba === "visao" && (
        <>
          <NovoLancamento membros={membros} membroLogado={membro} onSalvo={carregarTudo} />

          <div style={cardStyle}>
            <div style={h2}>GASTOS POR CATEGORIA (MÊS)</div>
            {porCategoria.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhum gasto lançado ainda este mês.</div>}
            {porCategoria.map(([cat, val]) => (
              <div key={cat} style={lineItem}>
                <span style={{ fontSize: 14, color: C.ink, textTransform: "capitalize" }}>{cat}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{moeda(val)}</span>
              </div>
            ))}
          </div>

          <div style={cardStyle}>
            <div style={h2}>LANÇAMENTOS RECENTES</div>
            {carregando && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Carregando…</div>}
            {!carregando && lancamentos.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhum lançamento ainda.</div>}
            {lancamentos.slice(0, 40).map((l) => (
              <div key={l.id} style={lineItem}>
                <div>
                  <div style={{ fontSize: 14, color: C.ink }}>
                    {l.descricao || l.categoria} <span style={{ color: C.inkFaint, fontSize: 12 }}>· {nomePorMembroId[l.membro_id] || "?"} · {l.data}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.inkFaint, textTransform: "capitalize" }}>{l.categoria}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: l.tipo === "gasto" ? C.danger : C.accent }}>
                    {l.tipo === "gasto" ? "-" : "+"}{moeda(l.valor)}
                  </span>
                  <button style={btnGhost} onClick={() => excluirLancamento(l.id)}>Excluir</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {aba === "membros" && (
        <GerenciarMembros membros={membros} membroLogado={membro} onAtualizado={() => { carregarTudo(); onMembroAtualizado && onMembroAtualizado(); }} />
      )}
    </div>
  );
}

function NovoLancamento({ membros, membroLogado, onSalvo }) {
  const [tipo, setTipo] = useState("gasto");
  const [categoria, setCategoria] = useState("mercado");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [membroId, setMembroId] = useState(membroLogado.id);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!valor || Number(valor) <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    try {
      const { error } = await supabase.from("lancamentos").insert({
        familia_id: membroLogado.familia_id,
        membro_id: membroId,
        tipo, categoria, valor: Number(valor), descricao: descricao.trim() || null, data,
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
      <div style={h2}>NOVO LANÇAMENTO</div>
      {erro && <div style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      <div style={row}>
        <select style={select} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="gasto">Gasto</option>
          <option value="receita">Receita</option>
        </select>
        <select style={select} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={select} value={membroId} onChange={(e) => setMembroId(e.target.value)}>
          {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      </div>
      <div style={{ ...row, marginTop: 10 }}>
        <input style={input} type="number" step="0.01" placeholder="Valor" value={valor} onChange={(e) => setValor(e.target.value)} />
        <input style={{ ...input, flex: "2 1 200px" }} placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        <input style={input} type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Lançar"}</button>
      </div>
    </form>
  );
}

function GerenciarMembros({ membros, membroLogado, onAtualizado }) {
  const [mostrarForm, setMostrarForm] = useState(false);

  return (
    <div style={cardStyle}>
      <div style={h2}>MEMBROS DA FAMÍLIA</div>
      {membros.map((m) => <MembroCard key={m.id} membro={m} souEu={m.id === membroLogado.id} onAtualizado={onAtualizado} />)}
      {!mostrarForm && <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => setMostrarForm(true)}>+ Adicionar membro (convidar por e-mail)</button>}
      {mostrarForm && <AdicionarMembro familiaId={membroLogado.familia_id} onSalvo={() => { setMostrarForm(false); onAtualizado(); }} onCancelar={() => setMostrarForm(false)} />}
    </div>
  );
}

function MembroCard({ membro, souEu, onAtualizado }) {
  const [editando, setEditando] = useState(false);
  const [mesada, setMesada] = useState(membro.mesada_mensal || 0);
  const [perm, setPerm] = useState(membro.permissoes || {});
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const { error } = await supabase.from("membros").update({ mesada_mensal: Number(mesada), permissoes: perm }).eq("id", membro.id);
      if (error) throw error;
      setEditando(false);
      onAtualizado();
    } catch (e) {
      alert(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.line}`, padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{membro.nome} {souEu && "(você)"}</div>
          <div style={{ fontSize: 12, color: C.inkFaint }}>{membro.papel === "dono" ? "Administrador(a)" : "Acesso restrito"} {membro.email ? `· ${membro.email}` : ""} {!membro.user_id ? "· convite pendente" : ""}</div>
        </div>
        {membro.papel === "restrito" && !editando && <button style={btnGhost} onClick={() => setEditando(true)}>Editar</button>}
      </div>
      {membro.papel === "restrito" && editando && (
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 12.5, color: C.inkMute }}>Mesada mensal</label>
          <input style={{ ...input, display: "block", marginTop: 4, marginBottom: 10 }} type="number" step="0.01" value={mesada} onChange={(e) => setMesada(e.target.value)} />
          {[
            ["ver_saldo_geral", "Pode ver o saldo geral da família"],
            ["ver_gastos_dono", "Pode ver os gastos do administrador"],
            ["ver_resumo_categorias", "Pode ver o resumo por categoria"],
          ].map(([chave, label]) => (
            <label key={chave} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginBottom: 6 }}>
              <input type="checkbox" checked={!!perm[chave]} onChange={(e) => setPerm({ ...perm, [chave]: e.target.checked })} />
              {label}
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={btn} onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
            <button style={btnGhost} onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdicionarMembro({ familiaId, onSalvo, onCancelar }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [mesada, setMesada] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      const { error } = await supabase.from("membros").insert({
        familia_id: familiaId,
        nome: nome.trim(),
        email: email.trim(),
        papel: "restrito",
        mesada_mensal: Number(mesada) || 0,
        permissoes: { ver_saldo_geral: false, ver_gastos_dono: false, ver_resumo_categorias: false },
      });
      if (error) throw error;
      onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao convidar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
      {erro && <div style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      <div style={row}>
        <input style={input} placeholder="Nome (ex: Alessia)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input style={input} type="email" placeholder="E-mail dela" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input style={input} type="number" step="0.01" placeholder="Mesada mensal" value={mesada} onChange={(e) => setMesada(e.target.value)} />
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, margin: "8px 0" }}>
        Ela precisa criar a conta no Cash App usando ESTE MESMO e-mail — assim que ela entrar pela primeira vez, o app liga a conta dela sozinho.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Convidar"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
