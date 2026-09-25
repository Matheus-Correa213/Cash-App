import React, { useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda, mesAtualISO, nomeMes } from "./theme.js";
import NovoLancamento from "./NovoLancamento.jsx";
import EditarLancamento from "./EditarLancamento.jsx";

// Tela dedicada de Receitas — espaço próprio, como pedido no redesign, em vez
// de ficar escondida dentro de um formulário genérico de lançamento.
//
// `fontesReceita`/`frentesGasto` (migração 10, categorias personalizadas,
// 16/09/2026): vêm mescladas (fixas + criadas pela família) de OwnerView.jsx.
//
// Leva 12 (25/09/2026): seletor de mês/ano (mesmo pedido feito pra Gastos —
// "separação dos meses dos anos, e você seleciona o mês que quiser ver") e
// edição de lançamentos já existentes ("precisamos poder editar os
// lançamentos, valores e onde foram lançados. Sejam gastos, sejam
// receitas.").

export default function Receitas({ membro, membros, lancamentos, contas, cartoes, frentesGasto, fontesReceita, nomePorMembroId, categorizacaoAutomatica, onSalvo }) {
  const [lancamentoAberto, setLancamentoAberto] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [mes, setMes] = useState(mesAtualISO());

  function fonteDe(categoria) {
    return fontesReceita.find((f) => f.chave === categoria) || { chave: categoria, label: categoria, cor: C.inkMute, corSoft: C.line, Icone: null, emoji: null };
  }

  const doMes = useMemo(() => lancamentos.filter((l) => l.tipo === "receita" && l.data.slice(0, 7) === mes), [lancamentos, mes]);
  const total = useMemo(() => doMes.reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const porFonte = useMemo(() => {
    const m = {};
    for (const l of doMes) m[l.categoria] = (m[l.categoria] || 0) + Number(l.valor);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [doMes]);
  const maiorFonte = Math.max(1, ...porFonte.map(([, v]) => v));

  async function excluir(id) {
    if (!confirm("Excluir esta receita?")) return;
    const { error } = await supabase.from("lancamentos").delete().eq("id", id);
    if (error) return alert(error.message);
    onSalvo();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: C.greenSoft, borderRadius: 22, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.greenTextAlt }}>Receitas · {nomeMes(mes)}</div>
          <input
            type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 9, border: `1.5px solid ${C.greenText}`, background: "#fff", color: C.greenText, fontSize: 12.5, fontWeight: 700 }}
          />
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.greenText, marginTop: 4 }}>{moeda(total)}</div>
      </div>

      <NovoLancamento
        membroLogado={membro} membros={membros} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita} tipoInicial="receita"
        categorizacaoAutomatica={categorizacaoAutomatica}
        aberto={lancamentoAberto} onAbrir={() => setLancamentoAberto(true)} onFechar={() => setLancamentoAberto(false)} onSalvo={onSalvo}
      />

      {porFonte.length > 0 && (
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>Por fonte</div>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "6px 14px" }}>
            {porFonte.map(([chave, valor]) => {
              const f = fonteDe(chave);
              const Icone = f.Icone;
              return (
                <div key={chave} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ width: 36, height: 36, borderRadius: 11, background: f.corSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {f.emoji ? (
                      <span style={{ fontSize: 16, lineHeight: 1 }}>{f.emoji}</span>
                    ) : (
                      Icone && <Icone size={16} color={f.cor} strokeWidth={1.9} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{f.label}</div>
                    <div style={{ height: 5, borderRadius: 100, background: C.line, marginTop: 6 }}>
                      <div style={{ width: `${Math.round((valor / maiorFonte) * 100)}%`, height: "100%", borderRadius: 100, background: f.cor }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{moeda(valor)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, marginBottom: 10 }}>Lançamentos</div>
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "6px 16px" }}>
          {doMes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>Nenhuma receita lançada em {nomeMes(mes)}.</div>}
          {doMes.map((l) => {
            const f = fonteDe(l.categoria);
            const Icone = f.Icone;
            // Quem tem acesso restrito só edita/exclui os PRÓPRIOS lançamentos
            // — a mesma regra que a RLS já aplica no UPDATE/DELETE ("membro
            // edita/exclui so o proprio"); escondemos os botões nos
            // lançamentos de outra pessoa pra não dar a impressão de que ia
            // funcionar e não funcionar.
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
                    Icone && <Icone size={16} color={f.cor} strokeWidth={1.9} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{l.descricao || f.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{nomePorMembroId?.[l.membro_id] || "?"} · {l.data}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.greenText }}>+{moeda(l.valor)}</span>
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
    </div>
  );
}
