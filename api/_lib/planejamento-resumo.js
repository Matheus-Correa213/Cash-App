// Planejamento do Cash em forma de relatório para o COSMO. Usa EXATAMENTE as mesmas funções da tela
// (src/planejamentoCalculo.js), então cada número daqui é o que o Planejamento do app mostra.
// Totais do mês = os três do topo da tela: previsto, pago e o que falta.
import { itensDoMesComFaturas, resumoPlanejamentoParaCosmo, projecaoMensal } from "../../src/planejamentoCalculo.js";

const arred = (n) => Math.round(Number(n) * 100) / 100;
const MES_OK = /^\d{4}-(0[1-9]|1[0-2])$/;
const somar = (ym, n) => { const [a, m] = ym.split("-").map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };

/** "2026-10,2026-11" → ["2026-10","2026-11"] (até 12, só meses válidos). Vazio = mês atual e o próximo. */
export function mesesPedidos(texto, hojeMes) {
  const lista = String(texto || "").split(",").map((x) => x.trim()).filter((x) => MES_OK.test(x));
  const uniq = [...new Set(lista)].slice(0, 12);
  return uniq.length ? uniq : [hojeMes, somar(hojeMes, 1)];
}

export function montarPlanejamento({ itens = [], pagamentos = [], valoresMes = [], vencimentosMes = [], cartoes = [], lancamentosCartao = [], categorias = [], meses, hoje = new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T12:00:00`), comProjecao = false }) {
  const frentesGasto = categorias.filter((c) => c.tipo === "gasto").map((c) => ({ chave: c.chave, label: c.label }));
  const base = { itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao };
  const detalhe = resumoPlanejamentoParaCosmo({ ...base, frentesGasto, meses });
  const out = meses.map((mes, k) => {
    const todos = itensDoMesComFaturas({ ...base, mes, hoje });
    return {
      mes,
      total_previsto: arred(todos.reduce((s, i) => s + i.previstoSoma, 0)),
      total_pago: arred(todos.filter((i) => i.pago).reduce((s, i) => s + i.valorReal, 0)),
      total_falta: arred(todos.filter((i) => !i.pago).reduce((s, i) => s + i.previstoSoma, 0)),
      itens_com_valor_aproximado_em_aberto: todos.filter((i) => !i.pago && i.aproximado).length,
      itens_sem_valor_em_aberto: todos.filter((i) => !i.pago && i.previsto == null).length,
      itens: detalhe[k].itens,
    };
  });
  const r = { meses: out };
  if (comProjecao) {
    const [mesInicial] = [...meses].sort();
    r.projecao = projecaoMensal({ ...base, frentesGasto, mesInicial, quantidade: 12, hoje });
  }
  return r;
}
