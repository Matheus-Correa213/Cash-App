import React, { useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, FRENTES_GASTO, frenteDe, moeda, inicioMesISO } from "./theme.js";
import NovoLancamento from "./NovoLancamento.jsx";
import { ICONE_FRENTE_GASTO } from "./Icons.jsx";

// Tela dedicada de Gastos — espaço próprio, com as 6 frentes de gasto da
// doutrina financeira do COSMO (dia a dia, recorrentes, reserva, projetos,
// casa/família, saúde) em vez de uma lista de categorias sem contexto.

export default function Gastos({ membro, membros, lancamentos, contas, cartoes, nomePorMembroId, onSalvo }) {
  const [lancamentoAberto, setLancamentoAberto] = useState(false);

  const doMes = useMemo(() => lancamentos.filter((l) => l.tipo === "gasto" && l.data >= inicioMesISO()), [lancamentos]);
  const total = useMemo(() => doMes.reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const porFrente = useMemo(() => {
    const m = {};
    for (const l of doMes) m[l.categoria] = (m[l.categoria] || 0) + Number(l.valor);
    return FRENTES_GASTO.map((f) => ({ ...f, total: m[f.chave] || 0 })).filter((f) => f.total > 0);
  }, [doMes]);
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
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.coralText }}>Gastos · mês</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.coralText, marginTop: 4 }}>{moeda(total)}</div>
      </div>

      <NovoLancamento
        membroLogado={membro} membros={membros} contas={contas} cartoes={cartoes} tipoInicial="gasto"
        aberto={lancamentoAberto} onAbrir={() => setLancamentoAberto(true)} onFechar={() => setLancamentoAberto(false)} onSalvo={onSalvo}
      />

      {porFrente.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {porFrente.map((f) => {
            const IconeFrente = ICONE_FRENTE_GASTO[f.chave];
            return (
              <div key={f.chave} style={{ background: f.corSoft, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 9, background: f.cor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {IconeFrente && <IconeFrente size={14} color="#fff" strokeWidth={2} />}
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
        {doMes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>Nenhum gasto lançado este mês ainda.</div>}
        {doMes.map((l) => {
          const f = frenteDe(l.categoria);
          const IconeLinha = ICONE_FRENTE_GASTO[l.categoria];
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: f.corSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {IconeLinha && <IconeLinha size={16} color={f.cor} strokeWidth={1.9} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{l.descricao || f.label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{f.label} · {nomePorMembroId?.[l.membro_id] || "?"} · {l.data}{l.parcela_total ? ` · ${l.parcela_atual}/${l.parcela_total}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: C.coralText }}>-{moeda(l.valor)}</span>
                <button onClick={() => excluir(l.id)} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 12, cursor: "pointer" }}>excluir</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
