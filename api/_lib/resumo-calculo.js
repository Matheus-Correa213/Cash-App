// Cálculo do resumo mensal que o COSMO consome (api/resumo.js). Mora aqui, separado do banco, para ser testável.
//
// REGRA (igual ao Painel e à tela Gastos do app): só conta como gasto o dinheiro que saiu de conta,
// ou seja, lançamentos SEM cartao_id. Compra no cartão só vira dinheiro saindo quando a fatura é paga, e
// esse pagamento já é um lançamento sem cartao_id. Somar as compras E a fatura contaria o mesmo gasto duas
// vezes (era o que fazia o COSMO mostrar R$ 20.688 de gastos quando o Painel mostrava R$ 8.406).

const SEM_CATEGORIA = "__sem_categoria__"; // mesma chave de src/theme.js

/** AAAA-MM-DD do primeiro dia do mês corrente, no horário de Brasília (e não UTC: à noite do último dia do mês, UTC já é o mês seguinte). */
export function inicioDoMes(agora = new Date()) {
  return agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7) + "-01";
}

const arredonda = (n) => Number(Number(n).toFixed(2));

/** Saldo de cada conta: saldo_inicial + receitas − gastos lançados nela + transferências recebidas − enviadas
 *  (mesma lógica da RPC saldos_contas(), migração 18). Transferência NÃO entra em gastos/receitas — só move saldo. */
export function saldosPorConta(lancamentos = [], contas = [], transferencias = []) {
  const saldo = Object.fromEntries(contas.map((c) => [c.id, Number(c.saldo_inicial) || 0]));
  for (const t of transferencias) {
    const valor = Number(t.valor) || 0;
    if (t.destino_conta_id && t.destino_conta_id in saldo) saldo[t.destino_conta_id] += valor;
    if (t.origem_conta_id && t.origem_conta_id in saldo) saldo[t.origem_conta_id] -= valor;
  }
  for (const l of lancamentos) {
    if (!l.conta_id || !(l.conta_id in saldo)) continue;
    const valor = Number(l.valor) || 0;
    if (l.tipo === "receita") saldo[l.conta_id] += valor;
    else if (l.tipo === "gasto") saldo[l.conta_id] -= valor;
  }
  return saldo;
}

export function calcularResumo({ lancamentos = [], membros = [], contas = [], categorias = [], transferencias = [], inicioMesISO }) {
  const nomesPorId = Object.fromEntries(membros.map((m) => [m.id, m.nome]));
  const rotulo = {};
  for (const c of categorias) if (c.tipo === "gasto") rotulo[c.chave] = c.label;
  const nomeCategoria = (chave) => (chave === SEM_CATEGORIA ? "Ainda sem categoria" : rotulo[chave] || chave);

  const doMes = lancamentos.filter((l) => l.data >= inicioMesISO); // mesmo recorte do Painel (data >= início do mês)
  let totalGastos = 0, totalReceitas = 0, comprasNoCartao = 0;
  const porCategoria = {}, porMembro = {};
  for (const l of doMes) {
    const valor = Number(l.valor) || 0;
    if (l.tipo === "gasto") {
      if (l.cartao_id) { comprasNoCartao += valor; continue; } // vira gasto quando a fatura é paga
      totalGastos += valor;
      const cat = nomeCategoria(l.categoria);
      porCategoria[cat] = (porCategoria[cat] || 0) + valor;
      const nome = nomesPorId[l.membro_id] || "desconhecido";
      porMembro[nome] = (porMembro[nome] || 0) + valor;
    } else if (l.tipo === "receita") totalReceitas += valor;
  }

  // Saldo real: saldo_inicial de cada conta + todos os lançamentos dela (mesma lógica da RPC saldos_contas()), sem poupança.
  const saldoPorConta = saldosPorConta(lancamentos, contas, transferencias);
  const saldo = contas.filter((c) => c.tipo !== "poupanca").reduce((s, c) => s + (saldoPorConta[c.id] ?? 0), 0);

  const arred = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, arredonda(v)]));
  return {
    mes_referencia: inicioMesISO.slice(0, 7),
    total_gastos: arredonda(totalGastos),
    total_receitas: arredonda(totalReceitas),
    saldo: arredonda(saldo),
    compras_no_cartao_no_mes: arredonda(comprasNoCartao),
    gastos_por_categoria: arred(porCategoria),
    gastos_por_membro: arred(porMembro),
    membros: membros.map((m) => ({ nome: m.nome, papel: m.papel, mesada_mensal: m.mesada_mensal })),
  };
}
