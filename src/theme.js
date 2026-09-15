// Paleta de cores do Cash App — vive no seu próprio arquivo, sem importar nada
// de volta, de propósito. Antes, essa constante morava dentro de AuthGate.jsx
// e era importada por App.jsx — mas AuthGate.jsx também importa App.jsx, o que
// forma um ciclo de módulos (A importa B, B importa A). Depois de minificado
// pra produção, esse ciclo fazia o navegador tentar usar a paleta ANTES dela
// ser inicializada (erro "Cannot access 'C' before initialization" — TDZ do
// JavaScript), deixando a tela inteira em branco sem nenhum erro visível além
// do console. Isolando a paleta aqui, ninguém mais precisa importar
// AuthGate.jsx só pra pegar uma cor, e o ciclo desaparece.
// Paleta atualizada 16/09/2026 pra usar as cores de verdade da marca Correa
// Cash (extraídas por amostragem da própria logo, mesmo processo usado pra
// gerar os ícones): azul da carteira, dourado do "CC", verde das notinhas, e o
// azul-marinho do fundo escuro da logo. O "accent" (usado em botões e valores
// positivos em todo o app) trocou do verde genérico de antes pro azul da
// marca — o resto do app ganha a identidade visual de graça, sem precisar
// mexer em cada tela.
export const C = {
  bg: "#F4F5F3",
  card: "#FFFFFF",
  ink: "#1C1E1B",
  inkMute: "#5B5F58",
  inkFaint: "#8A8E85",
  line: "#E3E5E0",
  accent: "#0469FB",
  accentSoft: "#E7F0FE",
  danger: "#B3432B",
  gold: "#FFC800",
  green: "#2ED191",
  navy: "#030F31",
};
