import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe, moeda, inicioMesISO } from "./theme.js";

// Assinaturas — implementa a regra de negócio exatamente como o Matheus
// descreveu: no cartão, soma direto na fatura (sem confirmação separada); no
// débito em conta, o COSMO confere o saldo no dia da cobrança e confirma (ou
// avisa que o saldo pode não cobrir). A checagem de débito de verdade roda no
// servidor (api/verificar-assinaturas.js, chamado por um cron diário) — aqui
// a tela só LÊ o resultado dessa checagem e mostra o estado certo.

export default function Assinaturas({ familiaId, contas, cartoes, onVoltar }) {
  const [assinaturas, setAssinaturas] = useState([]);
  const [lancamentosDoMes, setLancamentosDoMes] = useState([]);
  const [saldos, setSaldos] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const [{ data: a, error: e1 }, { data: l, error: e2 }, { data: s, error: e3 }] = await Promise.all([
        supabase.from("assinaturas").select("*").eq("familia_id", familiaId).order("dia_cobranca"),
        supabase.from("lancamentos").select("*").eq("familia_id", familiaId).not("assinatura_id", "is", null).gte("data", inicioMesISO()),
        supabase.rpc("saldos_contas"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      setAssinaturas(a || []);
      setLancamentosDoMes(l || []);
      setSaldos(Object.fromEntries((s || []).map((r) => [r.conta_id, r.saldo])));
    } catch (e) {
      setErro(e.message || "Erro ao carregar assinaturas.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, [familiaId]);

  const total = assinaturas.filter((a) => a.ativo).reduce((s, a) => s + Number(a.valor), 0);
  const hoje = new Date().getDate();

  async function excluir(id) {
    if (!confirm("Excluir esta assinatura?")) return;
    const { error } = await supabase.from("assinaturas").delete().eq("id", id);
    if (error) return alert(error.message);
    carregar();
  }

  if (carregando) return <div style={{ padding: 18, color: C.inkFaint }}>Carregando…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>}
      {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}

      <div style={{ background: `linear-gradient(135deg, #4A2FBF 0%, ${C.purple} 100%)`, borderRadius: 22, padding: 22, color: "#fff" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>Total em assinaturas · por mês</span>
        <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{moeda(total)}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>{assinaturas.filter((a) => a.ativo).length} assinatura{assinaturas.length === 1 ? "" : "s"} ativa{assinaturas.length === 1 ? "" : "s"}</div>
      </div>

      <div style={{ display: "flex", gap: 10, background: C.accentSoft, borderRadius: 14, padding: "12px 14px" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.accent, lineHeight: 1.4 }}>No cartão, o COSMO já soma direto na fatura. No débito em conta, ele confere o saldo no dia e avisa se descontou.</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {assinaturas.map((a) => (
          <LinhaAssinatura key={a.id} assinatura={a} lancamentosDoMes={lancamentosDoMes} saldos={saldos} cartoes={cartoes} contas={contas} hoje={hoje} onExcluir={() => excluir(a.id)} />
        ))}
        {assinaturas.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhuma assinatura cadastrada ainda.</div>}
      </div>

      {!mostrarForm && (
        <button onClick={() => setMostrarForm(true)} style={{ border: `1.5px dashed ${C.lineStrong}`, borderRadius: 16, padding: 13, background: "transparent", color: C.inkMute, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          + Adicionar assinatura
        </button>
      )}
      {mostrarForm && <NovaAssinatura familiaId={familiaId} contas={contas} cartoes={cartoes} onSalvo={() => { setMostrarForm(false); carregar(); }} onCancelar={() => setMostrarForm(false)} />}
    </div>
  );
}

function LinhaAssinatura({ assinatura: a, lancamentosDoMes, saldos, cartoes, contas, hoje, onExcluir }) {
  const inst = a.tipo_cobranca === "cartao" ? instituicaoDe((cartoes.find((c) => c.id === a.cartao_id) || {}).bandeira || (cartoes.find((c) => c.id === a.cartao_id) || {}).nome) : null;
  const lancamentoConfirmado = lancamentosDoMes.find((l) => l.assinatura_id === a.id);

  let estado = { texto: "", bg: C.line, cor: C.inkMute, icone: "•" };
  if (a.tipo_cobranca === "cartao") {
    const cartao = cartoes.find((c) => c.id === a.cartao_id);
    estado = { texto: `No cartão — entra direto na fatura${cartao ? ` (${cartao.nome})` : ""}`, bg: C.line, cor: C.inkMute };
  } else if (lancamentoConfirmado) {
    const hora = new Date(lancamentoConfirmado.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    estado = { texto: `Confirmado hoje às ${hora} — descontado e lançado sozinho`, bg: C.greenSoft, cor: C.greenTextAlt };
  } else if (hoje < a.dia_cobranca) {
    estado = { texto: `Previsto pra dia ${a.dia_cobranca} — o COSMO confere o saldo e avisa`, bg: C.accentSoft, cor: C.accent };
  } else {
    const saldoConta = Number(saldos[a.conta_id] ?? 0);
    if (saldoConta < Number(a.valor)) {
      estado = { texto: `Saldo pode não cobrir dia ${a.dia_cobranca} — vale reforçar antes`, bg: C.amberSoft, cor: C.amberText, risco: true };
    } else {
      estado = { texto: `Previsto pra dia ${a.dia_cobranca} — o COSMO confere o saldo e avisa`, bg: C.accentSoft, cor: C.accent };
    }
  }

  return (
    <div style={{ background: estado.risco ? C.amberSoft : C.card, border: estado.risco ? `1px solid ${C.amberBorder}` : "none", borderRadius: 16, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: inst ? inst.cor : C.purple, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>{a.nome.slice(0, 1).toUpperCase()}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{a.nome}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>cobra dia {a.dia_cobranca}</div>
        </div>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{moeda(a.valor)}</span>
        <button onClick={onExcluir} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 11, cursor: "pointer" }}>excluir</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: estado.bg, borderRadius: 100, padding: "5px 10px", width: "fit-content" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: estado.cor }}>{estado.texto}</span>
      </div>
    </div>
  );
}

const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };

function NovaAssinatura({ familiaId, contas, cartoes, onSalvo, onCancelar }) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [diaCobranca, setDiaCobranca] = useState("");
  const [tipoCobranca, setTipoCobranca] = useState("cartao");
  const [contaId, setContaId] = useState(contas[0]?.id || "");
  const [cartaoId, setCartaoId] = useState(cartoes[0]?.id || "");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      const { error } = await supabase.from("assinaturas").insert({
        familia_id: familiaId, nome: nome.trim(), valor: Number(valor), dia_cobranca: Number(diaCobranca),
        tipo_cobranca: tipoCobranca,
        cartao_id: tipoCobranca === "cartao" ? cartaoId || null : null,
        conta_id: tipoCobranca === "debito" ? contaId || null : null,
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
    <form onSubmit={salvar} style={{ background: C.card, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={input} placeholder="Nome (ex: Netflix)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input style={input} type="number" step="0.01" placeholder="Valor" value={valor} onChange={(e) => setValor(e.target.value)} required />
        <input style={input} type="number" min="1" max="31" placeholder="Dia da cobrança" value={diaCobranca} onChange={(e) => setDiaCobranca(e.target.value)} required />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <select style={input} value={tipoCobranca} onChange={(e) => setTipoCobranca(e.target.value)}>
          <option value="cartao">Cobrada no cartão</option>
          <option value="debito">Débito automático em conta</option>
        </select>
        {tipoCobranca === "cartao" ? (
          <select style={input} value={cartaoId} onChange={(e) => setCartaoId(e.target.value)}>
            {cartoes.map((k) => <option key={k.id} value={k.id}>{k.nome}</option>)}
          </select>
        ) : (
          <select style={input} value={contaId} onChange={(e) => setContaId(e.target.value)}>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar assinatura"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
