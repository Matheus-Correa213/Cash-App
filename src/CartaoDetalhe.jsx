import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe, moeda, mesDaFatura } from "./theme.js";
import LogoInstituicao from "./LogoInstituicao.jsx";

// Detalhe de um cartão — visão estilo app de banco: anel de limite, fatura
// atual itemizada com o tipo de cada compra (à vista / parcela / assinatura)
// e uma prévia dos próximos meses, calculada só somando as parcelas que já
// foram lançadas com a data certa (nenhuma mágica: a matemática já foi feita
// na hora da compra, em criar_compra_parcelada).

export default function CartaoDetalhe({ cartaoId, familiaId, contas = [], podeEditar = true, onVoltar, onSalvo }) {
  const [cartao, setCartao] = useState(null);
  const [lancamentosAbertos, setLancamentosAbertos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  // Migração 10 ("editar tudo", 16/09/2026): não existia NENHUMA forma
  // manual de corrigir nome/titular/limite/etc de um cartão já cadastrado —
  // só criar e excluir (lá em ContasCartoes.jsx). Disponível pros dois
  // papéis, sem distinção (diferente de "Pagar fatura atual", que continua
  // só do dono).
  const [editando, setEditando] = useState(false);

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const [{ data: k, error: e1 }, { data: l, error: e2 }] = await Promise.all([
        supabase.from("cartoes_credito").select("*").eq("id", cartaoId).single(),
        supabase.from("lancamentos").select("*").eq("cartao_id", cartaoId).eq("fatura_paga", false).eq("tipo", "gasto").order("data"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setCartao(k);
      setLancamentosAbertos(l || []);
    } catch (e) {
      setErro(e.message || "Erro ao carregar o cartão.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, [cartaoId]);

  const hojeMes = new Date().toISOString().slice(0, 7);
  const porMesFatura = useMemo(() => {
    const m = {};
    for (const l of lancamentosAbertos) {
      const mes = mesDaFatura(l.data, cartao?.dia_fechamento);
      (m[mes] = m[mes] || []).push(l);
    }
    return m;
  }, [lancamentosAbertos, cartao]);

  const mesesOrdenados = Object.keys(porMesFatura).sort();
  const mesAtual = mesesOrdenados.find((m) => m >= hojeMes) || hojeMes;
  const itensFaturaAtual = porMesFatura[mesAtual] || [];
  // fatura_inicial (migração 6) é a dívida que já existia no cartão antes de
  // começar a lançar tudo pelo app — entra na fatura ATUAL (é dívida já
  // vencida/a vencer agora, não uma parcela futura), e some sozinha quando a
  // fatura é paga pelo app (a RPC pagar_fatura_cartao zera ela junto).
  const totalFaturaAtual = itensFaturaAtual.reduce((s, l) => s + Number(l.valor), 0) + Number(cartao?.fatura_inicial || 0);
  const proximosMeses = mesesOrdenados.filter((m) => m > mesAtual).slice(0, 3);

  // limite_comprometido_extra (migração 7): compras parceladas em andamento
  // que o app ainda não conhece lançamento por lançamento — consomem limite
  // mas ainda não aparecem na fatura atual nem em lancamentosAbertos, então
  // entram aqui (no "usado" que define o disponível) e não em totalFaturaAtual.
  const usado = lancamentosAbertos.reduce((s, l) => s + Number(l.valor), 0) + Number(cartao?.fatura_inicial || 0) + Number(cartao?.limite_comprometido_extra || 0);
  const disponivel = cartao?.limite != null ? Math.max(0, cartao.limite - usado) : null;
  const pctUsado = cartao?.limite ? Math.min(100, Math.round((usado / cartao.limite) * 100)) : 0;

  async function pagarFaturaAtual() {
    if (!confirm(`Marcar a fatura de ${cartao.nome} (${moeda(totalFaturaAtual)}) como paga?`)) return;
    try {
      const { error } = await supabase.rpc("pagar_fatura_cartao", { p_cartao_id: cartao.id });
      if (error) throw error;
      carregar();
      onSalvo && onSalvo();
    } catch (e) {
      alert(e.message);
    }
  }

  if (carregando) return <div style={{ padding: 18, color: C.inkFaint }}>Carregando…</div>;
  if (erro || !cartao) return <div style={{ padding: 18, color: C.danger }}>{erro || "Cartão não encontrado."}</div>;

  const inst = instituicaoDe(cartao.bandeira || cartao.nome);

  if (editando) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <button onClick={() => setEditando(false)} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>
        <EditarCartao
          cartao={cartao}
          contas={contas}
          onSalvo={() => { setEditando(false); carregar(); onSalvo && onSalvo(); }}
          onCancelar={() => setEditando(false)}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>
        <button onClick={() => setEditando(true)} style={{ border: `1px solid ${C.line}`, borderRadius: 8, background: "transparent", color: C.inkMute, fontSize: 12.5, padding: "6px 10px", cursor: "pointer" }}>Editar cartão</button>
      </div>

      <div style={{ background: `linear-gradient(135deg, ${inst.cor} 0%, ${inst.corEscura} 100%)`, borderRadius: 20, padding: 20, height: 130, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{cartao.nome}</span>
          <LogoInstituicao nome={cartao.bandeira || cartao.nome} size={32} claro />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: 2 }}>{cartao.bandeira || ""}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{cartao.titular || ""}</span>
        </div>
      </div>

      {cartao.limite != null && (
        <div style={{ background: C.card, borderRadius: 18, padding: 20, display: "flex", alignItems: "center", gap: 20 }}>
          <AnelLimite pct={pctUsado} cor={inst.cor} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase" }}>Disponível</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>{moeda(disponivel)}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint }}>
              de {moeda(cartao.limite)}{cartao.dia_fechamento ? ` · fecha dia ${cartao.dia_fechamento}` : ""}{cartao.dia_vencimento ? `, vence dia ${cartao.dia_vencimento}` : ""}
            </div>
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>Fatura atual — {moeda(totalFaturaAtual)}</div>
        <div style={{ background: C.card, borderRadius: 16, padding: "4px 14px" }}>
          {itensFaturaAtual.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13, padding: "14px 0" }}>Nenhuma compra em aberto neste ciclo.</div>}
          {itensFaturaAtual.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{l.descricao || l.categoria}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{l.data}</div>
              </div>
              <BadgeTipo lancamento={l} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{moeda(l.valor)}</span>
            </div>
          ))}
        </div>
      </div>

      {proximosMeses.length > 0 && (
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Prévia das próximas faturas</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 2, marginBottom: 10 }}>Calculada a partir das parcelas em aberto — nada aqui é surpresa.</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${proximosMeses.length}, 1fr)`, gap: 10 }}>
            {proximosMeses.map((mes) => {
              const total = (porMesFatura[mes] || []).reduce((s, l) => s + Number(l.valor), 0);
              const [ano, mesNum] = mes.split("-");
              const nomeMes = new Date(Number(ano), Number(mesNum) - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
              return (
                <div key={mes} style={{ background: "#FDF3FF", borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#8A05BE", textTransform: "capitalize" }}>{nomeMes}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{moeda(total)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* pagar_fatura_cartao() já recusa quem não é dono direto no banco
          ("Só o administrador pode pagar faturas.") — o botão só fica
          escondido aqui pra não levar a esse erro cru. */}
      {podeEditar && totalFaturaAtual > 0 && (
        <button onClick={pagarFaturaAtual} style={{ background: inst.cor, borderRadius: 16, padding: "16px 0", border: "none", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
          Pagar fatura atual
        </button>
      )}
    </div>
  );
}

const inputEdit = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const rowEdit = { display: "flex", gap: 10, flexWrap: "wrap" };
const btnEdit = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhostEdit = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };

// Edição de um cartão já existente — migração 10 ("editar tudo"): mesmo
// formulário de NovoCartao (ContasCartoes.jsx), mas pré-preenchido e fazendo
// update em vez de insert. Disponível pros dois papéis, sem distinção.
function EditarCartao({ cartao, contas, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(cartao.nome || "");
  const [bandeira, setBandeira] = useState(cartao.bandeira || "");
  const [titular, setTitular] = useState(cartao.titular || "");
  const [limite, setLimite] = useState(cartao.limite != null ? String(cartao.limite) : "");
  const [diaFechamento, setDiaFechamento] = useState(cartao.dia_fechamento != null ? String(cartao.dia_fechamento) : "");
  const [diaVencimento, setDiaVencimento] = useState(cartao.dia_vencimento != null ? String(cartao.dia_vencimento) : "");
  const [contaPagamentoId, setContaPagamentoId] = useState(cartao.conta_pagamento_id || "");
  const [visivel, setVisivel] = useState(!!cartao.visivel_para_restrito);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      // `.select()` no update, de propósito — ver EditarConta em
      // ContasCartoes.jsx pra explicação do "0 linhas afetadas".
      const { data, error } = await supabase.from("cartoes_credito").update({
        nome: nome.trim(), bandeira: bandeira.trim() || null,
        titular: titular.trim() || null,
        limite: limite ? Number(limite) : null,
        dia_fechamento: diaFechamento ? Number(diaFechamento) : null,
        dia_vencimento: diaVencimento ? Number(diaVencimento) : null,
        conta_pagamento_id: contaPagamentoId || null,
        visivel_para_restrito: visivel,
      }).eq("id", cartao.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(`O cartão "${cartao.nome}" não foi atualizado — o banco não confirmou nenhuma alteração.`);
      onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18 }}>
      {erro && <div style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      <div style={rowEdit}>
        <input style={inputEdit} placeholder="Nome (ex: Nubank Platinum)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input style={inputEdit} placeholder="Bandeira (ex: Visa, Mastercard)" value={bandeira} onChange={(e) => setBandeira(e.target.value)} />
        <input style={inputEdit} placeholder="Titular (ex: Alessia)" value={titular} onChange={(e) => setTitular(e.target.value)} />
      </div>
      <div style={{ ...rowEdit, marginTop: 10 }}>
        <input style={inputEdit} type="number" step="0.01" placeholder="Limite" value={limite} onChange={(e) => setLimite(e.target.value)} />
        <input style={inputEdit} type="number" min="1" max="31" placeholder="Dia de fechamento" value={diaFechamento} onChange={(e) => setDiaFechamento(e.target.value)} />
        <input style={inputEdit} type="number" min="1" max="31" placeholder="Dia de vencimento" value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 12.5, color: C.inkMute }}>Conta que paga a fatura</label>
        <select style={{ ...inputEdit, display: "block", width: "100%", marginTop: 4 }} value={contaPagamentoId} onChange={(e) => setContaPagamentoId(e.target.value)}>
          <option value="">Nenhuma</option>
          {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginTop: 10 }}>
        <input type="checkbox" checked={visivel} onChange={(e) => setVisivel(e.target.checked)} />
        Deixar visível para o membro com acesso restrito
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={btnEdit} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar alterações"}</button>
        <button type="button" style={btnGhostEdit} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function BadgeTipo({ lancamento }) {
  let texto = "à vista";
  let bg = C.line;
  let cor = C.inkMute;
  if (lancamento.parcela_total > 1) {
    texto = `${lancamento.parcela_atual}/${lancamento.parcela_total}`;
    bg = "#FDF3FF"; cor = "#8A05BE";
  } else if (lancamento.assinatura_id) {
    texto = "assinatura";
    bg = C.accentSoft; cor = C.accent;
  }
  return <div style={{ background: bg, borderRadius: 100, padding: "3px 9px" }}><span style={{ fontSize: 10.5, fontWeight: 700, color: cor }}>{texto}</span></div>;
}

function AnelLimite({ pct, cor }) {
  const raio = 15.9;
  const circunferencia = 2 * Math.PI * raio;
  const dash = (pct / 100) * circunferencia;
  return (
    <svg width={92} height={92} viewBox="0 0 42 42">
      <circle cx="21" cy="21" r={raio} fill="none" stroke={C.line} strokeWidth="6" />
      <circle cx="21" cy="21" r={raio} fill="none" stroke={cor} strokeWidth="6" strokeDasharray={`${dash} ${circunferencia - dash}`} strokeLinecap="round" transform="rotate(-90 21 21)" />
    </svg>
  );
}
