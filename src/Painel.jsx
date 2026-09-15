import React, { useMemo, useState } from "react";
import { C, instituicaoDe, moeda, inicioMesISO } from "./theme.js";
import NovoLancamento from "./NovoLancamento.jsx";

// Painel principal — redesenhado pra ser só um resumo (saldo do casal), duas
// ações principais (lançar ou falar com o COSMO), atalhos, e uma seção de
// "widgets" modulares. Widgets de verdade na tela inicial do celular (fora
// do app) exigiriam um app nativo — aqui são cartões dentro do próprio app.

const shortcuts = [
  { chave: "contas", label: "Contas", cor: C.accent, corSoft: C.accentSoft },
  { chave: "assinaturas", label: "Assinaturas", cor: C.purple, corSoft: C.purpleSoft },
  { chave: "importar", label: "Anexar", cor: C.accent, corSoft: C.accentSoft },
  { chave: "relatorios", label: "Relatórios", cor: C.accent, corSoft: C.accentSoft },
];

export default function Painel({ membro, membros, lancamentos, contas, cartoes, assinaturas, onNavegar, onSalvo }) {
  const [lancamentoAberto, setLancamentoAberto] = useState(false);

  const doMes = useMemo(() => lancamentos.filter((l) => l.data >= inicioMesISO()), [lancamentos]);
  const totalGastos = useMemo(() => doMes.filter((l) => l.tipo === "gasto").reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const totalReceitas = useMemo(() => doMes.filter((l) => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const saldo = totalReceitas - totalGastos;

  const cartaoPrincipal = cartoes[0];
  const abertoCartaoPrincipal = useMemo(() => {
    if (!cartaoPrincipal) return 0;
    return lancamentos.filter((l) => l.cartao_id === cartaoPrincipal.id && !l.fatura_paga && l.tipo === "gasto").reduce((s, l) => s + Number(l.valor), 0);
  }, [lancamentos, cartaoPrincipal]);
  const instCartao = cartaoPrincipal ? instituicaoDe(cartaoPrincipal.bandeira || cartaoPrincipal.nome) : null;
  const disponivelCartao = cartaoPrincipal?.limite != null ? Math.max(0, cartaoPrincipal.limite - abertoCartaoPrincipal) : null;

  const assinaturasAtivas = (assinaturas || []).filter((a) => a.ativo);
  const totalAssinaturas = assinaturasAtivas.reduce((s, a) => s + Number(a.valor), 0);
  const proximaAssinatura = assinaturasAtivas.slice().sort((a, b) => a.dia_cobranca - b.dia_cobranca)[0];

  // Insight simples e honesto: compara os últimos 7 dias com os 7 dias
  // anteriores na frente "dia_a_dia". Não é IA de verdade — é um cálculo na
  // hora — mas já dá o efeito de "o COSMO percebeu algo" sem precisar de
  // nenhuma chave de API pra funcionar.
  const insight = useMemo(() => {
    const hoje = new Date();
    const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1); // limite exclusivo, pra incluir o dia de hoje
    const seteDiasAtras = new Date(hoje); seteDiasAtras.setDate(hoje.getDate() - 7);
    const quatorzeDiasAtras = new Date(hoje); quatorzeDiasAtras.setDate(hoje.getDate() - 14);
    const soma = (de, ate) => lancamentos
      .filter((l) => l.tipo === "gasto" && l.categoria === "dia_a_dia" && l.data >= de.toISOString().slice(0, 10) && l.data < ate.toISOString().slice(0, 10))
      .reduce((s, l) => s + Number(l.valor), 0);
    const ultimos = soma(seteDiasAtras, amanha);
    const anteriores = soma(quatorzeDiasAtras, seteDiasAtras);
    if (anteriores <= 0 || ultimos <= 0) return null;
    const variacao = Math.round(((ultimos - anteriores) / anteriores) * 100);
    if (Math.abs(variacao) < 15) return null;
    return variacao > 0
      ? `Vocês gastaram ${variacao}% a mais em "dia a dia" essa semana. Quer rever o orçamento?`
      : `Boa! Gastos em "dia a dia" caíram ${Math.abs(variacao)}% essa semana.`;
  }, [lancamentos]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ position: "relative", overflow: "hidden", background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDeep} 100%)`, borderRadius: 22, padding: 24, color: "#fff" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.65)" }}>Saldo total do casal</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.5px", marginTop: 4 }}>{moeda(saldo)}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
          <LegendaSaldo cor="#4CE0AB" texto={`Receitas ${moeda(totalReceitas)}`} />
          <LegendaSaldo cor="#FF9A9E" texto={`Gastos ${moeda(totalGastos)}`} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button onClick={() => setLancamentoAberto(true)} style={botaoPrincipal(C.accent, "#fff")}>+ Novo lançamento</button>
        <button onClick={() => onNavegar("chat")} style={botaoPrincipal("#fff", C.ink, C.lineStrong)}>Falar com o COSMO</button>
      </div>

      {lancamentoAberto && (
        <NovoLancamento
          membroLogado={membro} membros={membros} contas={contas} cartoes={cartoes}
          aberto={true} onFechar={() => setLancamentoAberto(false)} onSalvo={onSalvo}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {shortcuts.map((s) => (
          <button key={s.chave} onClick={() => onNavegar(s.chave)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer" }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: s.corSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, background: s.cor }} />
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: C.ink }}>{s.label}</span>
          </button>
        ))}
      </div>

      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>Seus widgets</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {cartaoPrincipal && (
            <button onClick={() => onNavegar(`cartao:${cartaoPrincipal.id}`)} style={{ ...widgetBase, background: `linear-gradient(135deg, ${instCartao.cor} 0%, ${instCartao.corEscura} 100%)`, color: "#fff", border: "none", textAlign: "left", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{cartaoPrincipal.nome}</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{moeda(abertoCartaoPrincipal)}</div>
                {disponivelCartao != null && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
                    Disponível {moeda(disponivelCartao)}{cartaoPrincipal.dia_fechamento ? ` · fecha dia ${cartaoPrincipal.dia_fechamento}` : ""}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 18 }}>›</span>
            </button>
          )}

          {assinaturasAtivas.length > 0 && (
            <button onClick={() => onNavegar("assinaturas")} style={{ ...widgetBase, background: "#fff", border: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: C.purpleSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, background: C.purple }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Assinaturas</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{assinaturasAtivas.length} ativas{proximaAssinatura ? ` · próxima dia ${proximaAssinatura.dia_cobranca}` : ""}</div>
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.purple }}>{moeda(totalAssinaturas)}/mês</span>
            </button>
          )}

          {insight && (
            <div style={{ display: "flex", gap: 11, background: C.navy, borderRadius: 16, padding: "14px 16px", alignItems: "flex-start" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: C.gold, flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gold, marginBottom: 2 }}>Percebido pelo COSMO</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>{insight}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendaSaldo({ cor, texto }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: cor }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>{texto}</span>
    </div>
  );
}

function botaoPrincipal(bg, cor, borda) {
  return { padding: "16px 14px", borderRadius: 16, border: borda ? `1.5px solid ${borda}` : "none", background: bg, color: cor, fontWeight: 800, fontSize: 13, cursor: "pointer" };
}

const widgetBase = { borderRadius: 16, padding: "15px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" };
