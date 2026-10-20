// Contas dos Relatórios (20/10/2026) — separadas da tela pra poderem ser testadas.
//
// DUAS VISÕES de gasto por categoria:
//  • PARCIAL = só o dinheiro que saiu de conta/carteira (lançamentos SEM cartao_id).
//    Igual ao Painel e à tela Gastos — inclui o pagamento de fatura, que é dinheiro saindo.
//  • TOTAL = parcial + as compras feitas no cartão, sem contar o pagamento de fatura
//    (senão o mesmo gasto entraria duas vezes: na compra e no pagamento da fatura).
// Linhas negativas no cartão (pagamento antecipado/estorno) não são compra: ficam de fora.
// Transferência entre contas mora em outra tabela e nunca entra aqui.

export const CHAVE_FATURA = "fatura_cartao";
const num = (v) => Number(v) || 0;
const arred = (n) => Math.round(n * 100) / 100;

export function gastosPorCategoria(lancamentos = []) {
  const mapa = {};
  let parcial = 0, cartao = 0, contaSemFatura = 0, faturasPagas = 0;
  for (const l of lancamentos) {
    if (l.tipo !== "gasto") continue;
    const v = num(l.valor);
    const k = l.categoria;
    if (l.cartao_id) {
      if (v <= 0 || k === CHAVE_FATURA) continue;
      (mapa[k] ||= { conta: 0, cartao: 0 }).cartao += v;
      cartao += v;
    } else {
      (mapa[k] ||= { conta: 0, cartao: 0 }).conta += v;
      parcial += v;
      if (k === CHAVE_FATURA) faturasPagas += v; else contaSemFatura += v;
    }
  }
  const linhas = Object.entries(mapa).map(([chave, x]) => ({
    chave,
    conta: arred(x.conta), cartao: arred(x.cartao),
    parcial: arred(x.conta),
    total: chave === CHAVE_FATURA ? 0 : arred(x.conta + x.cartao),
  }));
  return {
    linhas,
    parcialTotal: arred(parcial),
    totalTotal: arred(contaSemFatura + cartao),
    contaSemFatura: arred(contaSemFatura),
    cartaoTotal: arred(cartao),
    faturasPagas: arred(faturasPagas),
  };
}

/** Compras por cartão no período: { [cartao_id]: { total, qtd, porCategoria: { [categoria]: valor } } } */
export function gastosPorCartao(lancamentos = []) {
  const m = {};
  for (const l of lancamentos) {
    if (l.tipo !== "gasto" || !l.cartao_id || l.categoria === CHAVE_FATURA) continue;
    const v = num(l.valor);
    if (v <= 0) continue;
    const c = (m[l.cartao_id] ||= { total: 0, qtd: 0, porCategoria: {} });
    c.total += v; c.qtd += 1;
    c.porCategoria[l.categoria] = (c.porCategoria[l.categoria] || 0) + v;
  }
  for (const c of Object.values(m)) {
    c.total = arred(c.total);
    for (const k of Object.keys(c.porCategoria)) c.porCategoria[k] = arred(c.porCategoria[k]);
  }
  return m;
}
