// Conciliação de uma fatura de cartão (OFX) com o que o app já tem — funções
// puras, sem tela e sem banco, pra poder testar a lógica isolada.
//
// Pedido do Matheus (02/10/2026): "o sistema ler OFX, pra ver como está a
// fatura do cartão e, com isso, poder analisar as parcelas e ter as
// informações precisas do cartão". O OFX é a verdade do banco. O app já tem
// lançamentos feitos à mão (e parcelas projetadas), então importar às cegas
// DUPLICARIA tudo. Por isso cada compra do arquivo é classificada:
//   • ja_importado — já veio de um OFX antes (mesmo FITID, o código único que
//                    o banco dá a cada transação): nada a fazer;
//   • ja_lancado   — é a mesma compra que alguém lançou à mão (mesmo valor e
//                    data próxima, ou mesma parcela n/N): só "carimba" o FITID;
//   • ajustar      — mesma parcela, mas o valor do banco é outro (juros, IOF):
//                    corrige o valor pro do banco;
//   • novo         — não existe no app: vira lançamento (com as parcelas
//                    futuras, se for parcelada).

import { mesDaFatura } from "./theme.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

function addMeses(dataISO, meses) {
  const [a, m, d] = dataISO.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo)); // 31/jan + 1 mês = 28/fev (nunca "pula" pra março)
  return alvo.toISOString().slice(0, 10);
}

const diasEntre = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

// "Notebook - Parcela 3/10", "LOJA PARC 03/10", "Mercado (2/6)", "Posto 04/12"
// → { atual, total, base } ; sem parcela → null.
export function analisarParcela(texto) {
  const t = String(texto || "").trim();
  const padroes = [
    /[\s\-–—]*\b(?:parcela|parc\.?|prc)\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i,
    /[\s\-–—]*\((\d{1,2})\s*\/\s*(\d{1,2})\)/,           // o formato do próprio app: "Compra (2/6)"
    /[\s\-–—]+(\d{1,2})\/(\d{1,2})\s*$/,                   // "Posto 04/12" no fim
  ];
  for (const re of padroes) {
    const m = re.exec(t);
    if (!m) continue;
    const atual = Number(m[1]), total = Number(m[2]);
    if (total < 2 || total > 48 || atual < 1 || atual > total) continue;
    const base = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).replace(/[\s\-–—]+$/, "").trim();
    return { atual, total, base };
  }
  return null;
}

// Mesma "loja"? O banco escreve "MAGAZINELUIZA*NOTEBOOK", a pessoa digitou
// "Notebook" — então vale um contém o outro (mínimo 4 letras, pra "pg" não casar com tudo).
function similar(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
  return curto.length >= 4 && longo.includes(curto);
}

// Cada banco usa uma convenção de sinal (uns mandam compra negativa, outros
// positiva), então não dá pra assumir. Ordem da decisão:
//   1) pagamento da fatura anterior é identificado pelo TEXTO ("Pagamento
//      recebido"…), seja qual for o sinal — e fica de fora (o app controla
//      isso em "Pagar fatura"). Não dá pra decidir pelo valor: um pagamento
//      de R$ 1.000 pesa mais que as compras do mês e inverteria a leitura;
//   2) com o resto, compra é o lado com MAIS lançamentos (estorno é exceção);
//      empate → o sinal do saldo do banco (devendo = negativo);
//   3) o outro lado é crédito/estorno e abate a fatura.
export function classificarTransacoes(transacoes, saldo) {
  const ehPagamento = (t) => /pagamento|pgto|pag\.?\s*fatura|payment/i.test(t.memo) && !/estorno/i.test(t.memo);
  const pagamentos = transacoes.filter((t) => t.valor !== 0 && ehPagamento(t)).map((t) => ({ ...t, valorAbs: Math.abs(t.valor) }));
  const resto = transacoes.filter((t) => t.valor !== 0 && !ehPagamento(t));
  const nNeg = resto.filter((t) => t.valor < 0).length, nPos = resto.length - nNeg;
  const comprasSaoNegativas = nNeg !== nPos ? nNeg > nPos : (saldo?.valor ?? -1) <= 0;
  const compras = [], creditos = [];
  for (const t of resto) {
    const item = { ...t, valorAbs: Math.abs(t.valor) };
    if (comprasSaoNegativas ? t.valor < 0 : t.valor > 0) compras.push(item); else creditos.push(item);
  }
  return { compras, pagamentos, creditos };
}

const iguais = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01;

export function conciliarFatura({ ofx, existentes, novoGrupoId, diaFechamento }) {
  const { compras, pagamentos, creditos } = classificarTransacoes(ofx.transacoes, ofx.saldo);
  const livres = new Set(existentes.map((e) => e.id));
  const reservar = (e) => { livres.delete(e.id); return e; };
  const doPeriodo = (d) => (!ofx.inicio || d >= ofx.inicio) && (!ofx.fim || d <= ofx.fim);

  // Nem a data original nem a deslocada caem no período (banco que data a
  // parcela de outro jeito): mantém o dia do mês, mas dentro da fatura.
  const dentroDoPeriodo = (d) => {
    if (!ofx.fim) return d;
    const dia = Number(d.slice(8, 10));
    const [a, m] = ofx.fim.split("-").map(Number);
    for (const delta of [0, -1]) {
      const base = addMeses(`${a}-${String(m).padStart(2, "0")}-01`, delta);
      const ultimo = new Date(Date.UTC(+base.slice(0, 4), +base.slice(5, 7), 0)).getUTCDate();
      const candidato = `${base.slice(0, 8)}${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
      if (doPeriodo(candidato)) return candidato;
    }
    return ofx.fim;
  };

  // Qual fatura é essa: o mês de fatura do FIM do período do arquivo.
  const referencia = ofx.fim || [...ofx.transacoes].map((t) => t.data).sort().pop();
  const mesFatura = referencia ? mesDaFatura(referencia, diaFechamento) : null;
  const pad2 = (n) => String(n).padStart(2, "0");
  const diaClamp = (ym, dia) => { const [a, m] = ym.split("-").map(Number); return `${ym}-${pad2(Math.min(dia, new Date(Date.UTC(a, m, 0)).getUTCDate()))}`; };
  // O ciclo dessa fatura: do dia seguinte ao fechamento anterior até o fechamento.
  // O banco data as parcelas no PRIMEIRO dia do período (o próprio dia do
  // fechamento anterior) — e esse dia, pela regra do app, cai no ciclo
  // anterior. Sem encostar a data no ciclo certo, as parcelas iriam pra fatura
  // do mês errado (e as futuras, todas deslocadas).
  const cicloDaFatura = () => {
    if (!mesFatura || !diaFechamento) return null;
    const [a, m] = mesFatura.split("-").map(Number);
    const anterior = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
    const inicio = new Date(Date.parse(`${diaClamp(anterior, diaFechamento)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    return { inicio, fim: diaClamp(mesFatura, diaFechamento) };
  };
  const noCiclo = (d) => {
    const c = cicloDaFatura();
    if (!c || mesDaFatura(d, diaFechamento) === mesFatura) return d;
    return d < c.inicio ? c.inicio : d > c.fim ? c.fim : d;
  };

  // Passo 1: FITID — a ligação exata, de um OFX anterior.
  const porFitid = new Map(existentes.filter((e) => e.ofx_fitid).map((e) => [e.ofx_fitid, e]));
  const itens = compras.map((c) => {
    const parcela = analisarParcela(c.memo);
    const item = { ...c, descricao: c.memo || "Compra no cartão", parcela, status: "novo", casouCom: null, dataFinal: c.data, futuras: [], grupoId: null };
    const ja = porFitid.get(c.fitid);
    if (ja && livres.has(ja.id)) { reservar(ja); item.status = "ja_importado"; item.casouCom = ja; }
    return item;
  });

  // Passo 2: casa com lançamento feito à mão / parcela projetada.
  for (const item of itens) {
    if (item.status !== "novo") continue;
    const disponiveis = existentes.filter((e) => livres.has(e.id) && !e.ofx_fitid);
    let achado = null;
    if (item.parcela) {
      const mesmaParcela = disponiveis.filter((e) => e.parcela_total === item.parcela.total && e.parcela_atual === item.parcela.atual);
      achado =
        mesmaParcela.find((e) => similar(analisarParcela(e.descricao)?.base ?? e.descricao, item.parcela.base) && iguais(e.valor, item.valorAbs)) ||
        mesmaParcela.find((e) => similar(analisarParcela(e.descricao)?.base ?? e.descricao, item.parcela.base)) ||
        mesmaParcela.find((e) => iguais(e.valor, item.valorAbs) && diasEntre(e.data, item.data) <= 45) ||
        null;
    } else {
      achado = disponiveis
        .filter((e) => !(e.parcela_total > 1) && iguais(e.valor, item.valorAbs) && diasEntre(e.data, item.data) <= 4)
        .sort((a, b) => diasEntre(a.data, item.data) - diasEntre(b.data, item.data))[0] || null;
    }
    if (achado) {
      reservar(achado);
      item.casouCom = achado;
      item.status = iguais(achado.valor, item.valorAbs) ? "ja_lancado" : "ajustar";
    }
  }

  // Passo 3: o que sobrou é novo. Parcela: acha a data certa e projeta as futuras.
  for (const item of itens) {
    if (item.status !== "novo" || !item.parcela) continue;
    const { atual, total, base } = item.parcela;
    // A data de uma parcela no OFX pode ser a da compra original (meses atrás)
    // ou já a do mês da fatura, conforme o banco. A parcela tem que cair
    // DENTRO do período da fatura, senão vai pra fatura errada.
    const deslocada = addMeses(item.data, atual - 1);
    item.dataFinal = noCiclo(doPeriodo(item.data) ? item.data : doPeriodo(deslocada) ? deslocada : dentroDoPeriodo(item.data));
    // Mesma compra já conhecida (outra parcela dela já lançada)? Reaproveita o grupo.
    const irma = existentes.find((e) => e.compra_parcelada_id && e.parcela_total === total && similar(analisarParcela(e.descricao)?.base ?? e.descricao, base));
    item.grupoId = irma?.compra_parcelada_id || novoGrupoId();
    for (let k = atual + 1; k <= total; k++) {
      const jaExiste = existentes.some((e) => e.parcela_total === total && e.parcela_atual === k && similar(analisarParcela(e.descricao)?.base ?? e.descricao, base));
      if (jaExiste) continue;
      item.futuras.push({ atual: k, total, data: addMeses(item.dataFinal, k - atual), valor: item.valorAbs, descricao: `${base || "Compra parcelada"} (${k}/${total})` });
    }
  }

  // Estorno/crédito que o app ainda não tem (sem FITID conhecido): entra como
  // lançamento NEGATIVO no cartão, pra a fatura do app bater com a do banco.
  const fitidsConhecidos = new Set(existentes.map((e) => e.ofx_fitid).filter(Boolean));
  const creditosNovos = creditos.filter((c) => !fitidsConhecidos.has(c.fitid));

  const soma = (lista) => lista.reduce((s, c) => s + c.valorAbs, 0);
  const por = (status) => itens.filter((i) => i.status === status);
  return {
    itens, pagamentos, creditos, creditosNovos, mesFatura,
    totais: {
      compras: soma(itens), creditos: soma(creditos), pagamentos: soma(pagamentos),
      // o que o banco cobra nessa fatura: compras menos estornos/créditos
      fatura: soma(itens) - soma(creditos),
      novos: soma(por("novo")),
      nNovos: por("novo").length, nJaImportados: por("ja_importado").length, nJaLancados: por("ja_lancado").length, nAjustar: por("ajustar").length,
      futuras: itens.reduce((s, i) => s + i.futuras.reduce((x, f) => x + f.valor, 0), 0),
      nFuturas: itens.reduce((s, i) => s + i.futuras.length, 0),
    },
  };
}
