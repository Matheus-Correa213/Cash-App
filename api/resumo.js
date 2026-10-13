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
      supabase.from("lancamentos").select("tipo, categoria, valor, membro_id, data, conta_id, cartao_id"),
      supabase.from("membros").select("id, nome, papel, mesada_mensal"),
      supabase.from("contas").select("id, tipo, saldo_inicial"),
      supabase.from("categorias").select("tipo, chave, label"),
    ]);
    if (errLanc) throw errLanc;
    if (errMemb) throw errMemb;
    if (errContas) throw errContas;
    if (errCat) throw errCat;

    return res.status(200).json(calcularResumo({ lancamentos, membros, contas, categorias, inicioMesISO }));
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detail: String(e) });
  }
}
