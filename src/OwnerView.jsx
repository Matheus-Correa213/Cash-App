import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C } from "./theme.js";
import Painel from "./Painel.jsx";
import Receitas from "./Receitas.jsx";
import Gastos from "./Gastos.jsx";
import ContasCartoes from "./ContasCartoes.jsx";
import CartaoDetalhe from "./CartaoDetalhe.jsx";
import Investimentos from "./Investimentos.jsx";
import Relatorios from "./Relatorios.jsx";
import Assinaturas from "./Assinaturas.jsx";
import ChatCosmo from "./ChatCosmo.jsx";
import ImportarArquivo from "./ImportarArquivo.jsx";

const wrap = { padding: 18, maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 90 };
const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 };
const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };

// A navegação de baixo tem só 4 abas fixas (Painel/Receitas/Gastos/Mais),
// exatamente como no mockup do redesign. Tudo o que não coube nas 4 abas
// (Contas, Cartão em detalhe, Investimentos, Relatórios, Assinaturas, Chat,
// Importar, Membros) é alcançado pelos atalhos do Painel ou pelo menu "Mais",
// e fica guardado num "tela" à parte pra poder empilhar (ex: entrar num
// cartão específico a partir de Contas).
const ABAS_PRINCIPAIS = [
  { chave: "painel", label: "Painel" },
  { chave: "receitas", label: "Receitas" },
  { chave: "gastos", label: "Gastos" },
  { chave: "mais", label: "Mais" },
];

export default function OwnerView({ membro, onMembroAtualizado }) {
  const [lancamentos, setLancamentos] = useState([]);
  const [membros, setMembros] = useState([]);
  const [contas, setContas] = useState([]);
  const [cartoes, setCartoes] = useState([]);
  const [assinaturas, setAssinaturas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("painel");
  const [tela, setTela] = useState(null); // ex: "contas" | "cartao:<id>" | "investimentos" | "relatorios" | "assinaturas" | "chat" | "importar" | "membros"

  async function carregarTudo() {
    setCarregando(true); setErro("");
    try {
      const [{ data: lanc, error: e1 }, { data: memb, error: e2 }, { data: cts, error: e3 }, { data: crt, error: e4 }, { data: assn, error: e5 }] = await Promise.all([
        supabase.from("lancamentos").select("*").order("data", { ascending: false }).order("created_at", { ascending: false }).limit(300),
        supabase.from("membros").select("*").eq("familia_id", membro.familia_id).order("papel", { ascending: false }),
        supabase.from("contas").select("*").eq("familia_id", membro.familia_id).order("nome"),
        supabase.from("cartoes_credito").select("*").eq("familia_id", membro.familia_id).order("nome"),
        supabase.from("assinaturas").select("*").eq("familia_id", membro.familia_id).order("dia_cobranca"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      if (e5) throw e5;
      setLancamentos(lanc || []);
      setMembros(memb || []);
      setContas(cts || []);
      setCartoes(crt || []);
      setAssinaturas(assn || []);
    } catch (e) {
      setErro(e.message || "Erro ao carregar dados.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregarTudo(); }, []);

  const nomePorMembroId = useMemo(() => Object.fromEntries(membros.map((m) => [m.id, m.nome])), [membros]);

  function irPara(destino) {
    if (destino === "painel" || destino === "receitas" || destino === "gastos") {
      setAba(destino); setTela(null);
    } else {
      setAba("mais"); setTela(destino);
    }
  }

  function abrirAba(nomeAba) {
    setAba(nomeAba);
    if (nomeAba !== "mais") setTela(null);
  }

  return (
    <div style={wrap}>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}
      {carregando ? (
        <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Carregando…</div>
      ) : (
        <>
          {aba === "painel" && (
            <Painel membro={membro} membros={membros} lancamentos={lancamentos} contas={contas} cartoes={cartoes} assinaturas={assinaturas} onNavegar={irPara} onSalvo={carregarTudo} />
          )}

          {aba === "receitas" && (
            <Receitas membro={membro} membros={membros} lancamentos={lancamentos} contas={contas} cartoes={cartoes} nomePorMembroId={nomePorMembroId} onSalvo={carregarTudo} />
          )}

          {aba === "gastos" && (
            <Gastos membro={membro} membros={membros} lancamentos={lancamentos} contas={contas} cartoes={cartoes} nomePorMembroId={nomePorMembroId} onSalvo={carregarTudo} />
          )}

          {aba === "mais" && (
            <TelaMais
              tela={tela} setTela={setTela}
              membro={membro} membros={membros} contas={contas} cartoes={cartoes}
              onMembroAtualizado={() => { carregarTudo(); onMembroAtualizado && onMembroAtualizado(); }}
              onSalvo={carregarTudo}
            />
          )}
        </>
      )}

      <BarraInferior aba={aba} onEscolher={abrirAba} />
    </div>
  );
}

function TelaMais({ tela, setTela, membro, membros, contas, cartoes, onMembroAtualizado, onSalvo }) {
  if (tela?.startsWith("cartao:")) {
    const cartaoId = tela.split(":")[1];
    return <CartaoDetalhe cartaoId={cartaoId} familiaId={membro.familia_id} onVoltar={() => setTela("contas")} onSalvo={onSalvo} />;
  }
  if (tela === "contas") return <ContasCartoes familiaId={membro.familia_id} onAbrirCartao={(id) => setTela(`cartao:${id}`)} />;
  if (tela === "investimentos") return <Investimentos familiaId={membro.familia_id} />;
  if (tela === "relatorios") return <Relatorios familiaId={membro.familia_id} />;
  if (tela === "assinaturas") return <Assinaturas familiaId={membro.familia_id} contas={contas} cartoes={cartoes} onVoltar={() => setTela(null)} />;
  if (tela === "chat") return <ChatCosmo membro={membro} contas={contas} cartoes={cartoes} onVoltar={() => setTela(null)} onSalvo={onSalvo} />;
  if (tela === "importar") return <ImportarArquivo membro={membro} onVoltar={() => setTela(null)} onSalvo={onSalvo} />;
  if (tela === "membros") return <GerenciarMembros membros={membros} membroLogado={membro} onAtualizado={onMembroAtualizado} onVoltar={() => setTela(null)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Mais</div>
      {[
        ["contas", "Contas e cartões"],
        ["assinaturas", "Assinaturas"],
        ["investimentos", "Investimentos"],
        ["relatorios", "Relatórios"],
        ["chat", "Falar com o COSMO"],
        ["importar", "Importar e anexar"],
        ["membros", "Membros e permissões"],
      ].map(([chave, label]) => (
        <button key={chave} onClick={() => setTela(chave)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px", fontSize: 14, fontWeight: 700, color: C.ink, cursor: "pointer", textAlign: "left" }}>
          {label} <span style={{ color: C.inkFaint }}>›</span>
        </button>
      ))}
    </div>
  );
}

function BarraInferior({ aba, onEscolher }) {
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1px solid ${C.line}`, display: "grid", gridTemplateColumns: "repeat(4,1fr)", padding: "10px 0 14px 0", maxWidth: 720, margin: "0 auto" }}>
      {ABAS_PRINCIPAIS.map((a) => (
        <button key={a.chave} onClick={() => onEscolher(a.chave)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: aba === a.chave ? C.accent : "#C6CAD6" }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: aba === a.chave ? C.accent : "#9AA2B5" }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function GerenciarMembros({ membros, membroLogado, onAtualizado, onVoltar }) {
  const [mostrarForm, setMostrarForm] = useState(false);

  return (
    <div style={cardStyle}>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 10 }}>‹ Voltar</button>}
      <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 12 }}>MEMBROS DA FAMÍLIA</div>
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
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
