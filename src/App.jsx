import React from "react";
import { C } from "./AuthGate.jsx";
import OwnerView from "./OwnerView.jsx";
import MemberView from "./MemberView.jsx";

const headerStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${C.line}`, background: C.card };
const shellStyle = { minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, sans-serif" };
const signOutBtn = { background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 12px", fontSize: 13, color: C.inkMute, cursor: "pointer" };

export default function App({ membro, onSignOut, onMembroAtualizado }) {
  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>Cash App</div>
          <div style={{ fontSize: 12.5, color: C.inkFaint }}>{membro.nome} · {membro.papel === "dono" ? "administrador(a)" : "acesso restrito"}</div>
        </div>
        <button style={signOutBtn} onClick={onSignOut}>Sair</button>
      </header>
      {membro.papel === "dono"
        ? <OwnerView membro={membro} onMembroAtualizado={onMembroAtualizado} />
        : <MemberView membro={membro} />}
    </div>
  );
}
