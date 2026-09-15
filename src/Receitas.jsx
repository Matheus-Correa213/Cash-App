import React, { useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, FONTES_RECEITA, moeda, inicioMesISO } from "./theme.js";
import NovoLancamento from "./NovoLancamento.jsx";

// Tela dedicada de Receitas — espaço próprio, como pedido no redesign, em vez
// de ficar escondida dentro de um formulário genérico de lançamento.

export default function Receitas({ membro, membros, lancamentos, contas, cartoes, nomePorMembroId, onSalvo }) {
  const [lancamentoAberto, setLancamentoAberto] = useState(false);

  const doMes = useMemo(() => lancamentos.filter((l) => l.tipo === "receita" && l.data >= inicioMesISO()), [lancamentos]);
  const total = useMemo(() => doMes.reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const porFonte = useMemo(() => {
    const m = {};
    for (const l of doMes) m[l.categoria] = (m[l.categoria] || 0) + Number(l.valor);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [doMes]);

  async function excluir(id) {
    if (!confirm("Excluir esta receita?")) return;
    const { error } = await supabase.from("lancamentos").delete().eq("id", id);
    if (error) return alert(error.message);
    onSalvo();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: C.greenSoft, borderRadius: 22, padding: 22 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.greenTextAlt }}>Receitas · mês</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.greenText, marginTop: 4 }}>{moeda(total)}</div>
      </div>

      <NovoLancamento
        membroLogado={membro} membros={membros} contas={contas} cartoes={cartoes} tipoInicial="receita"
        aberto={lancamentoAberto} onAbrir={() => setLancamentoAberto(true)} onFechar={() => setLancamentoAberto(false)} onSalvo={onSalvo}
      />

      {porFonte.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Por fonte</div>
          {porFonte.map(([chave, valor]) => (
            <div key={chave} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13.5, color: C.ink }}>{FONTES_RECEITA.find((f) => f.chave === chave)?.label || chave}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.greenText }}>{moeda(valor)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "6px 16px" }}>
        {doMes.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, padding: "14px 0" }}>Nenhuma receita lançada este mês ainda.</div>}
        {doMes.map((l) => (
          <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{l.descricao || FONTES_RECEITA.find((f) => f.chave === l.categoria)?.label || l.categoria}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{nomePorMembroId?.[l.membro_id] || "?"} · {l.data}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.greenText }}>+{moeda(l.valor)}</span>
              <button onClick={() => excluir(l.id)} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 12, cursor: "pointer" }}>excluir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
