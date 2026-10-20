// Leitura completa do Cash para o COSMO (somente leitura). Cada função recebe as linhas já lidas do banco e devolve
// um relatório pronto. TODA conta é feita aqui, com as mesmas regras do app (Painel, Gastos, Cartões); o COSMO
// só cita os números e nunca soma nem subtrai.
//
// Regra do dinheiro (igual ao Painel): gasto = lançamento SEM cartao_id. Compra no cartão só vira gasto quando a
// fatura é paga (esse pagamento já é um lançamento sem cartao_id). Por isso as somas vêm separadas.
import { faturasDeCartaoDoMes } from "../../src/planejamentoCalculo.js";
import { mesDaFatura } from "../../src/theme.js";
import { saldosPorConta } from "./resumo-calculo.js";

const SEM_CATEGORIA = "__sem_categoria__";
const arred = (n) => Math.round(Number(n || 0) * 100) / 100;
export const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;
const MES_OK = /^\d{4}-(0[1-9]|1[0-2])$/;
const somarMes = (ym, n) => { const [a, m] = ym.split("-").map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
const ultimoDia = (ym) => { const [a, m] = ym.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };

/** Hoje em Brasília, ao meio-dia (as funções de fatura do app esperam um Date local). */
export const hojeBrasilia = () => new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T12:00:00`);
export const mesDe = (d) => d.toLocaleDateString("sv-SE").slice(0, 7);

/** Filtros vindos da URL → só valores válidos. `mes` (AAAA-MM) vira de/ate do mês inteiro. */
export function normalizarFiltros(q = {}) {
  const f = {};
  if (MES_OK.test(q.mes || "")) { f.de = `${q.mes}-01`; f.ate = `${q.mes}-${String(ultimoDia(q.mes)).padStart(2, "0")}`; f.mes = q.mes; }
  if (DATA_OK.test(q.de || "")) f.de = q.de;
  if (DATA_OK.test(q.ate || "")) f.ate = q.ate;
  if (q.tipo === "gasto" || q.tipo === "receita") f.tipo = q.tipo;
  for (const k of ["categoria", "membro", "conta", "cartao", "texto"]) if (q[k] && String(q[k]).trim()) f[k] = String(q[k]).trim().slice(0, 80);
  const lim = parseInt(q.limite, 10);
  f.limite = Number.isFinite(lim) ? Math.min(200, Math.max(1, lim)) : 40;
  return f;
}

const porId = (lista) => Object.fromEntries((lista || []).map((x) => [x.id, x]));
const rotuloDa = (categorias, tipo, chave) => {
  if (chave === SEM_CATEGORIA) return "Ainda sem categoria";
  const c = (categorias || []).find((x) => x.tipo === tipo && x.chave === chave) || (categorias || []).find((x) => x.chave === chave);
  return c ? c.label : chave;
};

/** Lançamentos com filtro. As somas cobrem TODOS os que casam com o filtro, não só os mostrados. */
export function montarLancamentos({ lancamentos = [], membros = [], contas = [], cartoes = [], categorias = [], filtros = {} }) {
  const f = filtros, mb = porId(membros), ct = porId(contas), cr = porId(cartoes);
  const cat = f.categoria ? semAcento(f.categoria) : null;
  const casa = (l) => {
    if (f.de && l.data < f.de) return false;
    if (f.ate && l.data > f.ate) return false;
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (cat) { const lab = semAcento(rotuloDa(categorias, l.tipo, l.categoria)); if (semAcento(l.categoria) !== cat && !lab.includes(cat)) return false; }
    if (f.membro && !semAcento(mb[l.membro_id]?.nome).includes(semAcento(f.membro))) return false;
    if (f.conta && !semAcento(ct[l.conta_id]?.nome).includes(semAcento(f.conta))) return false;
    if (f.cartao && !semAcento(cr[l.cartao_id]?.nome).includes(semAcento(f.cartao))) return false;
    if (f.texto && !semAcento(l.descricao).includes(semAcento(f.texto))) return false;
    return true;
  };
  const achados = lancamentos.filter(casa).sort((a, b) => (b.data || "").localeCompare(a.data || "") || String(b.created_at || "").localeCompare(String(a.created_at || "")));
  let saida = 0, receitas = 0, cartao = 0;
  for (const l of achados) {
    const v = Number(l.valor) || 0;
    if (l.tipo === "receita") receitas += v; else if (l.cartao_id) { if (v > 0) cartao += v; /* negativo = pagamento antecipado/estorno */ } else saida += v;
  }
  const mostrar = achados.slice(0, f.limite || 40);
  return {
    filtros: Object.fromEntries(Object.entries(f).filter(([k, v]) => v != null && k !== "mes" && k !== "limite")),
    total_encontrado: achados.length,
    mostrando: mostrar.length,
    soma_gastos_que_sairam_de_conta: arred(saida),
    soma_compras_no_cartao: arred(cartao),
    soma_receitas: arred(receitas),
    lancamentos: mostrar.map((l) => ({
      id: l.id, data: l.data, tipo: l.tipo, valor: arred(l.valor),
      categoria: rotuloDa(categorias, l.tipo, l.categoria), descricao: l.descricao || null,
      quem: mb[l.membro_id]?.nome || null, conta: ct[l.conta_id]?.nome || null, cartao: cr[l.cartao_id]?.nome || null,
      ...(l.parcela_total > 1 ? { parcela: `${l.parcela_atual}/${l.parcela_total}` } : {}),
      ...(l.cartao_id ? { fatura_paga: !!l.fatura_paga } : {}),
      ...(l.assinatura_id ? { de_assinatura: true } : {}),
    })),
  };
}

/** Todas as categorias, com o total do período (regra do Painel: data >= início; com `fim`, até antes dele). */
export function montarCategorias({ lancamentos = [], categorias = [], inicioMesISO, fimExclusivoISO = null }) {
  const doPeriodo = lancamentos.filter((l) => l.data >= inicioMesISO && (!fimExclusivoISO || l.data < fimExclusivoISO));
  const acum = { gasto: {}, receita: {} };
  for (const l of doPeriodo) {
    const v = Number(l.valor) || 0;
    const a = (acum[l.tipo] ||= {});
    const x = (a[l.categoria] ||= { total: 0, cartao: 0 });
    if (l.tipo === "gasto" && l.cartao_id) { if (v > 0) x.cartao += v; } else x.total += v;
  }
  const monta = (tipo) => {
    const conhecidas = categorias.filter((c) => c.tipo === tipo);
    const chaves = new Set(conhecidas.map((c) => c.chave));
    const extras = Object.keys(acum[tipo] || {}).filter((k) => !chaves.has(k)).map((k) => ({ chave: k, label: rotuloDa(categorias, tipo, k) }));
    return [...conhecidas, ...extras].map((c) => {
      const x = (acum[tipo] || {})[c.chave] || { total: 0, cartao: 0 };
      return tipo === "gasto"
        ? { nome: c.label, chave: c.chave, gasto_no_periodo: arred(x.total), compras_no_cartao_no_periodo: arred(x.cartao) }
        : { nome: c.label, chave: c.chave, receita_no_periodo: arred(x.total) };
    });
  };
  return { periodo: { de: inicioMesISO, ate_antes_de: fimExclusivoISO }, categorias_de_gasto: monta("gasto"), categorias_de_receita: monta("receita") };
}

/** Cartões: limite, fechamento/vencimento, fatura atual, disponível, parcelamentos em andamento e faturas dos próximos meses. */
export function montarCartoes({ cartoes = [], contas = [], lancamentosCartao = [], quantidadeFaturas = 6, hoje = hojeBrasilia() }) {
  const hojeMes = mesDe(hoje), ct = porId(contas);
  const meses = Array.from({ length: Math.min(12, Math.max(1, quantidadeFaturas)) }, (_, i) => somarMes(hojeMes, i));
  const porMesVenc = meses.map((mes) => ({ mes, itens: faturasDeCartaoDoMes({ cartoes, lancamentosCartao, mes, hoje }) }));
  return {
    cartoes: cartoes.map((k) => {
      const todas = lancamentosCartao.filter((l) => l.cartao_id === k.id);
      const abertas = todas.filter((l) => !l.fatura_paga);
      const bucket = (l) => mesDaFatura(l.data, k.dia_fechamento);
      const cicloAtual = abertas.map(bucket).filter((m) => m >= hojeMes).sort()[0] || hojeMes;
      const inicial = Number(k.fatura_inicial || 0);
      const faturaAtual = abertas.filter((l) => bucket(l) === cicloAtual).reduce((s, l) => s + Number(l.valor), 0) + inicial;
      const usado = abertas.reduce((s, l) => s + Number(l.valor), 0) + inicial + Number(k.limite_comprometido_extra || 0);
      const grupos = new Map();
      for (const l of abertas) {
        if (!(l.parcela_total > 1) || !l.compra_parcelada_id) continue;
        (grupos.get(l.compra_parcelada_id) || grupos.set(l.compra_parcelada_id, []).get(l.compra_parcelada_id)).push(l);
      }
      return {
        nome: k.nome, bandeira: k.bandeira || null, titular: k.titular || null,
        limite: k.limite != null ? arred(k.limite) : null,
        dia_fechamento: k.dia_fechamento ?? null, dia_vencimento: k.dia_vencimento ?? null,
        conta_de_pagamento: ct[k.conta_pagamento_id]?.nome || null,
        fatura_atual: arred(faturaAtual), mes_da_fatura_atual: cicloAtual,
        limite_usado: arred(usado), limite_disponivel: k.limite != null ? arred(Math.max(0, k.limite - usado)) : null,
        parcelamentos_em_andamento: [...grupos.values()].map((ls) => {
          const o = [...ls].sort((a, b) => a.data.localeCompare(b.data));
          return { descricao: o[0].descricao || null, parcelas_em_aberto: o.length, parcela_total: o[0].parcela_total, valor_da_parcela: arred(o[0].valor), valor_restante: arred(o.reduce((s, l) => s + Number(l.valor), 0)), ultima_parcela_na_fatura_de: bucket(o[o.length - 1]) };
        }),
        faturas_previstas: porMesVenc.flatMap(({ mes, itens }) => itens.filter((i) => i.cartaoId === k.id).map((i) => ({ vence_em: mes, dia_vencimento: i.dia_vencimento, valor: arred(i.valor_fixo), paga: !!i.pago, fecha_em: i.fechaEm, ainda_recebendo_compras: !!i.aberta }))),
      };
    }),
    nota: "faturas_previstas só conhece compras e parcelas já lançadas; compras futuras ainda não existem, então os meses de frente tendem a subir.",
  };
}

export function montarContas({ contas = [], lancamentos = [], transferencias = [] }) {
  const saldo = saldosPorConta(lancamentos, contas, transferencias);
  const lista = contas.map((c) => ({ nome: c.nome, tipo: c.tipo, instituicao: c.instituicao || null, titular: c.titular || null, saldo: arred(saldo[c.id]), entra_no_saldo_total: c.tipo !== "poupanca" }));
  return { contas: lista, saldo_total_sem_poupanca: arred(lista.filter((c) => c.entra_no_saldo_total).reduce((s, c) => s + c.saldo, 0)), saldo_em_poupanca: arred(lista.filter((c) => !c.entra_no_saldo_total).reduce((s, c) => s + c.saldo, 0)) };
}

export function montarAssinaturas({ assinaturas = [], cartoes = [], contas = [], categorias = [] }) {
  const cr = porId(cartoes), ct = porId(contas);
  const lista = assinaturas.map((a) => ({ nome: a.nome, categoria: rotuloDa(categorias, "gasto", a.categoria), valor: arred(a.valor), dia_da_cobranca: a.dia_cobranca, cobrada_em: a.tipo_cobranca === "cartao" ? `cartão ${cr[a.cartao_id]?.nome || ""}`.trim() : `débito ${ct[a.conta_id]?.nome || ""}`.trim(), ativa: !!a.ativo }));
  return { assinaturas: lista, total_mensal_das_ativas: arred(lista.filter((a) => a.ativa).reduce((s, a) => s + a.valor, 0)) };
}

export function montarInvestimentos({ investimentos = [] }) {
  const lista = investimentos.map((i) => ({ nome: i.nome, tipo: i.tipo === "renda_fixa" ? "renda fixa" : "renda variável", subtipo: i.subtipo || null, instituicao: i.instituicao || null, objetivo: i.objetivo || null, valor_aportado: arred(i.valor_aportado), valor_atual: arred(i.valor_atual), aportado_em: i.data_aporte || null }));
  return { investimentos: lista, total_aportado: arred(lista.reduce((s, i) => s + i.valor_aportado, 0)), total_atual: arred(lista.reduce((s, i) => s + i.valor_atual, 0)) };
}

/** O que se repete: itens do Planejamento marcados como recorrentes, assinaturas ativas e os cartões (fatura todo mês). */
export function montarRecorrentes({ itens = [], assinaturas = [], cartoes = [], categorias = [] }) {
  const planej = itens.filter((i) => i.recorrente).map((i) => ({ nome: i.nome, categoria: rotuloDa(categorias, "gasto", i.categoria), valor: i.tipo_valor === "fixo" ? (i.valor_fixo != null ? arred(i.valor_fixo) : null) : null, valor_variavel: i.tipo_valor === "variavel", dia_vencimento: i.dia_vencimento ?? null }));
  const unicos = itens.filter((i) => !i.recorrente).map((i) => ({ nome: i.nome, mes: i.mes_especifico ? String(i.mes_especifico).slice(0, 7) : null, valor: i.valor_fixo != null ? arred(i.valor_fixo) : null, dia_vencimento: i.dia_vencimento ?? null }));
  const assin = assinaturas.filter((a) => a.ativo).map((a) => ({ nome: a.nome, valor: arred(a.valor), dia_da_cobranca: a.dia_cobranca }));
  return { itens_do_planejamento_que_se_repetem: planej, itens_do_planejamento_so_de_um_mes: unicos, assinaturas_ativas: assin, cartoes_com_fatura_todo_mes: cartoes.map((k) => ({ nome: k.nome, dia_vencimento: k.dia_vencimento ?? null })) };
}
