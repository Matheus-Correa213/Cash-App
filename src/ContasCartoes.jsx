import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C } from "./theme.js";

const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: "0.02em" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };
const lineItem = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${C.line}`, gap: 10 };

function moeda(v) { return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`; }

const TIPOS_CONTA = [
  ["corrente", "Conta corrente"],
  ["poupanca", "Poupança"],
  ["carteira", "Carteira/dinheiro"],
  ["outro", "Outro"],
];

export default function ContasCartoes({ familiaId }) {
  const [contas, setContas] = useState([]);
  const [cartoes, setCartoes] = useState([]);
  const [saldos, setSaldos] = useState({});
  const [faturas, setFaturas] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mostrarFormConta, setMostrarFormConta] = useState(false);
  const [mostrarFormCartao, setMostrarFormCartao] = useState(false);

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const [{ data: c, error: e1 }, { data: k, error: e2 }, { data: s, error: e3 }, { data: abertos, error: e4 }] = await Promise.all([
        supabase.from("contas").select("*").eq("familia_id", familiaId).order("created_at"),
        supabase.from("cartoes_credito").select("*").eq("familia_id", familiaId).order("created_at"),
        supabase.rpc("saldos_contas"),
        supabase.from("lancamentos").select("cartao_id, valor").eq("familia_id", familiaId).eq("fatura_paga", false).eq("tipo", "gasto").not("cartao_id", "is", null),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      setContas(c || []);
      setCartoes(k || []);
      setSaldos(Object.fromEntries((s || []).map((r) => [r.conta_id, r.saldo])));
      const somaPorCartao = {};
      for (const l of abertos || []) somaPorCartao[l.cartao_id] = (somaPorCartao[l.cartao_id] || 0) + Number(l.valor);
      setFaturas(somaPorCartao);
    } catch (e) {
      setErro(e.message || "Erro ao carregar contas e cartões.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, [familiaId]);

  async function excluirConta(id) {
    if (!confirm("Excluir esta conta? Lançamentos já feitos com ela ficam sem conta associada.")) return;
    const { error } = await supabase.from("contas").delete().eq("id", id);
    if (error) return alert(error.message);
    carregar();
  }

  async function excluirCartao(id) {
    if (!confirm("Excluir este cartão?")) return;
    const { error } = await supabase.from("cartoes_credito").delete().eq("id", id);
    if (error) return alert(error.message);
    carregar();
  }

  async function pagarFatura(cartao) {
    const total = faturas[cartao.id] || 0;
    if (!confirm(`Marcar a fatura de ${cartao.nome} (${moeda(total)}) como paga? Isso lança um gasto de ${moeda(total)} na conta configurada para pagamento.`)) return;
    try {
      const { error } = await supabase.rpc("pagar_fatura_cartao", { p_cartao_id: cartao.id });
      if (error) throw error;
      carregar();
    } catch (e) {
      alert(e.message);
    }
  }

  if (carregando) return <div style={cardStyle}>Carregando…</div>;

  return (
    <div>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}

      <div style={cardStyle}>
        <div style={h2}>CONTAS</div>
        {contas.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, marginBottom: 10 }}>Nenhuma conta cadastrada ainda.</div>}
        {contas.map((c) => (
          <div key={c.id} style={lineItem}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{c.nome}</div>
              <div style={{ fontSize: 12, color: C.inkFaint }}>
                {TIPOS_CONTA.find((t) => t[0] === c.tipo)?.[1] || c.tipo} {c.instituicao ? `· ${c.instituicao}` : ""} {c.visivel_para_restrito ? "· visível para o membro restrito" : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{moeda(saldos[c.id] ?? c.saldo_inicial)}</span>
              <button style={btnGhost} onClick={() => excluirConta(c.id)}>Excluir</button>
            </div>
          </div>
        ))}
        {!mostrarFormConta && <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => setMostrarFormConta(true)}>+ Adicionar conta</button>}
        {mostrarFormConta && <NovaConta familiaId={familiaId} onSalvo={() => { setMostrarFormConta(false); carregar(); }} onCancelar={() => setMostrarFormConta(false)} />}
      </div>

      <div style={cardStyle}>
        <div style={h2}>CARTÕES DE CRÉDITO</div>
        {cartoes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, marginBottom: 10 }}>Nenhum cartão cadastrado ainda.</div>}
        {cartoes.map((k) => {
          const contaPagamento = contas.find((c) => c.id === k.conta_pagamento_id);
          const aberto = faturas[k.id] || 0;
          return (
            <div key={k.id} style={lineItem}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{k.nome} {k.bandeira ? `(${k.bandeira})` : ""}</div>
                <div style={{ fontSize: 12, color: C.inkFaint }}>
                  {k.limite ? `Limite ${moeda(k.limite)} · ` : ""}
                  {k.dia_fechamento ? `fecha dia ${k.dia_fechamento}` : ""}{k.dia_vencimento ? ` · vence dia ${k.dia_vencimento}` : ""}
                  {contaPagamento ? ` · paga com ${contaPagamento.nome}` : " · sem conta de pagamento configurada"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: aberto > 0 ? C.danger : C.inkFaint }}>{moeda(aberto)} em aberto</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {aberto > 0 && <button style={btnGhost} onClick={() => pagarFatura(k)}>Pagar fatura</button>}
                  <button style={btnGhost} onClick={() => excluirCartao(k.id)}>Excluir</button>
                </div>
              </div>
            </div>
          );
        })}
        {!mostrarFormCartao && <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => setMostrarFormCartao(true)}>+ Adicionar cartão</button>}
        {mostrarFormCartao && <NovoCartao familiaId={familiaId} contas={contas} onSalvo={() => { setMostrarFormCartao(false); carregar(); }} onCancelar={() => setMostrarFormCartao(false)} />}
      </div>
    </div>
  );
}

function NovaConta({ familiaId, onSalvo, onCancelar }) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("corrente");
  const [instituicao, setInstituicao] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("0");
  const [visivel, setVisivel] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      const { error } = await supabase.from("contas").insert({
        familia_id: familiaId, nome: nome.trim(), tipo, instituicao: instituicao.trim() || null,
        saldo_inicial: Number(saldoInicial) || 0, visivel_para_restrito: visivel,
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
        <input style={input} placeholder="Nome (ex: Nubank Matheus)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <select style={input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_CONTA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={{ ...row, marginTop: 10 }}>
        <input style={input} placeholder="Instituição (opcional)" value={instituicao} onChange={(e) => setInstituicao(e.target.value)} />
        <input style={input} type="number" step="0.01" placeholder="Saldo inicial" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginTop: 10 }}>
        <input type="checkbox" checked={visivel} onChange={(e) => setVisivel(e.target.checked)} />
        Deixar visível para o membro com acesso restrito (ela poderá escolher essa conta ao lançar um gasto)
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar conta"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function NovoCartao({ familiaId, contas, onSalvo, onCancelar }) {
  const [nome, setNome] = useState("");
  const [bandeira, setBandeira] = useState("");
  const [limite, setLimite] = useState("");
  const [diaFechamento, setDiaFechamento] = useState("");
  const [diaVencimento, setDiaVencimento] = useState("");
  const [contaPagamentoId, setContaPagamentoId] = useState(contas[0]?.id || "");
  const [visivel, setVisivel] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      const { error } = await supabase.from("cartoes_credito").insert({
        familia_id: familiaId, nome: nome.trim(), bandeira: bandeira.trim() || null,
        limite: limite ? Number(limite) : null,
        dia_fechamento: diaFechamento ? Number(diaFechamento) : null,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        conta_pagamento_id: contaPagamentoId || null,
        visivel_para_restrito: visivel,
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
      {contas.length === 0 && <div style={{ fontSize: 12.5, color: C.inkFaint, marginBottom: 8 }}>Cadastre uma conta primeiro, pra saber de onde sai o dinheiro quando a fatura for paga.</div>}
      <div style={row}>
        <input style={input} placeholder="Nome (ex: Nubank Roxinho)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input style={input} placeholder="Bandeira (opcional)" value={bandeira} onChange={(e) => setBandeira(e.target.value)} />
      </div>
      <div style={{ ...row, marginTop: 10 }}>
        <input style={input} type="number" step="0.01" placeholder="Limite (opcional)" value={limite} onChange={(e) => setLimite(e.target.value)} />
        <input style={input} type="number" min="1" max="31" placeholder="Dia de fechamento" value={diaFechamento} onChange={(e) => setDiaFechamento(e.target.value)} />
        <input style={input} type="number" min="1" max="31" placeholder="Dia de vencimento" value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 12.5, color: C.inkMute }}>Conta que paga a fatura</label>
        <select style={{ ...input, display: "block", width: "100%", marginTop: 4 }} value={contaPagamentoId} onChange={(e) => setContaPagamentoId(e.target.value)}>
          <option value="">Nenhuma ainda</option>
          {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginTop: 10 }}>
        <input type="checkbox" checked={visivel} onChange={(e) => setVisivel(e.target.checked)} />
        Deixar visível para o membro com acesso restrito
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar cartão"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
