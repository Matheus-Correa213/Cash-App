// Paleta de cores do Cash App — vive no seu próprio arquivo, sem importar nada
// de volta, de propósito. Antes, essa constante morava dentro de AuthGate.jsx
// e era importada por App.jsx — mas AuthGate.jsx também importa App.jsx, o que
// forma um ciclo de módulos (A importa B, B importa A). Depois de minificado
// pra produção, esse ciclo fazia o navegador tentar usar a paleta ANTES dela
// ser inicializada (erro "Cannot access 'C' before initialization" — TDZ do
// JavaScript), deixando a tela inteira em branco sem nenhum erro visível além
// do console. Isolando a paleta aqui, ninguém mais precisa importar
// AuthGate.jsx só pra pegar uma cor, e o ciclo desaparece.
export const C = {
  bg: "#F4F5F3",
  card: "#FFFFFF",
  ink: "#1C1E1B",
  inkMute: "#5B5F58",
  inkFaint: "#8A8E85",
  line: "#E3E5E0",
  accent: "#2F6D4F",
  accentSoft: "#E7F1EC",
  danger: "#B3432B",
};
