import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe, moeda, mesDaFatura } from "./theme.js";
import LogoInstituicao from "./LogoInstituicao.jsx";

// Detalhe de um cartão — visão estilo app de banco: anel de limite, fatura
// atual itemizada com o tipo de cada compra (à vista / parcela / assinatura)
// e uma prévia dos próximos meses, calculada só somando as parcelas que já
// foram lançadas com a data certa (nenhuma mágica: a matemática já foi feita
// na hora da compra, em criar_compra_parcelada).

export default function CartaoDetalhe({ cartaoId, familiaId, podeEditar = true, onVoltar, onSalvo }) {
  const [cartao, setCartao] = useState(null);
  const [lancamentosAbertos, setLancamentosAbertos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>

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
