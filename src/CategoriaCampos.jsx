import React from "react";
import { C } from "./theme.js";
import { EMOJI_SUGERIDOS } from "./Icons.jsx";

// Pedaços de UI/lógica de "criar ou editar uma categoria" que precisavam ser
// usados em DOIS lugares depois da leva 13 (26/09/2026, pedido do Matheus:
// "ao invés de só na tela Categorias, poder criar categoria ao lançar um
// gasto ou receita, e ela já ficar salva") — a tela "Categorias" (criação
// completa, com escolha de tipo) e o formulário de "Novo lançamento"
// (criação rápida, tipo já é o do lançamento sendo feito). Vivia tudo dentro
// de Categorias.jsx; movido pra cá pra não duplicar a paleta de cores, o
// gerador de chave e os dois seletores visuais nos dois lugares.

// Paleta curada, nas mesmas cores já usadas no resto do app — pra uma
// categoria nova nunca destoar visualmente das fixas.
export const PALETA_CORES = [
  { cor: "#0469FB", corSoft: "#E7F0FE" },
  { cor: "#7C5CFC", corSoft: "#EFEAFE" },
  { cor: "#1FAE7A", corSoft: "#E7FAF1" },
  { cor: "#FF5A5F", corSoft: "#FFEEEF" },
  { cor: "#F5934B", corSoft: "#FFF1E4" },
  { cor: "#E3A400", corSoft: "#FFF6DA" },
  { cor: "#0EA5A0", corSoft: "#E1F7F6" },
  { cor: "#E85D8A", corSoft: "#FDE9F0" },
  { cor: "#8A05BE", corSoft: "#FDF3FF" },
  { cor: "#5B647A", corSoft: "#EEF0F6" },
];

// Transforma o nome digitado numa chave estável (sem acento, minúscula,
// espaços viram "_") — é essa chave, não o nome, que fica gravada em cada
// lançamento, então precisa ser previsível e nunca mudar depois de criada.
export function normalizarChave(nome) {
  return (
    String(nome || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    || "categoria"
  );
}

const inputEmoji = { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" };

export function SeletorCor({ valor, onEscolher }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {PALETA_CORES.map((p) => (
        <button
          key={p.cor} type="button" onClick={() => onEscolher(p)}
          style={{ width: 30, height: 30, borderRadius: "50%", background: p.cor, border: valor === p.cor ? `3px solid ${C.ink}` : "3px solid transparent", cursor: "pointer", padding: 0 }}
        />
      ))}
    </div>
  );
}

// Substitui a antiga galeria de ícones SVG (migração 12, 25/09/2026) — a
// pessoa digita/cola qualquer emoji no campo (no celular isso já abre o
// teclado de emoji nativo) ou toca numa das sugestões rápidas da grade.
export function SeletorEmoji({ valor, onEscolher }) {
  // Pega só o primeiro "grapheme" digitado/colado — evita que colar uma
  // frase inteira vire o "emoji" da categoria por engano.
  function aoDigitar(texto) {
    const graphemes = Array.from(texto.trim());
    onEscolher(graphemes.length ? graphemes[0] : "");
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: C.line, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
          {valor || "🙂"}
        </div>
        <input
          style={{ ...inputEmoji, width: 110, textAlign: "center", fontSize: 20 }}
          placeholder="🙂" value={valor || ""}
          onChange={(e) => aoDigitar(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {EMOJI_SUGERIDOS.map((e) => (
          <button
            key={e} type="button" onClick={() => onEscolher(e)}
            style={{ width: 36, height: 36, borderRadius: 10, background: valor === e ? C.ink : C.line, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
