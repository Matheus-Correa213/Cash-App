import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe, moeda } from "./theme.js";
import { IconCard, IconCash } from "./Icons.jsx";
import LogoInstituicao from "./LogoInstituicao.jsx";

const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 12, fontWeight: 800, color: C.inkFaint, marginBottom: 12, letterSpacing: "0.04em", textTransform: "uppercase" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };

const TIPOS_CONTA = [
  ["corrente", "Conta corrente"],
  ["poupanca", "Poupança"],
  ["carteira", "Carteira/dinheiro"],
  ["outro", "Outro"],
];

export default function ContasCartoes({ familiaId, onAbrirCartao }) {
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

  if (carregando) return <div style={cardStyle}>Carregando…</div>;

  const bancarias = contas.filter((c) => c.tipo === "corrente" || c.tipo === "outro");
  const fisico = contas.filter((c) => c.tipo === "carteira");
  const poupancas = contas.filter((c) => c.tipo === "poupanca");
  const saldoBancarias = bancarias.reduce((s, c) => s + Number(saldos[c.id] ?? c.saldo_inicial), 0);
  const saldoFisico = fisico.reduce((s, c) => s + Number(saldos[c.id] ?? c.saldo_inicial), 0);
  const saldoDisponivel = saldoBancarias + saldoFisico;

  function ListaContas(lista, tipoVazio) {
    return lista.map((c) => {
      const inst = instituicaoDe(c.instituicao || c.nome);
      return (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: inst.cor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>{inst.sigla}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{c.nome}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{c.titular || "—"} {c.visivel_para_restrito ? "· visível pra ela" : ""}</div>
          </div>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{moeda(saldos[c.id] ?? c.saldo_inicial)}</span>
          <button style={btnGhost} onClick={() => excluirConta(c.id)}>excluir</button>
        </div>
      );
    });
  }

  return (
    <div>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}

      <div style={{ background: C.navy, borderRadius: 18, padding: 20, marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>Saldo disponível</span>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginTop: 4 }}>{moeda(saldoDisponivel)}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Em contas {moeda(saldoBancarias)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.gold }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Em espécie {moeda(saldoFisico)}</span>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ ...h2, display: "flex", alignItems: "center", gap: 8 }}><IconCard size={14} color={C.inkFaint} strokeWidth={2} /> Contas bancárias</div>
        {bancarias.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, marginBottom: 10 }}>Nenhuma conta bancária cadastrada ainda.</div>}
        {ListaContas(bancarias)}
        {!mostrarFormConta && <button style={{ ...btnGhost, marginTop: 10 }} onClick={() => setMostrarFormConta(true)}>+ Adicionar conta, carteira ou poupança</button>}
        {mostrarFormConta && <NovaConta familiaId={familiaId} onSalvo={() => { setMostrarFormConta(false); carregar(); }} onCancelar={() => setMostrarFormConta(false)} />}
      </div>

      <div style={cardStyle}>
        <div style={{ ...h2, display: "flex", alignItems: "center", gap: 8 }}><IconCash size={14} color={C.inkFaint} strokeWidth={2} /> Dinheiro em espécie</div>
        {fisico.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhuma carteira física cadastrada ainda — use "Adicionar conta" acima e escolha o tipo "Carteira/dinheiro".</div>}
        {ListaContas(fisico)}
      </div>

      {poupancas.length > 0 && (
        <div style={cardStyle}>
          <div style={h2}>Poupança</div>
          {poupancas.map((c) => (
            <div key={c.id} style={{ background: C.greenSoft, borderRadius: 14, padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{c.instituicao ? `${c.instituicao} — ` : ""}{c.nome}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.greenTextAlt }}>{c.titular || ""}</div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.greenText }}>{moeda(saldos[c.id] ?? c.saldo_inicial)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={cardStyle}>
        <div style={h2}>Cartões de crédito</div>
        {cartoes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, marginBottom: 10 }}>Nenhum cartão cadastrado ainda.</div>}
        {cartoes.map((k) => {
          const inst = instituicaoDe(k.bandeira || k.nome);
          // fatura_inicial (migração 6) é a dívida que já existia no cartão
          // antes de começar a lançar tudo pelo app — soma com os gastos em
          // aberto lançados depois pra dar a fatura real.
          const aberto = (faturas[k.id] || 0) + Number(k.fatura_inicial || 0);
          const disponivel = k.limite != null ? Math.max(0, k.limite - aberto) : null;
          const pct = k.limite ? Math.min(100, Math.round((aberto / k.limite) * 100)) : 0;
          return (
            <button
              key={k.id}
              onClick={() => onAbrirCartao && onAbrirCartao(k.id)}
              style={{ position: "relative", overflow: "hidden", background: `linear-gradient(135deg, ${inst.cor} 0%, ${inst.corEscura} 100%)`, borderRadius: 18, padding: 18, display: "flex", flexDirection: "column", gap: 12, border: "none", width: "100%", textAlign: "left", cursor: "pointer", marginBottom: 12 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{k.nome}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{k.titular || ""}</div>
                </div>
                <LogoInstituicao nome={k.bandeira || k.nome} size={30} claro />
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Fatura atual</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginTop: 2 }}>{moeda(aberto)}</div>
                {k.limite != null && (
                  <>
                    <div style={{ height: 6, borderRadius: 100, background: "rgba(255,255,255,0.2)", marginTop: 8 }}>
                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 100, background: "#fff" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>
                      <span>Disponível {moeda(disponivel)} de {moeda(k.limite)}</span>
                      <span>{k.dia_fechamento ? `fecha dia ${k.dia_fechamento}` : ""}</span>
                    </div>
                  </>
                )}
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff" }}>Ver detalhes e parcelas ›</span>
            </button>
          );
        })}
        {!mostrarFormCartao && <button style={btnGhost} onClick={() => setMostrarFormCartao(true)}>+ Adicionar cartão</button>}
        {mostrarFormCartao && <NovoCartao familiaId={familiaId} contas={contas} onSalvo={() => { setMostrarFormCartao(false); carregar(); }} onCancelar={() => setMostrarFormCartao(false)} />}
      </div>
    </div>
  );
}

function NovaConta({ familiaId, onSalvo, onCancelar }) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("corrente");
  const [instituicao, setInstituicao] = useState("");
  const [titular, setTitular] = useState("");
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
        titular: titular.trim() || null,
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
        <input style={input} placeholder="Nome (ex: Nubank)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <select style={input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_CONTA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={{ ...row, marginTop: 10 }}>
        <input style={input} placeholder="Instituição (ex: Nubank, Inter…)" value={instituicao} onChange={(e) => setInstituicao(e.target.value)} />
        <input style={input} placeholder="Titular (ex: Matheus, Alessia)" value={titular} onChange={(e) => setTitular(e.target.value)} />
        <input style={input} type="number" step="0.01" placeholder="Saldo inicial" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginTop: 10 }}>
        <input type="checkbox" checked={visivel} onChange={(e) => setVisivel(e.target.checked)} />
        Deixar visível para o membro com acesso restrito
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
  const [titular, setTitular] = useState("");
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
        titular: titular.trim() || null,
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
        <input style={input} placeholder="Nome (ex: Nubank Platinum)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input style={input} placeholder="Bandeira (ex: Visa, Mastercard)" value={bandeira} onChange={(e) => setBandeira(e.target.value)} />
        <input style={input} placeholder="Titular (ex: Alessia)" value={titular} onChange={(e) => setTitular(e.target.value)} />
      </div>
      <div style={{ ...row, marginTop: 10 }}>
        <input style={input} type="number" step="0.01" placeholder="Limite" value={limite} onChange={(e) => setLimite(e.target.value)} />
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
