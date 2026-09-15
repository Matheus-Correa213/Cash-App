import React from "react";

// Ícones em SVG inline, extraídos direto dos mockups do Design Canvas
// (aprovados por Matheus) — o motivo de existir esse arquivo é que a
// primeira versão portada pro código real trocou TODO ícone por um
// quadradinho/círculo de cor sólida (placeholder), o que deixou o app
// com cara de wireframe em vez do visual profissional do mockup. Este
// arquivo centraliza os mesmos traços SVG usados lá, como componentes
// React reutilizáveis, pra nunca mais cair nesse atalho.

function Svg({ size = 20, color = "currentColor", strokeWidth = 1.9, viewBox = "0 0 24 24", children, style }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {children}
    </svg>
  );
}

export function IconHomeNav(p) { return <Svg {...p}><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" /></Svg>; }
export function IconHouse(p) { return <Svg {...p}><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" /></Svg>; }
export function IconArrowUp(p) { return <Svg {...p}><line x1="12" y1="19" x2="12" y2="5" /><polyline points="6 11 12 5 18 11" /></Svg>; }
export function IconArrowDown(p) { return <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><polyline points="18 13 12 19 6 13" /></Svg>; }
export function IconGrid(p) { return <Svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Svg>; }
export function IconCard(p) { return <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><line x1="3" y1="10" x2="21" y2="10" /></Svg>; }
export function IconRefresh(p) { return <Svg {...p}><polyline points="17 2 21 6 17 10" /><path d="M3 12v-2a4 4 0 0 1 4-4h14" /><polyline points="7 22 3 18 7 14" /><path d="M21 12v2a4 4 0 0 1-4 4H3" /></Svg>; }
export function IconUpload(p) { return <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></Svg>; }
export function IconBarChart(p) { return <Svg {...p}><line x1="6" y1="20" x2="6" y2="12" /><line x1="12" y1="20" x2="12" y2="6" /><line x1="18" y1="20" x2="18" y2="15" /></Svg>; }
export function IconPlus(p) { return <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>; }
export function IconClose(p) { return <Svg {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></Svg>; }
export function IconChevronRight(p) { return <Svg {...p}><polyline points="9 18 15 12 9 6" /></Svg>; }
export function IconChevronLeft(p) { return <Svg {...p}><polyline points="15 18 9 12 15 6" /></Svg>; }
export function IconChevronDown(p) { return <Svg {...p}><polyline points="6 9 12 15 18 9" /></Svg>; }
export function IconChevronUp(p) { return <Svg {...p}><polyline points="6 15 12 9 18 15" /></Svg>; }
export function IconSettings(p) { return <Svg {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Svg>; }
export function IconCheck(p) { return <Svg {...p}><polyline points="20 6 9 17 4 12" /></Svg>; }
export function IconClock(p) { return <Svg {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></Svg>; }
export function IconAlertTriangle(p) { return <Svg {...p}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 2 18a1.8 1.8 0 0 0 1.6 2.7h16.8A1.8 1.8 0 0 0 22 18L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z" /></Svg>; }
export function IconInfoCircle(p) { return <Svg {...p}><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></Svg>; }
export function IconReceiptScan(p) { return <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></Svg>; }
export function IconBarChartAlt(p) { return <Svg {...p}><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></Svg>; }
export function IconHeartLike(p) { return <Svg {...p}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Svg>; }
export function IconSend(p) { return <Svg {...p}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></Svg>; }
export function IconPiggyBank(p) { return <Svg {...p}><path d="M4 12a6 6 0 0 1 6-6h4a6 6 0 0 1 5 2.7L21 9v4l-2 .5a6 6 0 0 1-1.8 3.3V19h-2v-1.2a6 6 0 0 1-2 .2H9v1H7v-1.6A6 6 0 0 1 4 12Z" /></Svg>; }
export function IconBasket(p) { return <Svg {...p}><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></Svg>; }
export function IconBriefcase(p) { return <Svg {...p}><path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z" /></Svg>; }
export function IconHeartHealth(p) { return <Svg {...p}><path d="M12 20s-7-4.4-9-9.3C1.7 7 3.6 4 6.8 4c1.9 0 3.3 1 4.2 2.4C11.9 5 13.3 4 15.2 4 18.4 4 20.3 7 19 10.7 17 15.6 12 20 12 20Z" /></Svg>; }
export function IconTrendingUp(p) { return <Svg {...p}><polyline points="4 16 10 10 14 13 20 6" /><polyline points="15 6 20 6 20 11" /></Svg>; }
export function IconCreditCard(p) { return <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2h-3a3 3 0 0 0 0 6h3v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></Svg>; }
export function IconBriefcase2(p) { return <Svg {...p}><rect x="3" y="8" width="18" height="11" rx="2" /><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>; }
export function IconBook(p) { return <Svg {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" /><path d="M4 18a2.5 2.5 0 0 1 2.5-2.5H20" /></Svg>; }
export function IconBolt(p) { return <Svg {...p} viewBox="0 0 24 24"><polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2" /></Svg>; }
export function IconDots({ size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1.6" fill={color} stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill={color} stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill={color} stroke="none" />
    </svg>
  );
}

// O ícone do próprio COSMO (o "olho"/órbita) em duas versões: uma simples
// (um anel só, usada em selos pequenos) e uma completa (dois anéis
// cruzados, usada como "logo" do assistente em telas maiores).
export function IconCash(p) { return <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 10v.01" /><path d="M18 14v.01" /></Svg>; }

export function IconUsers(p) { return <Svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>; }

export function IconCosmo(p) { return <Svg {...p}><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(28 12 12)" /></Svg>; }
export function IconCosmoFull(p) { return <Svg {...p}><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(28 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-28 12 12)" /></Svg>; }

// Mapas chave → ícone, pra emprestar em Gastos.jsx / Receitas.jsx / chips do
// NovoLancamento.jsx sem theme.js precisar importar JSX (theme.js é mantido
// de propósito sem importar nada de volta — ver comentário lá em cima dele).
export const ICONE_FRENTE_GASTO = {
  dia_a_dia: IconBasket,
  recorrentes: IconRefresh,
  reserva: IconPiggyBank,
  projetos: IconBriefcase,
  casa_familia: IconHouse,
  saude: IconHeartHealth,
};

export const ICONE_FONTE_RECEITA = {
  trabalho: IconBriefcase2,
  correa_books: IconBook,
  freelas: IconBolt,
  outros: IconDots,
};
