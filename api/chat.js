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
    name: "propor_conta_ou_cartao",
    description: "Monta uma PROPOSTA pra criar ou atualizar uma conta bancária, carteira física, ou cartão de crédito — use quando o usuário informar saldos atuais, um cartão/conta novo, ou mudanças em limite/fatura/dados de uma conta ou cartão que já existe. Não grava nada — só propõe, a pessoa confirma na tela. Se o usuário mandar várias contas/cartões de uma vez (ex: uma lista de saldos), chame esta ferramenta VÁRIAS VEZES em paralelo, uma proposta por conta/cartão — não junte tudo numa só chamada.",
    input_schema: {
      type: "object",
      properties: {
        acao: { type: "string", enum: ["criar_conta", "atualizar_conta", "criar_cartao", "atualizar_cartao"], description: "atualizar_* é quando o nome já bate com uma conta/cartão existente que o app te mostrou; criar_* quando não existe ainda." },
        nome_existente: { type: "string", description: "Só pra 'atualizar_*': o nome EXATO da conta/cartão já existente (de acordo com a lista de contas/cartões que você já viu), pra encontrar no banco." },
        nome: { type: "string", description: "Nome da conta/cartão (novo, ou o nome atualizado)." },
        tipo: { type: "string", enum: ["corrente", "poupanca", "carteira", "outro"], description: "Só pra contas. 'carteira' é dinheiro físico." },
        instituicao: { type: "string", description: "Só pra contas (ex: Nubank, Inter, Banco do Brasil, Mercado Pago, Revolut). Deixe vazio se for carteira física." },
        bandeira: { type: "string", description: "Só pra cartões (ex: Visa, Mastercard, Nubank)." },
        titular: { type: "string", description: "De quem é a conta/cartão (ex: Matheus, Alessia)." },
        saldo_inicial: { type: "number", description: "Só pra contas — o saldo de hoje, o ponto de partida a partir de agora." },
        limite: { type: "number", description: "Só pra cartões — limite total." },
        dia_fechamento: { type: "number", description: "Só pra cartões — dia do mês que a fatura fecha." },
        dia_vencimento: { type: "number", description: "Só pra cartões — dia do mês que a fatura vence." },
      },
      required: ["acao"],
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

function montarSystemPrompt(contasResumo, cartoesResumo) {
  const listaContas = (contasResumo || []).length
    ? (contasResumo || []).map((c) => `- ${c.nome} (${c.tipo}${c.instituicao ? `, ${c.instituicao}` : ""}${c.titular ? `, de ${c.titular}` : ""})`).join("\n")
    : "(nenhuma conta cadastrada ainda)";
  const listaCartoes = (cartoesResumo || []).length
    ? (cartoesResumo || []).map((k) => `- ${k.nome} (${k.bandeira || "?"}${k.titular ? `, de ${k.titular}` : ""})`).join("\n")
    : "(nenhum cartão cadastrado ainda)";

  return `Você é o COSMO, na sua versão focada em finanças, dentro do app Correa Cash — o app financeiro de um casal (Matheus e Alessia). Seu papel: ajudar a lançar gastos/receitas, ajudar a configurar contas/carteiras/cartões, e responder perguntas sobre as finanças do casal usando dados reais (nunca invente números — use a ferramenta resumo_periodo). Você NUNCA grava nada sozinho — toda ação (lançamento, conta, cartão) é sempre uma PROPOSTA que a pessoa confirma na tela, sem exceção.

Contas/carteiras já cadastradas nesta família:
${listaContas}

Cartões de crédito já cadastrados nesta família:
${listaCartoes}

Regras importantes:
- Se o usuário descrever uma compra, pagamento, PIX recebido, ou mandar uma foto de comprovante: chame propor_lancamento com os dados que conseguir extrair. Nunca diga que "já lançou" — apenas proponha.
- Se o usuário informar saldos de contas/carteiras, um cartão novo, ou mudanças em limite/fatura/dados de uma conta ou cartão (olhe a lista acima pra saber se já existe): chame propor_conta_ou_cartao. Se vier mais de uma conta/cartão na mesma mensagem, chame a ferramenta várias vezes em paralelo, uma por conta/cartão — nunca junte várias contas numa proposta só.
- Ao decidir 'criar_conta/cartao' vs 'atualizar_conta/cartao', compare com a lista acima (por nome) — se já existe algo parecido, use 'atualizar_*' com nome_existente igual ao nome já cadastrado.
- Se o usuário perguntar algo sobre os próprios números (quanto gastou, como está o orçamento, etc): chame resumo_periodo primeiro, depois responda com base no resultado real.
- Seja direto, caloroso e breve — poucas frases, sem enrolação.
- Nunca dê conselho financeiro genérico não pedido; foque em ajudar com o que foi perguntado.`;
}

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

  const { mensagem, imagemBase64, imagemMimeType, contasResumo, cartoesResumo } = req.body || {};
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

  const systemPrompt = montarSystemPrompt(contasResumo, cartoesResumo);
  const NOMES_FERRAMENTAS_PROPOSTA = new Set(["propor_lancamento", "propor_conta_ou_cartao"]);

  try {
    let propostas = [];
    let textoFinal = "";

    for (let volta = 0; volta < 3; volta++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODELO, max_tokens: 1536, system: systemPrompt, tools: FERRAMENTAS, messages: mensagens }),
      });
      if (!resp.ok) {
        const detalhe = await resp.text();
        return res.status(502).json({ error: "Erro ao falar com o modelo.", detalhe });
      }
      const dados = await resp.json();
      const blocosTexto = (dados.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const blocosFerramenta = (dados.content || []).filter((b) => b.type === "tool_use");

      if (blocosFerramenta.length === 0) {
        textoFinal = blocosTexto;
        break;
      }

      // Uma ou mais propostas na mesma rodada (ex: o usuário mandou o saldo de
      // 7 contas de uma vez) — pegamos TODAS, nunca só a primeira, e paramos
      // aqui: proposta é sempre o fim da conversa, quem decide é a pessoa.
      const blocosProposta = blocosFerramenta.filter((b) => NOMES_FERRAMENTAS_PROPOSTA.has(b.name));
      if (blocosProposta.length > 0) {
        propostas = blocosProposta.map((b) => ({
          natureza: b.name === "propor_lancamento" ? "lancamento" : "conta_ou_cartao",
          dados: b.input,
        }));
        textoFinal = blocosTexto || (propostas.length > 1 ? `Preparei ${propostas.length} propostas — confere pra mim?` : "Confere pra mim?");
        break;
      }

      // Só ferramentas de consulta nessa rodada (ex: resumo_periodo) — executa
      // todas e devolve os resultados, a conversa continua.
      const resultados = await Promise.all(
        blocosFerramenta.map(async (b) => ({ id: b.id, resultado: await executarFerramenta(b.name, b.input) }))
      );
      mensagens.push({ role: "assistant", content: dados.content });
      mensagens.push({
        role: "user",
        content: resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.resultado) })),
      });
    }

    return res.status(200).json({ texto: textoFinal, propostas });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detalhe: String(e) });
  }
}
