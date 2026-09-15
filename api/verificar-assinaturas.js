// Função serverless da Vercel — chamada uma vez por dia por um cron externo
// (cron-job.org, mesmo serviço já usado pelo COSMO e o JACKBOY). Implementa a
// regra de negócio exata que o Matheus descreveu pras assinaturas de débito
// automático: no dia da cobrança, confere se a conta tem saldo; se tiver,
// lança o gasto sozinho (marcando de onde veio, pra tela de Assinaturas
// mostrar "confirmado hoje às..."); se não tiver, não lança nada — a tela de
// Assinaturas já mostra o aviso de risco antes disso acontecer, calculando o
// mesmo saldo no navegador.
//
// Assinaturas cobradas no CARTÃO não passam por aqui — elas entram na fatura
// normalmente, sem checagem nenhuma (é assim que cartão de crédito funciona:
// a fatura absorve, o saldo da conta só importa quando a fatura for paga).
//
// Idempotente: roda todo dia, mas só lança uma vez por assinatura por mês —
// antes de lançar, confere se já existe um lançamento deste mês ligado a ela.
//
// Usa a service_role key (ignora RLS de propósito: não há um "usuário
// logado" chamando isso, é o próprio sistema, uma vez por dia, pra TODAS as
// famílias). Protegido por um cabeçalho secreto simples, pra ninguém de fora
// conseguir disparar isso à vontade.
//
// Variáveis de ambiente necessárias na Vercel:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (as mesmas de api/resumo.js)
//   CRON_SECRET = uma senha longa inventada por você, chamada com
//                 ?chave=SUA_SENHA ou no header x-cron-secret

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const chave = req.headers["x-cron-secret"] || req.query?.chave;
  if (!process.env.CRON_SECRET || chave !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: "Faltam variáveis de ambiente (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const hoje = new Date();
  const diaHoje = hoje.getUTCDate();
  const inicioMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)).toISOString().slice(0, 10);

  try {
    const { data: assinaturas, error: e1 } = await supabase
      .from("assinaturas")
      .select("*")
      .eq("ativo", true)
      .eq("tipo_cobranca", "debito")
      .eq("dia_cobranca", diaHoje);
    if (e1) throw e1;

    const resultados = [];

    for (const a of assinaturas || []) {
      const { data: jaLancado } = await supabase
        .from("lancamentos")
        .select("id")
        .eq("assinatura_id", a.id)
        .gte("data", inicioMes)
        .limit(1);
      if (jaLancado && jaLancado.length > 0) {
        resultados.push({ assinatura: a.nome, acao: "ja_lancado_este_mes" });
        continue;
      }

      const { data: conta } = await supabase.from("contas").select("*").eq("id", a.conta_id).single();
      if (!conta) {
        resultados.push({ assinatura: a.nome, acao: "sem_conta_configurada" });
        continue;
      }

      const { data: lancamentosConta } = await supabase
        .from("lancamentos")
        .select("tipo, valor")
        .eq("conta_id", conta.id);
      const saldoAtual = Number(conta.saldo_inicial) + (lancamentosConta || []).reduce((s, l) => s + (l.tipo === "receita" ? Number(l.valor) : -Number(l.valor)), 0);

      if (saldoAtual < Number(a.valor)) {
        resultados.push({ assinatura: a.nome, acao: "saldo_insuficiente", saldo: saldoAtual, valor: a.valor });
        continue;
      }

      const { data: membroDono } = await supabase.from("membros").select("id").eq("familia_id", a.familia_id).eq("papel", "dono").limit(1).single();

      const { error: e2 } = await supabase.from("lancamentos").insert({
        familia_id: a.familia_id,
        membro_id: membroDono?.id,
        tipo: "gasto",
        categoria: a.categoria || "recorrentes",
        valor: a.valor,
        descricao: a.nome,
        data: hoje.toISOString().slice(0, 10),
        conta_id: a.conta_id,
        assinatura_id: a.id,
      });
      if (e2) {
        resultados.push({ assinatura: a.nome, acao: "erro_ao_lancar", detalhe: e2.message });
      } else {
        resultados.push({ assinatura: a.nome, acao: "lancado", valor: a.valor });
      }
    }

    return res.status(200).json({ verificado_em: hoje.toISOString(), total_assinaturas_do_dia: (assinaturas || []).length, resultados });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detalhe: String(e) });
  }
}
