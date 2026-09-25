import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda, mesAtualISO, nomeMes, SEM_CATEGORIA } from "./theme.js";
import NovoLancamento from "./NovoLancamento.jsx";
import EditarLancamento from "./EditarLancamento.jsx";

// Tela dedicada de Gastos — espaço próprio, com as frentes de gasto da
// doutrina financeira do COSMO (dia a dia, recorrentes, reserva, projetos,
// casa/família, saúde) mais as que a própria família criar (migração 10,
// categorias personalizadas, 16/09/2026) em vez de uma lista sem contexto.
//
// `frentesGasto` já vem mesclada (fixas + personalizadas) de OwnerView.jsx,
// cada item com `Icone` ou `emoji` (migração 12) resolvido.
//
// Leva 12 (25/09/2026) — dois ajustes grandes pedidos pelo Matheus:
//
// 1) "Cartão de crédito, o lançamento de pagamento parcelado, aparece todo de
// uma vez... É preciso separar gastos de dinheiro em conta, com cartão." A
// compra no cartão (à vista ou parcelada) grava `cartao_id` no lançamento
// (ver NovoLancamento.jsx e a função `criar_compra_parcelada`); já o
// pagamento da FATURA (`pagar_fatura_cartao`, migração 6) grava só
// `conta_id`, nunca `cartao_id`. Por isso `!l.cartao_id` já separa certinho
// "isso é uma compra de cartão, mora só dentro de CartaoDetalhe" de "isso é
// dinheiro saindo de conta (ou o pagamento da fatura em si), mora aqui" —
// igual um app de banco mostra "pagamento da fatura" como UMA linha, não
// cada compra que caiu nela.
//
// 2) "Vamos pensar em calendário... você seleciona o mês que quiser ver."
// Antes só existia "o mês atual" (inicioMesISO); agora um seletor de
// mês/ano de verdade, igual o pedido.

export default function Gastos({ membro, membros, lancamentos, contas, cartoes, frentesGasto, fontesReceita, nomePorMembroId, presetLancamento, onPresetConsumido, categorizacaoAutomatica, onSalvo }) {
  const [lancamentoAberto, setLancamentoAberto] = useState(() => !!presetLancamento);
  const [editandoId, setEditandoId] = useState(null);
  const [mes, setMes] = useState(mesAtualISO());

  // "Lançar agora" vindo do Planejamento (leva 12, 25/09/2026): abre o
  // formulário sozinho e volta pro mês atual (o item de planejamento sempre
  // se refere ao mês que a pessoa estava vendo lá, que normalmente é o mês
  // corrente) — ver comentário grande no state `presetLancamento` em
  // OwnerView.jsx.
  useEffect(() => {
    if (presetLancamento) {
      setLancamentoAberto(true);
      setMes(mesAtualISO());
    }
  }, [presetLancamento]);

  function frenteDe(categoria) {
    // Enquanto o COSMO ainda não categorizou (ver NovoLancamento.jsx e
    // Categorias.jsx) — mostra um rótulo amigável em vez da chave crua
    // "__sem_categoria__".
    if (categoria === SEM_CATEGORIA) return { chave: categoria, label: "Categorizando…", cor: "#8A05BE", corSoft: "#FDF3FF", corTexto: "#8A05BE", Icone: null, emoji: "🤖" };
    return frentesGasto.find((f) => f.chave === categoria) || { chave: categoria, label: categoria, cor: C.inkMute, corSoft: C.line, corTexto: C.inkMute, Icone: null, emoji: null };
  }

  // `!l.cartao_id`: só dinheiro de conta + pagamentos de fatura — ver
  // comentário grande no topo do arquivo. As compras de cartão (com
  // `cartao_id`) ficam só dentro de CartaoDetalhe.jsx.
  const doMes = useMemo(
    () => lancamentos.filter((l) => l.tipo === "gasto" && !l.cartao_id && l.data.slice(0, 7) === mes),
    [lancamentos, mes]
  );
  const total = useMemo(() => doMes.reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const porFrente = useMemo(() => {
    const m = {};
    for (const l of doMes) m[l.categoria] = (m[l.categoria] || 0) + Number(l.valor);
    return frentesGasto.map((f) => ({ ...f, total: m[f.chave] || 0 })).filter((f) => f.total > 0);
  }, [doMes, frentesGasto]);
  const maiorFrente = Math.max(1, ...porFrente.map((f) => f.total));

  async function excluir(id) {
    if (!confirm("Excluir este gasto?")) return;
    const { error } = await supabase.from("lancamentos").delete().eq("id", id);
    if (error) return alert(error.message);
    onSalvo();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: C.coralSoft, borderRadius: 22, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.coralText }}>Gastos · {nomeMes(mes)}</div>
          <input
            type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 9, border: `1.5px solid ${C.coralText}`, background: "#fff", color: C.coralText, fontSize: 12.5, fontWeight: 700 }}
          />
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.coralText, marginTop: 4 }}>{moeda(total)}</div>
      </div>

      <NovoLancamento
        membroLogado={membro} membros={membros} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita} tipoInicial="gasto"
        categoriaInicial={presetLancamento?.categoria} valorInicial={presetLancamento?.valor} categorizacaoAutomatica={categorizacaoAutomatica}
        aberto={lancamentoAberto}
        onAbrir={() => setLancamentoAberto(true)}
        onFechar={() => { setLancamentoAberto(false); onPresetConsumido && onPresetConsumido(); }}
        onSalvo={onSalvo}
      />

      {porFrente.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {porFrente.map((f) => {
            const IconeFrente = f.Icone;
            return (
              <div key={f.chave} style={{ background: f.corSoft, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 9, background: f.cor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {f.emoji ? (
                      <span style={{ fontSize: 14, lineHeight: 1 }}>{f.emoji}</span>
                    ) : (
                      IconeFrente && <IconeFrente size={14} color="#fff" strokeWidth={2} />
                    )}
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink }}>{f.label}</span>
                </div>
                <span style={{ fontSize: 15, fontWeight: 800, color: f.corTexto }}>{moeda(f.total)}</span>
                <div style={{ height: 5, borderRadius: 100, background: "rgba(0,0,0,0.08)" }}>
                  <div style={{ width: `${Math.round((f.total / maiorFrente) * 100)}%`, height: "100%", borderRadius: 100, background: f.cor }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "6px 16px" }}>
        {doMes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>Nenhum gasto lançado em {nomeMes(mes)}.</div>}
        {doMes.map((l) => {
          const f = frenteDe(l.categoria);
          const IconeLinha = f.Icone;
          // Quem tem acesso restrito só edita/exclui os PRÓPRIOS lançamentos —
          // a mesma regra que a RLS já aplica no UPDATE/DELETE ("membro edita/
          // exclui so o proprio"); escondemos os botões nos lançamentos de
          // outra pessoa pra não dar a impressão de que ia funcionar e não
          // funcionar.
          const podeMexer = membro.papel === "dono" || l.membro_id === membro.id;

          if (editandoId === l.id) {
            return (
              <div key={l.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
                <EditarLancamento
                  lancamento={l} membros={membros} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita}
                  podeEscolherMembro={membro.papel === "dono"}
                  onSalvo={() => { setEditandoId(null); onSalvo(); }}
                  onCancelar={() => setEditandoId(null)}
                />
              </div>
            );
          }

          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: f.corSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {f.emoji ? (
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{f.emoji}</span>
                ) : (
                  IconeLinha && <IconeLinha size={16} color={f.cor} strokeWidth={1.9} />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{l.descricao || f.label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{f.label} · {nomePorMembroId?.[l.membro_id] || "?"} · {l.data}{l.categoria === "fatura_cartao" ? " · fatura do cartão" : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: C.coralText }}>-{moeda(l.valor)}</span>
                {podeMexer && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setEditandoId(l.id)} style={{ border: "none", background: "transparent", color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>editar</button>
                    <button onClick={() => excluir(l.id)} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 12, cursor: "pointer" }}>excluir</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
