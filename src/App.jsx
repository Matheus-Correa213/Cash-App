import React, { useState } from "react";
import { C } from "./theme.js";
import { IconCosmo, IconChevronDown, IconClose } from "./Icons.jsx";
import OwnerView from "./OwnerView.jsx";
import MemberView from "./MemberView.jsx";

// Cabeçalho fixo do app inteiro — antes disso ser trocado, tudo que o
// Matheus enxergava logo de cara era a barra genérica antiga ("Correa Cash /
// nome · papel / Sair"), que sobrou de antes do redesign e nunca foi
// atualizada junto com o resto: por ficar no topo de toda tela, ela sozinha
// já dava a impressão de "app não terminado" mesmo com Painel/Receitas/etc.
// já redesenhados por baixo. Agora segue o mesmo cabeçalho do mockup
// (logo + nome do app + selo "COSMO sincronizado"), com o menu de
// nome/sair escondido atrás de um toque no selo, pra não perder a função.
const shellStyle = { minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, sans-serif" };
const headerStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${C.line}`, background: C.card, position: "relative" };

export default function App({ membro, onSignOut, onMembroAtualizado }) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <img src="/icon-192.png" alt="Correa Cash" style={{ width: 30, height: 30, borderRadius: 8 }} />
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.2px", color: C.ink }}>Correa Cash</span>
        </div>

        <button
          onClick={() => setMenuAberto((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 5, background: C.accentSoft, border: "none", padding: "6px 10px 6px 8px", borderRadius: 100, cursor: "pointer" }}
        >
          <IconCosmo size={13} color={C.accent} strokeWidth={1.9} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.accent, letterSpacing: "0.2px" }}>COSMO sincronizado</span>
          <IconChevronDown size={11} color={C.accent} strokeWidth={2.2} />
        </button>

        {menuAberto && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 20, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: "0 10px 30px rgba(18,32,61,0.12)", padding: 14, minWidth: 200, zIndex: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{membro.nome}</div>
                <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 2 }}>{membro.papel === "dono" ? "Administrador(a)" : "Acesso restrito"}</div>
              </div>
              <button onClick={() => setMenuAberto(false)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2 }}>
                <IconClose size={14} color={C.inkFaint} strokeWidth={2} />
              </button>
            </div>
            <button
              onClick={onSignOut}
              style={{ marginTop: 12, width: "100%", textAlign: "left", background: "transparent", border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 700, color: C.coralText, cursor: "pointer" }}
            >
              Sair
            </button>
          </div>
        )}
      </header>
      {membro.papel === "dono"
        ? <OwnerView membro={membro} onMembroAtualizado={onMembroAtualizado} />
        : <MemberView membro={membro} />}
    </div>
  );
}
