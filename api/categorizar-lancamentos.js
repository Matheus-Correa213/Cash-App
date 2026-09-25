// Função serverless da Vercel — categorização automática de lançamentos pelo
// COSMO (leva 12, 25/09/2026). Pedido do Matheus: "o COSMO deveria ajudar,
// podendo analisar todos os gastos e colocar cada um em sua categoria, comigo
// podendo ajustar."
//
// Mesmo princípio de sempre (ver api/chat.js): esta função NUNCA grava nada
// no banco — ela só devolve SUGESTÕES (id do lançamento → categoria
// sugerida). Quem grava é sempre o navegador, usando o token de sessão da
// própria pessoa (respeitando RLS), em dois lugares:
//   1) NovoLancamento.jsx — quando a pessoa escolhe "deixar o COSMO decidir"
//      num lançamento novo, chama isto em segundo plano logo depois de criar
//      o lançamento (com categoria temporária "__sem_categoria__") e já
//      corrige a categoria sozinho, sem precisar de confirmação — é uma
//      configuração que a família liga/desliga (familias.categorizacao_
//      automatica), então já é a permissão dela pra isso acontecer sem
//      revisão item a item.
//   2) Categorias.jsx — o botão "Categorizar com o COSMO" manda todos os
//      lançamentos pendentes de uma vez e mostra cada sugestão numa lista
//      EDITÁVEL antes de gravar ("Confirmar tudo"), pra quando a pessoa quer
//      revisar em vez de confiar no automático.
//
// Autenticação: exige um token de sessão Supabase válido (mesmo formato do
// header usado no resto do app), só pra confirmar que quem está chamando é
// alguém logado de verdade — a categorização em si não lê nem grava nada no
// banco, então não precisa de um cliente Supabase pra consultar dados, só
// pra validar o token.
//
// Variáveis de ambiente necessárias (as mesmas 3 já usadas por api/chat.js):
//   SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY

import { createClient } from "@supabase/supabase-js";

const MODELO = "claude-sonnet-4-6";

// Nota: NovoLancamento.jsx e Categorias.jsx marcam um lançamento como "ainda
// sem categoria escolhida, aguardando o COSMO" com a chave literal
// "__sem_categoria__" — este arquivo nunca recebe nem precisa saber desse
// valor (só recebe a LISTA de lançamentos já pendentes, escolhida pelo
// front-end), então não há nada pra manter sincronizado aqui.

function montarFerramenta(categoriasResumo) {
  const opcoesGasto = (categoriasResumo?.gasto || []).map((c) => `${c.chave} (${c.label})`).join(", ") || "dia_a_dia, recorrentes, reserva, projetos, casa_familia, saude";
  const opcoesReceita = (categoriasResumo?.receita || []).map((c) => `${c.chave} (${c.label})`).join(", ") || "trabalho, correa_books, freelas, outros";
  return {
    name: "categorizar",
    description: "Devolve, pra CADA lançamento recebido, a categoria (chave exata) que melhor combina com a descrição e o valor.",
    input_schema: {
      type: "object",
      properties: {
        classificacoes: {
          type: "array",
          description: "Uma entrada pra cada lançamento recebido, na mesma ordem.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "O id EXATO do lançamento, copiado da lista recebida." },
              categoria: { type: "string", description: `Categorias de GASTO: ${opcoesGasto}. Categorias de RECEITA: ${opcoesReceita}. Use a chave exata da lista que combina com o TIPO daquele lançamento — nunca invente uma chave nova.` },
            },
            required: ["id", "categoria"],
          },
        },
      },
      required: ["classificacoes"],
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!apiKey || !supabaseUrl || !anonKey) {
    return res.status(503).json({ error: "Categorização automática ainda não configurada (faltam variáveis de ambiente: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Não autenticado." });

  // Só valida que o token é de alguém logado de verdade — esta função não
  // precisa consultar nem gravar nada no banco (ver comentário no topo do
  // arquivo), então não monta nenhuma query, só confirma a sessão.
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return res.status(401).json({ error: "Sessão inválida ou expirada." });

  const { lancamentos, categoriasResumo } = req.body || {};
  if (!Array.isArray(lancamentos) || lancamentos.length === 0) {
    return res.status(400).json({ error: "Envie ao menos um lançamento em `lancamentos`." });
  }
  // Limite generoso (o botão "Categorizar com o COSMO" em Categorias.jsx
  // manda tudo que está pendente de uma vez) mas com um teto, pra nunca
  // montar uma mensagem gigante demais pro modelo de uma só vez.
  const lote = lancamentos.slice(0, 200).map((l) => ({
    id: String(l.id),
    tipo: l.tipo === "receita" ? "receita" : "gasto",
    descricao: l.descricao || "(sem descrição)",
    valor: Number(l.valor) || 0,
  }));

  const ferramenta = montarFerramenta(categoriasResumo);
  const listaParaOModelo = lote.map((l) => `- [id: ${l.id}] (${l.tipo}) "${l.descricao}" — R$ ${l.valor.toFixed(2)}`).join("\n");

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 4096,
        system: "Você é o COSMO, ajudando a categorizar lançamentos financeiros de uma família. Categorize cada lançamento recebido chamando a ferramenta `categorizar` UMA ÚNICA VEZ, com uma entrada pra cada um, na mesma ordem — nunca deixe nenhum de fora.",
        tools: [ferramenta],
        tool_choice: { type: "tool", name: "categorizar" },
        messages: [{ role: "user", content: `Categorize estes lançamentos:\n${listaParaOModelo}` }],
      }),
    });
    if (!resp.ok) {
      const detalhe = await resp.text();
      return res.status(502).json({ error: "Erro ao falar com o modelo.", detalhe });
    }
    const dados = await resp.json();
    const blocoFerramenta = (dados.content || []).find((b) => b.type === "tool_use" && b.name === "categorizar");
    const classificacoes = blocoFerramenta?.input?.classificacoes || [];
    // Só devolve sugestões pra ids que realmente foram mandados — uma
    // salvaguarda barata contra o modelo inventar ou repetir um id.
    const idsValidos = new Set(lote.map((l) => l.id));
    const sugestoes = classificacoes.filter((c) => idsValidos.has(String(c.id)) && c.categoria);
    return res.status(200).json({ sugestoes });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detalhe: String(e) });
  }
}
