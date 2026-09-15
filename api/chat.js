// Função serverless da Vercel — o "COSMO, versão financeira" que aparece no
// chat dentro do próprio Correa Cash. Importante por design: esta função
// NUNCA grava um lançamento no banco. Ela só CONVERSA e, quando entende que o
// usuário quer lançar algo (por texto ou por foto de comprovante), devolve
// uma PROPOSTA estruturada — quem confirma e realmente insere é o navegador,
// chamando o Supabase direto (mesmo caminho de sempre, protegido por RLS),
// só depois que a pessoa aperta "Confirmar e lançar". Isso está documentado
// assim de propósito: nada vindo de chat ou arquivo é lançado sozinho.
//
// Autenticação: o navegador manda o token de sessão do Supabase no header
// Authorization. Esta função cria um cliente Supabase COM ESSE TOKEN (não a
// service_role key), então toda consulta aqui dentro já respeita as mesmas
// políticas de RLS que o resto do app usa — um membro restrito não consegue
// pedir pro chat mostrar o que não teria permissão de ver na tela normal.
//
// Variáveis de ambiente necessárias na Vercel deste projeto (Cash App):
//   SUPABASE_URL          = a mesma Project URL do .env do front-end
//   SUPABASE_ANON_KEY      = a mesma anon key do .env do front-end (pública)
//   ANTHROPIC_API_KEY      = sua chave da API da Anthropic (console.anthropic.com)

import { createClient } from "@supabase/supabase-js";

const MODELO = "claude-sonnet-4-6";

const FERRAMENTAS = [
  {
    name: "propor_lancamento",
    description: "Monta uma PROPOSTA de lançamento (gasto ou receita) a partir do que o usuário descreveu ou de uma foto de comprovante. Não grava nada — só propõe, pra pessoa confirmar na tela.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["gasto", "receita"] },
        categoria: { type: "string", description: "Para gasto, uma de: dia_a_dia, recorrentes, reserva, projetos, casa_familia, saude. Para receita, uma de: trabalho, correa_books, freelas, outros." },
        valor: { type: "number" },
        descricao: { type: "string" },
        data: { type: "string", description: "Data no formato YYYY-MM-DD. Se não tiver certeza, use a data de hoje." },
        pago_com_nome: { type: "string", description: "Nome da conta ou cartão mencionado (ex: 'Nubank', 'Inter'), se souber. Deixe vazio se não souber." },
      },
      required: ["tipo", "categoria", "valor"],
    },
  },
  {
    name: "resumo_periodo",
    description: "Consulta os lançamentos reais da família num período pra responder perguntas analíticas (quanto gastei em X, como estão as finanças, etc). Use antes de responder qualquer pergunta sobre números reais — nunca invente valores.",
    input_schema: {
      type: "object",
      properties: {
        categoria: { type: "string", description: "Filtrar por categoria/frente específica. Deixe vazio para todas." },
        tipo: { type: "string", enum: ["gasto", "receita", "ambos"] },
        dias: { type: "number", description: "Quantos dias pra trás considerar, a partir de hoje. Padrão 30." },
      },
    },
  },
];

const SYSTEM_PROMPT = `Você é o COSMO, na sua versão focada em finanças, dentro do app Correa Cash — o app financeiro de um casal (Matheus e Alessia). Seu papel: ajudar a lançar gastos/receitas (propondo, nunca lançando sozinho) e responder perguntas sobre as finanças do casal usando dados reais (nunca invente números — use a ferramenta resumo_periodo).
Regras importantes:
- Se o usuário descrever uma compra, pagamento, PIX recebido, ou mandar uma foto de comprovante: chame propor_lancamento com os dados que conseguir extrair. Nunca diga que "já lançou" — apenas proponha.
- Se o usuário perguntar algo sobre os próprios números (quanto gastou, como está o orçamento, etc): chame resumo_periodo primeiro, depois responda com base no resultado real.
- Seja direto, caloroso e breve — poucas frases, sem enrolação.
- Nunca dê conselho financeiro genérico não pedido; foque em ajudar com o que foi perguntado.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!apiKey || !supabaseUrl || !anonKey) {
    return res.status(503).json({ error: "Chat ainda não configurado (faltam variáveis de ambiente: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Não autenticado." });

  const { mensagem, imagemBase64, imagemMimeType } = req.body || {};
  if (!mensagem && !imagemBase64) return res.status(400).json({ error: "Envie uma mensagem ou uma imagem." });

  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });

  async function executarFerramenta(nome, entrada) {
    if (nome === "propor_lancamento") {
      // Não grava nada — devolve a própria proposta pra virar a "resposta final".
      return { proposta: entrada };
    }
    if (nome === "resumo_periodo") {
      const dias = entrada.dias || 30;
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let query = supabase.from("lancamentos").select("tipo, categoria, valor, data").gte("data", desde);
      if (entrada.categoria) query = query.eq("categoria", entrada.categoria);
      if (entrada.tipo && entrada.tipo !== "ambos") query = query.eq("tipo", entrada.tipo);
      const { data, error } = await query;
      if (error) return { erro: error.message };
      const totalGasto = (data || []).filter((l) => l.tipo === "gasto").reduce((s, l) => s + Number(l.valor), 0);
      const totalReceita = (data || []).filter((l) => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0);
      return { periodo_dias: dias, total_gasto: totalGasto, total_receita: totalReceita, quantidade_lancamentos: (data || []).length };
    }
    return { erro: "ferramenta desconhecida" };
  }

  const conteudoUsuario = [];
  if (mensagem) conteudoUsuario.push({ type: "text", text: mensagem });
  if (imagemBase64) {
    conteudoUsuario.push({ type: "image", source: { type: "base64", media_type: imagemMimeType || "image/jpeg", data: imagemBase64 } });
    if (!mensagem) conteudoUsuario.push({ type: "text", text: "Leia este comprovante e proponha o lançamento correspondente." });
  }

  const mensagens = [{ role: "user", content: conteudoUsuario }];

  try {
    let proposta = null;
    let textoFinal = "";

    for (let volta = 0; volta < 3; volta++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODELO, max_tokens: 1024, system: SYSTEM_PROMPT, tools: FERRAMENTAS, messages: mensagens }),
      });
      if (!resp.ok) {
        const detalhe = await resp.text();
        return res.status(502).json({ error: "Erro ao falar com o modelo.", detalhe });
      }
      const dados = await resp.json();
      const blocosTexto = (dados.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const blocoFerramenta = (dados.content || []).find((b) => b.type === "tool_use");

      if (!blocoFerramenta) {
        textoFinal = blocosTexto;
        break;
      }

      if (blocoFerramenta.name === "propor_lancamento") {
        proposta = blocoFerramenta.input;
        textoFinal = blocosTexto || "Confere pra mim?";
        break;
      }

      const resultado = await executarFerramenta(blocoFerramenta.name, blocoFerramenta.input);
      mensagens.push({ role: "assistant", content: dados.content });
      mensagens.push({ role: "user", content: [{ type: "tool_result", tool_use_id: blocoFerramenta.id, content: JSON.stringify(resultado) }] });
    }

    return res.status(200).json({ texto: textoFinal, proposta });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detalhe: String(e) });
  }
}
