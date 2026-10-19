// Função serverless da Vercel — lê um arquivo (PDF, Word ou foto de
// comprovante) e devolve uma LISTA de lançamentos propostos. Assim como o
// chat (api/chat.js), esta função nunca grava nada no banco: só propõe. A
// tela ImportarArquivo.jsx é quem insere, depois que a pessoa revisa e
// confirma.
//
// Extração de texto: PDF usa pdf-parse, Word (.docx) usa mammoth — os dois
// rodam aqui no servidor (nunca no navegador). Fotos vão direto pro modelo
// como imagem (visão), sem precisar de OCR separado.
//
// Variáveis de ambiente necessárias (as mesmas de api/chat.js):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from "@supabase/supabase-js";
import { baixarAnexo, mimeEfetivo } from "./_lib/anexos-leitura.js";

const MODELO = "claude-sonnet-4-6";

// bodyParser de 15 MB mantém o formato antigo (arquivo em base64 no corpo)
// funcionando; o formato novo manda só o `caminho` do arquivo no Storage (a
// Vercel limita o corpo a ~4,5 MB, então arquivo grande só passa pelo Storage).
export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: "15mb" } } };

// Migração 10 (categorias personalizadas, 16/09/2026): a descrição de
// "categoria" era um texto fixo com as 6 frentes de gasto e 4 fontes de
// receita da doutrina financeira — agora é montada dinamicamente incluindo
// também as categorias que a própria família criou, pra IA poder propor
// usando elas quando fizer sentido (ex: a família criou "pet" e tem um
// gasto de petshop no extrato).
function montarFerramentaExtracao(categoriasResumo) {
  const gasto = categoriasResumo?.gasto?.length
    ? categoriasResumo.gasto.map((c) => c.chave).join(", ")
    : "dia_a_dia, recorrentes, reserva, projetos, casa_familia, saude";
  const receita = categoriasResumo?.receita?.length
    ? categoriasResumo.receita.map((c) => c.chave).join(", ")
    : "trabalho, correa_books, freelas, outros";
  return {
    name: "lancamentos_encontrados",
    description: "Lista os lançamentos (gastos e/ou receitas) encontrados no arquivo.",
    input_schema: {
      type: "object",
      properties: {
        lancamentos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tipo: { type: "string", enum: ["gasto", "receita"] },
              categoria: { type: "string", description: `gasto: ${gasto}. receita: ${receita}. Se nenhuma encaixar bem, use a mais próxima.` },
              descricao: { type: "string" },
              valor: { type: "number" },
              data: { type: "string", description: "YYYY-MM-DD" },
            },
            required: ["tipo", "categoria", "valor"],
          },
        },
      },
      required: ["lancamentos"],
    },
  };
}

async function extrairTexto(mimeType, base64) {
  const buffer = Buffer.from(base64, "base64");
  if (mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const resultado = await pdfParse(buffer);
    return resultado.text;
  }
  if (mimeType.includes("wordprocessingml") || mimeType === "application/msword") {
    const mammoth = await import("mammoth");
    const resultado = await mammoth.extractRawText({ buffer });
    return resultado.value;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!apiKey || !supabaseUrl || !anonKey) {
    return res.status(503).json({ error: "Importação ainda não configurada (faltam variáveis de ambiente)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  // Confere que o token é válido antes de gastar chamada de IA com arquivo de alguém não autenticado.
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return res.status(401).json({ error: "Sessão inválida." });

  let { nomeArquivo, mimeType, base64, caminho, categoriasResumo } = req.body || {};
  // Formato novo (19/10/2026): o arquivo já está no Storage; baixa com o token
  // da própria pessoa (o RLS do Storage garante que é da família dela).
  if (caminho) {
    try {
      const buffer = await baixarAnexo(supabase, caminho);
      base64 = buffer.toString("base64");
      mimeType = mimeEfetivo(mimeType, nomeArquivo);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (!base64 || !mimeType) return res.status(400).json({ error: "Envie um arquivo." });
  const ferramentaExtracao = montarFerramentaExtracao(categoriasResumo);

  try {
    let conteudoUsuario;
    const ehImagem = mimeType.startsWith("image/");

    if (ehImagem && !/^image\/(jpeg|png|gif|webp)$/.test(mimeType)) {
      return res.status(415).json({ error: `Esse formato de imagem (${mimeType}) o COSMO não lê — use JPG, PNG ou WebP.` });
    }
    if (ehImagem) {
      conteudoUsuario = [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
        { type: "text", text: `Leia esta imagem (${nomeArquivo || "comprovante"}) e liste os lançamentos financeiros nela contidos, usando a ferramenta lancamentos_encontrados.` },
      ];
    } else if (mimeType === "application/pdf") {
      // O PDF vai inteiro pro modelo (ele lê o texto E as imagens das páginas,
      // então extrato escaneado também funciona — o pdf-parse só devolvia texto).
      conteudoUsuario = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: `Este é um PDF (${nomeArquivo || "arquivo"}). Liste todos os lançamentos financeiros (gastos e receitas) que conseguir identificar, usando a ferramenta lancamentos_encontrados.` },
      ];
    } else {
      const texto = await extrairTexto(mimeType, base64);
      if (!texto) return res.status(415).json({ error: "Tipo de arquivo não suportado. Use PDF, Word (.docx) ou uma foto." });
      conteudoUsuario = [
        { type: "text", text: `Este é o conteúdo extraído de um arquivo (${nomeArquivo || "arquivo"}). Liste todos os lançamentos financeiros (gastos e receitas) que conseguir identificar, usando a ferramenta lancamentos_encontrados.\n\n---\n${texto.slice(0, 15000)}` },
      ];
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELO, max_tokens: 8192,
        system: "Você extrai lançamentos financeiros de documentos e imagens pra um app de finanças de um casal. Nunca invente valores que não estão no arquivo. Se não achar nada, devolva uma lista vazia.",
        tools: [ferramentaExtracao],
        tool_choice: { type: "tool", name: "lancamentos_encontrados" },
        messages: [{ role: "user", content: conteudoUsuario }],
      }),
    });
    if (!resp.ok) {
      const detalhe = await resp.text();
      return res.status(502).json({ error: "Erro ao falar com o modelo.", detalhe });
    }
    const dados = await resp.json();
    const bloco = (dados.content || []).find((b) => b.type === "tool_use");
    const lancamentos = bloco?.input?.lancamentos || [];
    return res.status(200).json({ lancamentos });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detalhe: String(e) });
  }
}
