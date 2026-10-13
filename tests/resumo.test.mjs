// Testa a conta do resumo que o COSMO lê. Rodar: node tests/resumo.test.mjs
import assert from "node:assert/strict";
import { calcularResumo, inicioDoMes } from "../api/_lib/resumo-calculo.js";

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
console.log(ok + " testes passaram");
