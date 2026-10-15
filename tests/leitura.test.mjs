// Testa a leitura completa do Cash para o COSMO. Rodar: node tests/leitura.test.mjs
import assert from "node:assert/strict";
import { normalizarFiltros, montarLancamentos, montarCategorias, montarCartoes, montarContas, montarAssinaturas, montarInvestimentos, montarRecorrentes } from "../api/_lib/cash-leitura.js";

let ok = 0; const t = (n, f) => { try { f(); ok++; console.log("ok  ", n); } catch (e) { console.error("FALHOU", n, e); process.exitCode = 1; } };

const membros = [{ id: "m1", nome: "Matheus" }, { id: "m2", nome: "Alessia" }];
const contas = [{ id: "c1", nome: "Nubank", tipo: "corrente", saldo_inicial: 1000, titular: "Matheus" }, { id: "p1", nome: "Reserva", tipo: "poupanca", saldo_inicial: 500 }];
const cartoes = [{ id: "k1", nome: "Cartão Nu", bandeira: "Nubank", limite: 5000, dia_fechamento: 10, dia_vencimento: 17, fatura_inicial: 200, limite_comprometido_extra: 100, conta_pagamento_id: "c1" }];
const categorias = [
  { tipo: "gasto", chave: "mercado", label: "Mercado" }, { tipo: "gasto", chave: "casa_familia", label: "Casa/família" },
  { tipo: "receita", chave: "salario", label: "Salário" },
];
const L = (o) => ({ id: Math.random().toString(36).slice(2), tipo: "gasto", categoria: "mercado", valor: 10, descricao: "x", data: "2026-10-05", membro_id: "m1", conta_id: "c1", cartao_id: null, created_at: "2026-10-05T10:00:00Z", ...o });
const lancs = [
  L({ valor: 100, descricao: "Supermercado Extra", data: "2026-10-03" }),
  L({ valor: 300, descricao: "Compra no cartão", cartao_id: "k1", conta_id: null, data: "2026-10-04" }),
  L({ valor: 50, categoria: "casa_familia", descricao: "Padaria", membro_id: "m2", data: "2026-10-06" }),
  L({ tipo: "receita", categoria: "salario", valor: 5000, descricao: "Salário", data: "2026-10-01" }),
  L({ valor: 80, descricao: "Mercado de setembro", data: "2026-09-20" }),
];

t("filtros: mês vira de/ate, limite com teto, tipo inválido é ignorado", () => {
  const f = normalizarFiltros({ mes: "2026-10", tipo: "x", limite: "999", categoria: "  mercado " });
  assert.equal(f.de, "2026-10-01"); assert.equal(f.ate, "2026-10-31"); assert.equal(f.limite, 200); assert.equal(f.tipo, undefined); assert.equal(f.categoria, "mercado");
  assert.equal(normalizarFiltros({}).limite, 40);
  assert.equal(normalizarFiltros({ de: "ontem" }).de, undefined);
});

t("lançamentos: soma de gasto (saída de conta) separada da compra no cartão e das receitas", () => {
  const r = montarLancamentos({ lancamentos: lancs, membros, contas, cartoes, categorias, filtros: normalizarFiltros({ mes: "2026-10" }) });
  assert.equal(r.total_encontrado, 4);
  assert.equal(r.soma_gastos_que_sairam_de_conta, 150);
  assert.equal(r.soma_compras_no_cartao, 300);
  assert.equal(r.soma_receitas, 5000);
  assert.equal(r.lancamentos[0].data, "2026-10-06"); // mais recente primeiro
  const c = r.lancamentos.find((l) => l.cartao);
  assert.equal(c.cartao, "Cartão Nu"); assert.equal(c.fatura_paga, false);
});

t("lançamentos: filtra por categoria pelo nome (sem acento), por quem e por texto", () => {
  const f = (o) => montarLancamentos({ lancamentos: lancs, membros, contas, cartoes, categorias, filtros: normalizarFiltros(o) });
  assert.equal(f({ categoria: "casa" }).total_encontrado, 1);
  assert.equal(f({ categoria: "MERCADO" }).total_encontrado, 3);
  assert.equal(f({ membro: "alessia" }).lancamentos[0].descricao, "Padaria");
  assert.equal(f({ texto: "supermercado" }).total_encontrado, 1);
  assert.equal(f({ cartao: "nu" }).total_encontrado, 1);
});

t("lançamentos: o limite corta a lista mas a soma cobre tudo que casou", () => {
  const r = montarLancamentos({ lancamentos: lancs, membros, contas, cartoes, categorias, filtros: normalizarFiltros({ limite: "1" }) });
  assert.equal(r.mostrando, 1); assert.equal(r.total_encontrado, 5);
  assert.equal(r.soma_receitas, 5000);
});

t("categorias: todas aparecem (mesmo zeradas), compra no cartão separada, sem categoria vira texto claro", () => {
  const r = montarCategorias({ lancamentos: [...lancs, L({ categoria: "__sem_categoria__", valor: 7 })], categorias, inicioMesISO: "2026-10-01" });
  const m = r.categorias_de_gasto.find((c) => c.nome === "Mercado");
  assert.equal(m.gasto_no_periodo, 100); // o de setembro fica fora
  assert.equal(m.compras_no_cartao_no_periodo, 300);
  assert.equal(r.categorias_de_gasto.find((c) => c.nome === "Ainda sem categoria").gasto_no_periodo, 7);
  assert.equal(r.categorias_de_receita[0].receita_no_periodo, 5000);
  const vazio = montarCategorias({ lancamentos: [], categorias, inicioMesISO: "2026-10-01" });
  assert.equal(vazio.categorias_de_gasto.length, 2); // categorias sem lançamento continuam na lista
});

t("categorias: com mês escolhido, o fim do período corta o mês seguinte", () => {
  const r = montarCategorias({ lancamentos: [...lancs, L({ valor: 999, data: "2026-11-02" })], categorias, inicioMesISO: "2026-10-01", fimExclusivoISO: "2026-11-01" });
  assert.equal(r.categorias_de_gasto.find((c) => c.nome === "Mercado").gasto_no_periodo, 100);
});

t("contas: saldo por conta como o app (inicial + receitas − gastos); poupança fora do total", () => {
  const r = montarContas({ contas, lancamentos: lancs });
  const nu = r.contas.find((c) => c.nome === "Nubank");
  assert.equal(nu.saldo, 1000 + 5000 - 100 - 50 - 80); // compra no cartão não tem conta
  assert.equal(r.saldo_total_sem_poupanca, nu.saldo);
  assert.equal(r.saldo_em_poupanca, 500);
});

const hoje = new Date("2026-10-15T12:00:00");
const compras = [
  { id: "a", cartao_id: "k1", valor: 300, data: "2026-10-04", fatura_paga: false, tipo: "gasto", descricao: "TV 1/3", parcela_atual: 1, parcela_total: 3, compra_parcelada_id: "p" },
  { id: "b", cartao_id: "k1", valor: 300, data: "2026-11-04", fatura_paga: false, tipo: "gasto", descricao: "TV 2/3", parcela_atual: 2, parcela_total: 3, compra_parcelada_id: "p" },
  { id: "c", cartao_id: "k1", valor: 300, data: "2026-12-04", fatura_paga: false, tipo: "gasto", descricao: "TV 3/3", parcela_atual: 3, parcela_total: 3, compra_parcelada_id: "p" },
  { id: "d", cartao_id: "k1", valor: 90, data: "2026-09-02", fatura_paga: true, tipo: "gasto", descricao: "paga" },
];
t("cartões: fatura atual, limite usado/disponível e parcelamento como na tela do cartão", () => {
  const r = montarCartoes({ cartoes, contas, lancamentosCartao: compras, hoje });
  const k = r.cartoes[0];
  assert.equal(k.conta_de_pagamento, "Nubank");
  // ciclo atual: compra de 04/10 fecha dia 10 → fatura de outubro = 300 + fatura_inicial 200
  assert.equal(k.mes_da_fatura_atual, "2026-10"); assert.equal(k.fatura_atual, 500);
  assert.equal(k.limite_usado, 900 + 200 + 100); assert.equal(k.limite_disponivel, 5000 - 1200);
  assert.equal(k.parcelamentos_em_andamento.length, 1);
  assert.deepEqual([k.parcelamentos_em_andamento[0].parcelas_em_aberto, k.parcelamentos_em_andamento[0].valor_restante], [3, 900]);
});

t("cartões: faturas previstas mês a mês (vence dia 17 > fecha dia 10: a do ciclo que fecha no próprio mês)", () => {
  const k = montarCartoes({ cartoes, contas, lancamentosCartao: compras, hoje, quantidadeFaturas: 3 }).cartoes[0];
  assert.deepEqual(k.faturas_previstas.map((f) => [f.vence_em, f.valor]), [["2026-10", 500], ["2026-11", 300], ["2026-12", 300]]);
  assert.equal(k.faturas_previstas[0].dia_vencimento, 17);
});

t("assinaturas e investimentos: totais vêm prontos", () => {
  const a = montarAssinaturas({ assinaturas: [{ nome: "Netflix", valor: 40, dia_cobranca: 5, tipo_cobranca: "cartao", cartao_id: "k1", ativo: true, categoria: "mercado" }, { nome: "Velha", valor: 10, dia_cobranca: 1, tipo_cobranca: "debito", conta_id: "c1", ativo: false }], cartoes, contas, categorias });
  assert.equal(a.total_mensal_das_ativas, 40); assert.equal(a.assinaturas[0].cobrada_em, "cartão Cartão Nu"); assert.equal(a.assinaturas[1].cobrada_em, "débito Nubank");
  const i = montarInvestimentos({ investimentos: [{ nome: "CDB", tipo: "renda_fixa", valor_aportado: 1000, valor_atual: 1100 }, { nome: "Ações", tipo: "renda_variavel", valor_aportado: 500, valor_atual: 450 }] });
  assert.equal(i.total_aportado, 1500); assert.equal(i.total_atual, 1550);
});

t("recorrentes: planejamento que se repete, itens de um mês só, assinaturas ativas e cartões", () => {
  const r = montarRecorrentes({ itens: [{ nome: "Aluguel", categoria: "casa_familia", tipo_valor: "fixo", valor_fixo: 1500, dia_vencimento: 5, recorrente: true }, { nome: "Luz", categoria: "casa_familia", tipo_valor: "variavel", recorrente: true, dia_vencimento: 12 }, { nome: "IPVA", categoria: "casa_familia", tipo_valor: "fixo", valor_fixo: 900, recorrente: false, mes_especifico: "2026-11-01" }], assinaturas: [{ nome: "Netflix", valor: 40, dia_cobranca: 5, ativo: true }], cartoes, categorias });
  assert.equal(r.itens_do_planejamento_que_se_repetem.length, 2);
  assert.equal(r.itens_do_planejamento_que_se_repetem[1].valor_variavel, true);
  assert.equal(r.itens_do_planejamento_so_de_um_mes[0].mes, "2026-11");
  assert.equal(r.assinaturas_ativas.length, 1); assert.equal(r.cartoes_com_fatura_todo_mes[0].dia_vencimento, 17);
});

console.log(`${ok} testes passaram`);
