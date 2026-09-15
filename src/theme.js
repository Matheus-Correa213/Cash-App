// Paleta de cores do Cash App — vive no seu próprio arquivo, sem importar nada
// de volta, de propósito (ver comentário histórico na versão anterior: um
// ciclo de módulos com AuthGate.jsx já deixou a tela em branco uma vez).
//
// Redesign 16/09/2026 — paleta trazida direto do mockup aprovado no Design
// Canvas (5 rodadas: painel/receitas/gastos, contas reais, chat+importar,
// painel simplificado). Fonte Manrope, cores por "papel" (receita = verde,
// gasto = coral, recorrente/investimento = roxo, COSMO = azul da marca +
// navy), mais duas tabelas de apoio: INSTITUICOES (cor de cada banco/cartão
// real da família) e FRENTES_GASTO (as 6 categorias de gasto da doutrina
// financeira do COSMO).
export const C = {
  bg: "#F4F6FB",
  bgAlt: "#EDEFF5",
  card: "#FFFFFF",
  ink: "#12203D",
  inkMute: "#5B647A",
  inkFaint: "#8A93A8",
  line: "#EEF0F6",
  lineStrong: "#E7EAF3",

  accent: "#0469FB",       // azul da marca / COSMO
  accentSoft: "#E7F0FE",
  gold: "#FFC800",
  navy: "#0B1E3D",
  navyDeep: "#123166",

  green: "#1FAE7A",        // receitas
  greenSoft: "#E7FAF1",
  greenText: "#0B6B4A",
  greenTextAlt: "#12805A",

  coral: "#FF5A5F",        // gastos
  coralSoft: "#FFEEEF",
  coralText: "#B3272C",
  coralTextAlt: "#C23A3E",

  purple: "#7C5CFC",       // recorrentes / investimentos / assinaturas
  purpleSoft: "#EFEAFE",

  amber: "#F5934B",        // avisos/risco (ex: saldo pode não cobrir)
  amberSoft: "#FFF8E6",
  amberBorder: "#FFE29A",
  amberText: "#B85D22",

  danger: "#B3272C",       // alias usado em código mais antigo
};

// Cor de cada instituição real da família — usada em Contas/Cartões pra dar
// aquele efeito "igual app de banco" sem depender de logos de verdade. A
// checagem é por substring (case-insensitive) no nome que o Matheus digitar,
// então "Nubank Alessia" ou "Cartão Nubank" batem do mesmo jeito.
export const INSTITUICOES = [
  { chave: "nubank", nome: "Nubank", cor: "#8A05BE", corEscura: "#3D0159", sigla: "Nu" },
  { chave: "inter", nome: "Inter", cor: "#FF7A00", corEscura: "#B85400", sigla: "In" },
  { chave: "mercado pago", nome: "Mercado Pago", cor: "#00AAFF", corEscura: "#0469FB", sigla: "MP" },
  { chave: "revolut", nome: "Revolut", cor: "#12203D", corEscura: "#030F31", sigla: "Re" },
  { chave: "banco do brasil", nome: "Banco do Brasil", cor: "#F5C400", corEscura: "#B89400", sigla: "BB" },
  { chave: "bb", nome: "Banco do Brasil", cor: "#F5C400", corEscura: "#B89400", sigla: "BB" },
];

const INSTITUICAO_PADRAO = { chave: "", nome: "", cor: "#5B647A", corEscura: "#38415A", sigla: "?" };

export function instituicaoDe(nomeOuInstituicao) {
  const alvo = String(nomeOuInstituicao || "").toLowerCase();
  const achada = INSTITUICOES.find((i) => alvo.includes(i.chave));
  if (achada) return achada;
  const sigla = String(nomeOuInstituicao || "?").trim().slice(0, 2).toUpperCase() || "?";
  return { ...INSTITUICAO_PADRAO, sigla };
}

// As 6 "frentes de gasto" da doutrina financeira do COSMO — cada uma com sua
// cor, pra tela de Gastos e o widget de categorias do Painel.
export const FRENTES_GASTO = [
  { chave: "dia_a_dia", label: "Dia a dia", cor: "#0469FB", corSoft: "#E7F0FE", corTexto: "#0353c9" },
  { chave: "recorrentes", label: "Recorrentes", cor: "#7C5CFC", corSoft: "#EFEAFE", corTexto: "#5B3FD9" },
  { chave: "reserva", label: "Reserva/Investimentos", cor: "#E3A400", corSoft: "#FFF6DA", corTexto: "#8A6300" },
  { chave: "projetos", label: "Projetos", cor: "#0EA5A0", corSoft: "#E1F7F6", corTexto: "#0B7B77" },
  { chave: "casa_familia", label: "Casa/família", cor: "#E85D8A", corSoft: "#FDE9F0", corTexto: "#C23A6B" },
  { chave: "saude", label: "Saúde", cor: "#F5934B", corSoft: "#FFF1E4", corTexto: "#B85D22" },
];

export function frenteDe(categoria) {
  return FRENTES_GASTO.find((f) => f.chave === categoria) || { chave: categoria, label: categoria, cor: C.inkMute, corSoft: C.line, corTexto: C.inkMute };
}

// Fontes de receita — mais simples, sem cor própria por enquanto (a tela de
// Receitas usa sempre o verde), mas nomeadas pra manter o vocabulário da
// doutrina financeira consistente em toda a família de apps do COSMO.
export const FONTES_RECEITA = [
  { chave: "trabalho", label: "Trabalho principal" },
  { chave: "correa_books", label: "Corrêa Books" },
  { chave: "freelas", label: "Freelas" },
  { chave: "outros", label: "Outros" },
];

export function moeda(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}

export function inicioMesISO(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  return x.toISOString().slice(0, 10);
}

// Soma meses a uma data ISO (YYYY-MM-DD) preservando o dia quando possível —
// usado pra espalhar as parcelas de uma compra pelos meses seguintes.
export function somarMeses(dataISO, meses) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + meses, dia));
  return d.toISOString().slice(0, 10);
}

// Em qual "mês de fatura" uma compra cai, dado o dia de fechamento do cartão.
// Compras depois do fechamento entram na fatura do mês seguinte — mesma regra
// que qualquer cartão de crédito de verdade usa.
export function mesDaFatura(dataISO, diaFechamento) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  if (!diaFechamento || dia <= diaFechamento) return `${ano}-${String(mes).padStart(2, "0")}`;
  const d = new Date(Date.UTC(ano, mes, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
