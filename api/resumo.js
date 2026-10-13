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
import { calcularResumo, inicioDoMes } from "./_lib/resumo-calculo.js";
import { montarPlanejamento, mesesPedidos } from "./_lib/planejamento-resumo.js";

// Lê a tabela inteira em páginas de 1000 (o Supabase corta em 1000 linhas por consulta).
async function lerTudo(consulta) {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta().range(de, de + 999);
    if (error) return { data: null, error };
    tudo.push(...data);
    if (data.length < 1000) return { data: tudo, error: null };
  }
}
// Tabela criada por migração posterior: se ainda não existe, segue sem ela.
const opcional = async (consulta) => { const r = await lerTudo(consulta); return r.error ? [] : r.data; };

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

    const inicioMesISO = inicioDoMes();

    // Busca todos os lançamentos (o saldo real precisa de todos), as contas, os membros e as categorias
    // (para devolver o NOME da categoria e não a chave interna). A conta fica em api/_lib/resumo-calculo.js.
    const [{ data: lancamentos, error: errLanc }, { data: membros, error: errMemb }, { data: contas, error: errContas }, { data: categorias, error: errCat }] = await Promise.all([
      lerTudo(() => supabase.from("lancamentos").select("tipo, categoria, valor, membro_id, data, conta_id, cartao_id").order("id")),
      supabase.from("membros").select("id, nome, papel, mesada_mensal"),
      supabase.from("contas").select("id, tipo, saldo_inicial"),
      supabase.from("categorias").select("tipo, chave, label"),
    ]);
    if (errLanc) throw errLanc;
    if (errMemb) throw errMemb;
    if (errContas) throw errContas;
    if (errCat) throw errCat;

    // ?parte=planejamento[&meses=2026-10,2026-11][&projecao=1]: o Planejamento do app, mês a mês (mesmos números da tela).
    if (req.query && req.query.parte === "planejamento") {
      const [itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao] = await Promise.all([
        opcional(() => supabase.from("planejamento_itens").select("*").order("created_at")),
        opcional(() => supabase.from("planejamento_pagamentos").select("*").order("item_id")),
        opcional(() => supabase.from("planejamento_valores_mes").select("*").order("item_id")),
        opcional(() => supabase.from("planejamento_vencimentos_mes").select("*").order("item_id")),
        opcional(() => supabase.from("cartoes_credito").select("*").order("nome")),
        opcional(() => supabase.from("lancamentos").select("id, cartao_id, valor, data, fatura_paga").eq("tipo", "gasto").not("cartao_id", "is", null).order("id")),
      ]);
      const meses = mesesPedidos(req.query.meses, inicioMesISO.slice(0, 7));
      return res.status(200).json({ ...montarPlanejamento({ itens, pagamentos, valoresMes, vencimentosMes, cartoes, lancamentosCartao, categorias, meses, comProjecao: req.query.projecao === "1" }) });
    }

    return res.status(200).json(calcularResumo({ lancamentos, membros, contas, categorias, inicioMesISO }));
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detail: String(e) });
  }
}
