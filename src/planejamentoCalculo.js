// Cálculo do planejamento de um mês — uma fonte só, usada pela tela
// (Planejamento.jsx) e pelo chat do COSMO (ChatCosmo.jsx, pra ele enxergar o
// mesmo número que a pessoa vê na tela).
//
// PREVISTO de um item num mês = valor específico do mês (só item variável) ??
// valor padrão do item (fixo: o valor de sempre; variável: aproximado).
// PAGO = planejamento_pagamentos.valor_pago (marcação manual, por item e mês).

import { mesDaFatura } from "./theme.js";

export function calcularItensDoMes(itens, pagamentos, valoresMes, mes, vencimentosMes) {
  const pagamentoPorItem = new Map(
    (pagamentos || []).filter((p) => p.mes.slice(0, 7) === mes).map((p) => [p.item_id, p])
  );
  const valorMesPorItem = new Map(
    (valoresMes || []).filter((v) => v.mes.slice(0, 7) === mes).map((v) => [v.item_id, Number(v.valor)])
  );
  // Vencimento de verdade num OUTRO mês (migração 17): "a conta de outubro que
  // venceu em 28/09". Vale só pro mês em que o item aparece.
  const vencimentoPorItem = new Map(
    (vencimentosMes || []).filter((v) => v.mes.slice(0, 7) === mes).map((v) => [v.item_id, String(v.vencimento).slice(0, 10)])
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
      const vencOutroMes = vencimentoPorItem.get(i.id) || null; // "YYYY-MM-DD" ou null
      return {
        ...i,
        // dia_vencimento aqui já é o EFETIVO (o do vencimento de outro mês, se houver);
        // o dia que está cadastrado no item fica em diaDoItem (o formulário usa esse).
        diaDoItem: i.dia_vencimento ?? null,
        dia_vencimento: vencOutroMes ? Number(vencOutroMes.slice(8, 10)) : i.dia_vencimento,
        vencimentoOutroMes: vencOutroMes,
        // Venceu antes do mês do planejamento e ainda não foi pago = VENCIDO, prioridade.
        vencidoAntes: !!vencOutroMes && vencOutroMes.slice(0, 7) < mes && !pagamento,
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
    .sort(comparaPrioridade);
}

// Em aberto antes dos pagos; dentro dos em aberto, os VENCIDOS de mês anterior
// primeiro (mais antigo primeiro), depois por dia de vencimento.
export function comparaPrioridade(a, b) {
  if (a.pago !== b.pago) return a.pago ? 1 : -1;
  if (!!a.vencidoAntes !== !!b.vencidoAntes) return a.vencidoAntes ? -1 : 1;
  if (a.vencidoAntes && b.vencidoAntes) return a.vencimentoOutroMes.localeCompare(b.vencimentoOutroMes);
  return (a.dia_vencimento ?? 99) - (b.dia_vencimento ?? 99);
}

// Resumo compacto pro COSMO (vai no corpo do POST do /api/chat). `meses` são
// "YYYY-MM"; cada item leva só o que importa pra decidir estratégia de
// pagamento: vencimento, valor previsto, se é aproximado, se já foi pago.
export function resumoPlanejamentoParaCosmo({ itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, frentesGasto, meses }) {
  const rotulo = (c) => (c === "__cartao__" ? "Cartão de crédito" : (frentesGasto || []).find((f) => f.chave === c)?.label || c);
  return meses.map((mes) => ({
    mes,
    itens: itensDoMesComFaturas({ itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, mes }).map((i) => ({
      nome: i.nome,
      categoria: rotulo(i.categoria),
      dia_vencimento: i.dia_vencimento ?? null, // null = sem data (coisa pessoal, sem vencimento fixo)
      // Venceu em OUTRO mês (anterior) e não foi pago: data completa + marca de vencido.
      ...(i.vencimentoOutroMes ? { data_vencimento: i.vencimentoOutroMes, vencido_de_mes_anterior: !!i.vencidoAntes } : {}),
      recorrencia: i.ehCartao ? "fatura do cartão" : i.recorrente ? "todo mês" : "só neste mês",
      valor_previsto: i.previsto,               // null = ainda sem valor
      valor_aproximado: !!i.aproximado,
      pago: i.pago,
      valor_pago: i.pago ? i.valorReal : null,
      ...(i.ehCartao ? { origem: "fatura_cartao", fecha_dia: i.diaFechamento, ainda_recebendo_compras: i.aberta } : {}),
    })),
  }));
}

// Ordem de uma lista do planejamento: em aberto primeiro, depois por vencimento.
export function ordenarItens(lista) {
  return [...lista].sort(comparaPrioridade);
}

// FATURA DO CARTÃO no planejamento (pedido do Matheus, 02/10/2026: "aparecer a
// fatura do cartão e ela ir se atualizando sozinha, conforme vamos lançando
// compras nele, até o dia 20"). Não é um item digitado: é calculada ao vivo dos
// lançamentos do cartão, então cada compra lançada (à mão, pelo chat ou por
// OFX) já aparece aqui, até o dia de fechamento.
//
// Qual fatura cai em qual mês do planejamento? A que VENCE nesse mês. Se o
// vencimento é depois do fechamento (fecha dia 20, vence dia 27) a fatura do
// ciclo que fecha em outubro vence em outubro; se o vencimento é antes (fecha
// 25, vence 5), a que fecha em setembro vence em outubro.
//
// O valor é o mesmo que a tela do cartão mostra: compras do ciclo + a "fatura
// inicial" quando é o ciclo atual. "pago" = o ciclo tem compras e todas já
// estão marcadas como fatura paga (feito em "Pagar fatura" no cartão).
export function faturasDeCartaoDoMes({ cartoes, lancamentosCartao, mes, hoje = new Date() }) {
  const pad = (n) => String(n).padStart(2, "0");
  const hojeISO = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
  const hojeMes = hojeISO.slice(0, 7);
  const mesAnterior = (ym) => { const [a, m] = ym.split("-").map(Number); return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7); };
  const ultimoDia = (ym) => { const [a, m] = ym.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };
  const saida = [];
  for (const k of cartoes || []) {
    const fech = k.dia_fechamento ?? null, venc = k.dia_vencimento ?? null;
    const bucket = fech && venc && venc <= fech ? mesAnterior(mes) : mes;
    const todas = (lancamentosCartao || []).filter((l) => l.cartao_id === k.id);
    const doCiclo = todas.filter((l) => mesDaFatura(l.data, fech) === bucket);
    const abertas = doCiclo.filter((l) => !l.fatura_paga);
    // "ciclo atual" do cartão = o primeiro mês com compra em aberto de hoje em diante (igual à tela do cartão)
    const mesesAbertos = todas.filter((l) => !l.fatura_paga).map((l) => mesDaFatura(l.data, fech)).filter((m) => m >= hojeMes).sort();
    const cicloAtual = mesesAbertos[0] || hojeMes;
    const inicial = bucket === cicloAtual ? Number(k.fatura_inicial || 0) : 0;
    const total = doCiclo.reduce((s, l) => s + Number(l.valor), 0) + inicial;
    if (doCiclo.length === 0 && inicial === 0) continue;
    const pago = doCiclo.length > 0 && abertas.length === 0 && inicial === 0;
    const fechaEm = fech ? `${bucket}-${pad(Math.min(fech, ultimoDia(bucket)))}` : null;
    const aberta = !!fechaEm && hojeISO <= fechaEm && !pago;
    const diasParaFechar = fechaEm ? Math.round((Date.parse(`${fechaEm}T00:00:00Z`) - Date.parse(`${hojeISO}T00:00:00Z`)) / 86400000) : null;
    saida.push({
      id: `cartao:${k.id}`, ehCartao: true, cartaoId: k.id, nome: `Fatura ${k.nome}`, categoria: "__cartao__",
      dia_vencimento: venc, recorrente: true, tipo_valor: "fixo", valor_fixo: total,
      pago, valorReal: pago ? total : 0, valorMes: null, previsto: total, aproximado: false, previstoSoma: total,
      aberta, fechaEm, diasParaFechar, diaFechamento: fech, mesFatura: bucket,
    });
  }
  return saida;
}

// Itens do mês já com as faturas dos cartões — o que a tela e o COSMO usam.
export function itensDoMesComFaturas({ itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, mes, hoje }) {
  return ordenarItens([
    ...calcularItensDoMes(itens || [], pagamentos || [], valoresMes || [], mes, vencimentosMes || []),
    ...faturasDeCartaoDoMes({ cartoes, lancamentosCartao, mes, hoje }),
  ]);
}

// PROJEÇÃO MÊS A MÊS pro COSMO responder "e nos outros meses, como fica?" —
// pedido do Matheus (02/10/2026): o COSMO ler os boletos recorrentes e as
// faturas dos cartões que já existem e falar da DIFERENÇA de gastos entre os meses.
//
// Por mês: o que está previsto em boletos/contas do planejamento + o que as
// faturas dos cartões já têm lançado (parcelas e compras já no app, inclusive as
// vindas de OFX) e a diferença pro mês anterior, com o que explica a mudança
// (o que entrou, o que saiu, o que mudou de valor). Compras de cartão ainda não
// feitas NÃO existem aqui — as faturas dos meses de frente só têm parcelas e
// compras já lançadas, então tendem a ser menores do que serão de verdade.
export function projecaoMensal({ itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, frentesGasto, mesInicial, quantidade = 12, hoje }) {
  const somar = (ym, n) => { const [a, m] = ym.split("-").map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
  const arred = (n) => Math.round(n * 100) / 100;
  const rotulo = (c) => (frentesGasto || []).find((f) => f.chave === c)?.label || c;
  const meses = [];
  let anterior = null;
  for (let k = 0; k < quantidade; k++) {
    const mes = somar(mesInicial, k);
    const todos = itensDoMesComFaturas({ itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, mes, hoje });
    const boletos = todos.filter((i) => !i.ehCartao);
    const faturas = todos.filter((i) => i.ehCartao);
    const totalBoletos = boletos.reduce((s, i) => s + (i.previstoSoma || 0), 0);
    const totalCartoes = faturas.reduce((s, i) => s + (i.previstoSoma || 0), 0);
    const total = totalBoletos + totalCartoes;
    // Mapa por "nome" pra comparar com o mês anterior.
    const mapa = new Map([...boletos, ...faturas].map((i) => [i.nome, i]));
    const registro = {
      mes,
      total_boletos: arred(totalBoletos),
      total_faturas_cartao: arred(totalCartoes),
      total_geral: arred(total),
      faturas_por_cartao: faturas.map((i) => ({ cartao: i.nome.replace(/^Fatura /, ""), valor: arred(i.previsto), vence_dia: i.dia_vencimento ?? null })),
      boletos_sem_valor_definido: boletos.filter((i) => i.previstoSoma === 0 && i.previsto == null).map((i) => i.nome),
      boletos_com_valor_aproximado: boletos.filter((i) => i.aproximado).length,
    };
    if (anterior) {
      const dif = total - anterior.total;
      registro.diferenca_vs_mes_anterior = arred(dif);
      registro.diferenca_boletos = arred(totalBoletos - anterior.totalBoletos);
      registro.diferenca_faturas_cartao = arred(totalCartoes - anterior.totalCartoes);
      registro.entrou_neste_mes = [...mapa.values()].filter((i) => !anterior.mapa.has(i.nome) && (i.previstoSoma || 0) > 0).map((i) => ({ item: i.nome, valor: arred(i.previstoSoma), tipo: i.ehCartao ? "fatura do cartão" : i.recorrente ? "todo mês" : "só neste mês" }));
      registro.saiu_neste_mes = [...anterior.mapa.values()].filter((i) => !mapa.has(i.nome) && (i.previstoSoma || 0) > 0).map((i) => ({ item: i.nome, valor: arred(i.previstoSoma), tipo: i.ehCartao ? "fatura do cartão" : i.recorrente ? "todo mês" : "só no mês anterior" }));
      registro.mudou_de_valor = [...mapa.values()].filter((i) => anterior.mapa.has(i.nome) && Math.abs((i.previstoSoma || 0) - (anterior.mapa.get(i.nome).previstoSoma || 0)) > 0.005)
        .map((i) => ({ item: i.nome, de: arred(anterior.mapa.get(i.nome).previstoSoma || 0), para: arred(i.previstoSoma || 0) }));
    }
    meses.push(registro);
    anterior = { total, totalBoletos, totalCartoes, mapa };
  }
  // Os boletos/contas que se repetem todo mês (a "base fixa" do planejamento).
  const recorrentes = (itens || []).filter((i) => i.recorrente).map((i) => ({
    nome: i.nome, categoria: rotulo(i.categoria), dia_vencimento: i.dia_vencimento ?? null,
    valor_padrao: i.valor_fixo != null ? Number(i.valor_fixo) : null, valor_varia_por_mes: i.tipo_valor === "variavel",
  }));
  return { meses, boletos_recorrentes: recorrentes };
}
