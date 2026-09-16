import React from "react";
import { instituicaoDe } from "./theme.js";

// Selo colorido com a sigla de cada instituição (ex: "Nu" pro Nubank, "MP"
// pro Mercado Pago) pra dar aquele reconhecimento rápido de "logo" no rosto
// do cartão/conta. Optamos por isso em vez de desenhar os logos oficiais dos
// bancos/bandeiras (evita reproduzir marca registrada de terceiros) — mas
// com a cor real de cada instituição (já extraída do mockup em theme.js),
// o efeito visual de "reconheço esse cartão de cara" é o mesmo.
//
// `claro=true` é pro selo em cima do próprio gradiente colorido daquela
// instituição (o cartão de crédito, por exemplo) — aí um selo sólido da
// mesma cor ficaria invisível, então usamos um vidro fosco branco.
export default function LogoInstituicao({ nome, size = 30, claro = false }) {
  const inst = instituicaoDe(nome);
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.32, flexShrink: 0,
        background: claro ? "rgba(255,255,255,0.22)" : inst.cor,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <span style={{ fontSize: size * 0.36, fontWeight: 800, color: "#fff", letterSpacing: "-0.2px" }}>{inst.sigla}</span>
    </div>
  );
}
