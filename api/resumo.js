// Função serverless da Vercel do Cash App — devolve um resumo financeiro do
// mês atual da família. Quem chama isto NÃO é o navegador: é o endpoint
// api/financas-resumo.js do próprio COSMO, servidor conversando com servidor,
// pra fechar o ciclo do Bloco 2 (o cérebro do COSMO ganha uma ferramenta que
// pergunta pro Cash App em vez de guardar esse dado duplicado em si mesmo).
//
// Protegido por uma chave secreta compartilhada (RESUMO_API_TOKEN) — a MESMA
// chave configurada aqui e na Vercel do COSMO. Sem a chave certa no cabeçalho
// x-resumo-token, a chamada é recusada.
//
// Usa a chave de SERVIÇO do Supabase (SUPABASE_SERVICE_ROLE_KEY), que ignora
// RLS — está tudo bem porque esta função já é o próprio "porteiro" (só chega
// até aqui quem tiver o token certo) e o resumo devolvido é agregado (somas
// por categoria/pessoa), não os lançamentos individuais crus.
//
// Variáveis de ambiente que este arquivo precisa, configuradas na Vercel
// DESTE projeto (Cash App):
//   SUPABASE_URL              = a Project URL do Supabase do Cash App
//   SUPABASE_SERVICE_ROLE_KEY = a service_role key do Supabase do Cash App
//                                (Settings > API — NUNCA a mesma coisa que a
//                                anon key, e nunca colocada como VITE_...,
//                                porque essa não pode nunca chegar ao navegador)
//   RESUMO_API_TOKEN          = uma chave inventada por você (uma senha longa
//                                qualquer), a MESMA colada depois na Vercel do COSMO

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const token = req.headers["x-resumo-token"];
  if (!token || token !== process.env.RESUMO_API_TOKEN) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !process.env.RESUMO_API_TOKEN) {
    return res.status(503).json({ error: "Cash App ainda não configurado (faltam variáveis de ambiente)." });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);

    const inicioMes = new Date();
    inicioMes.setUTCDate(1);
    const inicioMesISO = inicioMes.toISOString().slice(0, 10);

    // Busca TODOS os lançamentos (não só os do mês) e as contas com seu
    // saldo_inicial — precisamos das duas coisas pra calcular o saldo REAL
    // (ver correção abaixo), além do recorte mensal de sempre pra
    // gastos/receitas por categoria e por pessoa.
    const [{ data: lancamentos, error: errLanc }, { data: membros, error: errMemb }, { data: contas, error: errContas }] = await Promise.all([
      supabase.from("lancamentos").select("tipo, categoria, valor, membro_id, data, conta_id"),
      supabase.from("membros").select("id, nome, papel, mesada_mensal"),
      supabase.from("contas").select("id, tipo, saldo_inicial"),
    ]);
    if (errLanc) throw errLanc;
    if (errMemb) throw errMemb;
    if (errContas) throw errContas;

    const nomesPorId = Object.fromEntries((membros || []).map((m) => [m.id, m.nome]));
    const doMes = (lancamentos || []).filter((l) => l.data >= inicioMesISO);

    let totalGastos = 0;
    let totalReceitas = 0;
    const porCategoria = {};
    const porMembro = {};

    for (const l of doMes) {
      const valor = Number(l.valor) || 0;
      if (l.tipo === "gasto") {
        totalGastos += valor;
        porCategoria[l.categoria] = (porCategoria[l.categoria] || 0) + valor;
        const nome = nomesPorId[l.membro_id] || "desconhecido";
        porMembro[nome] = (porMembro[nome] || 0) + valor;
      } else {
        totalReceitas += valor;
      }
    }

    // BUG CORRIGIDO (16/09/2026): "saldo" aqui era receitas-do-mês menos
    // gastos-do-mês — o fluxo de caixa do mês, não o dinheiro que existe de
    // verdade nas contas. É o mesmo bug do "Saldo total do casal" zerado no
    // Painel do app (ver Painel.jsx) — uma atualização de saldo feita pelo
    // chat do COSMO mexe direto em `contas.saldo_inicial` e nunca cria um
    // lançamento, então nunca entrava nessa conta. Esta função usa a chave de
    // SERVIÇO (sem usuário logado), então não dá pra chamar a RPC
    // `saldos_contas()` do banco (ela depende de `auth.uid()`) — replicamos a
    // mesma lógica dela aqui: saldo_inicial de cada conta + todos os
    // lançamentos (de qualquer mês) daquela conta, somando receita e
    // subtraindo gasto — com o mesmo recorte da tela de Contas e cartões:
    // sem poupança (tratada à parte, não é "dinheiro disponível").
    const saldoPorConta = Object.fromEntries((contas || []).map((c) => [c.id, Number(c.saldo_inicial) || 0]));
    for (const l of lancamentos || []) {
      if (!l.conta_id || !(l.conta_id in saldoPorConta)) continue;
      const valor = Number(l.valor) || 0;
      if (l.tipo === "receita") saldoPorConta[l.conta_id] += valor;
      else if (l.tipo === "gasto") saldoPorConta[l.conta_id] -= valor;
    }
    const saldoReal = (contas || [])
      .filter((c) => c.tipo !== "poupanca")
      .reduce((s, c) => s + (saldoPorConta[c.id] ?? 0), 0);

    return res.status(200).json({
      mes_referencia: inicioMesISO.slice(0, 7),
      total_gastos: Number(totalGastos.toFixed(2)),
      total_receitas: Number(totalReceitas.toFixed(2)),
      saldo: Number(saldoReal.toFixed(2)),
      gastos_por_categoria: porCategoria,
      gastos_por_membro: porMembro,
      membros: (membros || []).map((m) => ({ nome: m.nome, papel: m.papel, mesada_mensal: m.mesada_mensal })),
    });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detail: String(e) });
  }
}
