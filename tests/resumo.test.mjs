// Testa a conta do resumo que o COSMO lê. Rodar: node tests/resumo.test.mjs
import assert from "node:assert/strict";
import { calcularResumo, inicioDoMes, saldosPorConta } from "../api/_lib/resumo-calculo.js";

let ok = 0; const t = (n, f) => { try { f(); ok++; console.log("ok  ", n); } catch (e) { console.error("FALHOU", n, e); process.exitCode = 1; } };
const M = "2026-10-01";
const L = (o) => ({ tipo: "gasto", categoria: "outros", valor: 10, membro_id: "m1", data: "2026-10-05", conta_id: "c1", cartao_id: null, ...o });
const base = {
  membros: [{ id: "m1", nome: "Matheus", papel: "dono", mesada_mensal: 0 }],
  contas: [{ id: "c1", tipo: "corrente", saldo_inicial: 1000 }, { id: "p1", tipo: "poupanca", saldo_inicial: 5000 }],
  categorias: [{ tipo: "gasto", chave: "casa_familia", label: "Casa/família" }, { tipo: "gasto", chave: "boletos_recorrentes", label: "Boletos recorrentes" }],
  inicioMesISO: M,
};

t("compra no cartão NÃO entra nos gastos; a fatura paga (sem cartao_id) entra uma vez só", () => {
  const r = calcularResumo({ ...base, lancamentos: [
    L({ valor: 100, categoria: "casa_familia" }),
    L({ valor: 3000, categoria: "casa_familia", cartao_id: "k1", conta_id: null }), // compra no cartão
    L({ valor: 500, categoria: "__sem_categoria__", cartao_id: "k1", conta_id: null }), // compra ainda sem categoria
    L({ valor: 3500, categoria: "boletos_recorrentes", descricao: "fatura paga" }), // pagamento da fatura
    { ...L({}), tipo: "receita", valor: 9000, categoria: "salario" },
  ] });
  assert.equal(r.total_gastos, 3600);
  assert.equal(r.total_receitas, 9000);
  assert.equal(r.compras_no_cartao_no_mes, 3500);
  assert.deepEqual(r.gastos_por_categoria, { "Casa/família": 100, "Boletos recorrentes": 3500 });
  assert.equal(r.gastos_por_categoria["Ainda sem categoria"], undefined);
});

t("categoria aparece pelo nome; chave desconhecida fica como veio; sem categoria vira texto claro", () => {
  const r = calcularResumo({ ...base, lancamentos: [L({ categoria: "__sem_categoria__", valor: 7 }), L({ categoria: "estranha", valor: 3 })] });
  assert.equal(r.gastos_por_categoria["Ainda sem categoria"], 7);
  assert.equal(r.gastos_por_categoria.estranha, 3);
});

t("mês: lançamento do mês passado fica fora dos totais mas entra no saldo; saldo ignora poupança", () => {
  const r = calcularResumo({ ...base, lancamentos: [L({ valor: 40, data: "2026-09-20" }), L({ valor: 60 }), { ...L({}), tipo: "receita", valor: 200, data: "2026-09-02" }] });
  assert.equal(r.total_gastos, 60);
  assert.equal(r.total_receitas, 0);
  assert.equal(r.saldo, 1000 - 40 - 60 + 200);
  assert.equal(r.mes_referencia, "2026-10");
});

t("início do mês usa Brasília, não UTC", () => {
  assert.equal(inicioDoMes(new Date("2026-10-31T23:30:00-03:00")), "2026-10-01"); // 02:30 UTC de 1/11
  assert.equal(inicioDoMes(new Date("2026-11-01T00:10:00-03:00")), "2026-11-01");
});

t("gastos por pessoa só contam dinheiro de conta e arredondam", () => {
  const r = calcularResumo({ ...base, lancamentos: [L({ valor: 10.01 }), L({ valor: 0.1 }), L({ valor: 0.2 }), L({ valor: 99, cartao_id: "k" })] });
  assert.equal(r.gastos_por_membro.Matheus, 10.31);
});

import { montarPlanejamento, mesesPedidos } from "../api/_lib/planejamento-resumo.js";
const HOJE = new Date("2026-10-13T12:00:00");
const item = (o) => ({ id: "i1", nome: "Aluguel", categoria: "moradia", tipo_valor: "fixo", valor_fixo: 1500, dia_vencimento: 5, recorrente: true, mes_especifico: null, ...o });
const PLAN = {
  itens: [item({}), item({ id: "i2", nome: "Luz", tipo_valor: "variavel", valor_fixo: 200, dia_vencimento: 12 }), item({ id: "i3", nome: "Sem valor", valor_fixo: null, dia_vencimento: null }), item({ id: "i4", nome: "Só novembro", recorrente: false, mes_especifico: "2026-11-01", valor_fixo: 100 })],
  pagamentos: [{ item_id: "i1", mes: "2026-10-01", valor_pago: 1500 }],
  valoresMes: [{ item_id: "i2", mes: "2026-10-01", valor: 260 }],
  vencimentosMes: [],
  cartoes: [{ id: "k1", nome: "Nubank", dia_fechamento: 20, dia_vencimento: 27, fatura_inicial: 0 }],
  lancamentosCartao: [{ id: "a", cartao_id: "k1", valor: 300, data: "2026-10-10", fatura_paga: false }, { id: "b", cartao_id: "k1", valor: 50, data: "2026-10-12", fatura_paga: false }],
  categorias: [{ tipo: "gasto", chave: "moradia", label: "Moradia" }],
  hoje: HOJE,
};
t("planejamento: totais iguais aos do topo da tela (previsto, pago, falta) e itens com nome de categoria", () => {
  const r = montarPlanejamento({ ...PLAN, meses: ["2026-10"] });
  const m = r.meses[0];
  assert.equal(m.total_previsto, 1500 + 260 + 350); // aluguel + luz do mês (260) + fatura do cartão (350); "Sem valor" fora
  assert.equal(m.total_pago, 1500);
  assert.equal(m.total_falta, 260 + 350);
  assert.equal(m.itens_sem_valor_em_aberto, 1);
  const aluguel = m.itens.find((i) => i.nome === "Aluguel");
  assert.equal(aluguel.categoria, "Moradia"); assert.equal(aluguel.pago, true);
  assert.ok(m.itens.some((i) => i.recorrencia === "fatura do cartão" && i.valor_previsto === 350));
  assert.equal(r.projecao, undefined);
});
t("planejamento: item só de novembro não aparece em outubro; projeção opcional compara os meses", () => {
  const r = montarPlanejamento({ ...PLAN, meses: ["2026-10", "2026-11"], comProjecao: true });
  assert.ok(!r.meses[0].itens.some((i) => i.nome === "Só novembro"));
  assert.ok(r.meses[1].itens.some((i) => i.nome === "Só novembro"));
  assert.equal(r.projecao.meses.length, 12);
  assert.equal(r.projecao.meses[0].mes, "2026-10");
  assert.ok(r.projecao.meses[1].entrou_neste_mes.some((x) => x.item === "Só novembro"));
});
t("meses pedidos: só YYYY-MM válidos, sem repetir; vazio = atual e próximo", () => {
  assert.deepEqual(mesesPedidos("2026-10, 2026-10,xx,2026-13,2026-12", "2026-10"), ["2026-10", "2026-12"]);
  assert.deepEqual(mesesPedidos("", "2026-12"), ["2026-12", "2027-01"]);
  assert.equal(mesesPedidos(Array.from({ length: 20 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}`).join(","), "2026-01").length, 12);
});

t("transferência entre contas move saldo mas NÃO vira gasto nem receita", () => {
  const contas = [{ id: "c1", tipo: "corrente", saldo_inicial: 1000 }, { id: "c2", tipo: "carteira", saldo_inicial: 50 }, { id: "p1", tipo: "poupanca", saldo_inicial: 5000 }];
  const lancs = [L({ valor: 100 })];
  const sem = calcularResumo({ ...base, contas, lancamentos: lancs });
  const com = calcularResumo({ ...base, contas, lancamentos: lancs, transferencias: [{ origem_conta_id: "c1", destino_conta_id: "c2", valor: 300 }] });
  assert.equal(com.total_gastos, sem.total_gastos);
  assert.equal(com.total_receitas, sem.total_receitas);
  assert.equal(com.saldo, sem.saldo); // c1 -300, c2 +300: o total sem poupança não muda
  const paraPoupanca = calcularResumo({ ...base, contas, lancamentos: lancs, transferencias: [{ origem_conta_id: "c1", destino_conta_id: "p1", valor: 200 }] });
  assert.equal(paraPoupanca.saldo, sem.saldo - 200); // mover pra poupança tira da soma "sem poupança"
});

t("saldosPorConta: transferência soma no destino e tira da origem; conta excluída (null) é ignorada", () => {
  const contas = [{ id: "a", saldo_inicial: 100 }, { id: "b", saldo_inicial: 0 }];
  const s = saldosPorConta([], contas, [{ origem_conta_id: "a", destino_conta_id: "b", valor: 40.5 }, { origem_conta_id: null, destino_conta_id: "b", valor: 10 }]);
  assert.equal(s.a, 59.5);
  assert.equal(s.b, 50.5);
});
console.log(ok + " testes passaram");
