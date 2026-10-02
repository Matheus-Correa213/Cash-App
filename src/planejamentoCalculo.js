// Cálculo do planejamento de um mês — uma fonte só, usada pela tela
// (Planejamento.jsx) e pelo chat do COSMO (ChatCosmo.jsx, pra ele enxergar o
// mesmo número que a pessoa vê na tela).
//
// PREVISTO de um item num mês = valor específico do mês (só item variável) ??
// valor padrão do item (fixo: o valor de sempre; variável: aproximado).
// PAGO = planejamento_pagamentos.valor_pago (marcação manual, por item e mês).

export function calcularItensDoMes(itens, pagamentos, valoresMes, mes) {
  const pagamentoPorItem = new Map(
    (pagamentos || []).filter((p) => p.mes.slice(0, 7) === mes).map((p) => [p.item_id, p])
  );
  const valorMesPorItem = new Map(
    (valoresMes || []).filter((v) => v.mes.slice(0, 7) === mes).map((v) => [v.item_id, Number(v.valor)])
  );
  return itens
    .filter((i) => i.recorrente || (i.mes_especifico && i.mes_especifico.slice(0, 7) === mes))
    .map((i) => {
      const pagamento = pagamentoPorItem.get(i.id);
      // Valor específico de um mês só existe pra item VARIÁVEL. Item fixo é
      // fixo (pedido do Matheus, 02/10/2026: "se é fixo, é fixo"): ignora
      // qualquer valor de mês que sobrou de quando o item era variável.
      const valorMes = i.tipo_valor === "variavel" && valorMesPorItem.has(i.id) ? valorMesPorItem.get(i.id) : null;
      const padrao = i.valor_fixo != null ? Number(i.valor_fixo) : null;
      const previsto = valorMes != null ? valorMes : padrao; // null = sem valor nenhum
      const valorReal = pagamento ? Number(pagamento.valor_pago) : 0;
      return {
        ...i,
        pago: !!pagamento,
        valorReal,
        valorMes,
        previsto,
        // Aproximado = item variável usando só o valor padrão (nenhum valor do mês).
        aproximado: valorMes == null && i.tipo_valor === "variavel" && padrao != null,
        // O que entra na soma do previsto: o planejado; sem planejado mas já
        // pago, o próprio pago (o previsto nunca fica abaixo do que já saiu).
        previstoSoma: previsto != null ? previsto : valorReal,
      };
    })
    .sort((a, b) => {
      if (a.pago !== b.pago) return a.pago ? 1 : -1;
      const da = a.dia_vencimento ?? 99, db = b.dia_vencimento ?? 99;
      return da - db;
    });
}

// Resumo compacto pro COSMO (vai no corpo do POST do /api/chat). `meses` são
// "YYYY-MM"; cada item leva só o que importa pra decidir estratégia de
// pagamento: vencimento, valor previsto, se é aproximado, se já foi pago.
export function resumoPlanejamentoParaCosmo({ itens, pagamentos, valoresMes, frentesGasto, meses }) {
  const rotulo = (c) => (frentesGasto || []).find((f) => f.chave === c)?.label || c;
  return meses.map((mes) => ({
    mes,
    itens: calcularItensDoMes(itens || [], pagamentos || [], valoresMes || [], mes).map((i) => ({
      nome: i.nome,
      categoria: rotulo(i.categoria),
      dia_vencimento: i.dia_vencimento ?? null, // null = sem data (coisa pessoal, sem vencimento fixo)
      recorrencia: i.recorrente ? "todo mês" : "só neste mês",
      valor_previsto: i.previsto,               // null = ainda sem valor
      valor_aproximado: !!i.aproximado,
      pago: i.pago,
      valor_pago: i.pago ? i.valorReal : null,
    })),
  }));
}
