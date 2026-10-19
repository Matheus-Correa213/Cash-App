// Leitura de anexos pelo COSMO (migração 18, 19/10/2026) — usada por
// api/chat.js e api/extrair-arquivo.js.
//
// O navegador sobe os arquivos direto pro bucket PRIVADO "anexos" do Supabase
// Storage (uma função da Vercel aceita só ~4,5 MB por requisição, então PDF e
// várias fotos em base64 não cabem no corpo da chamada) e manda pra cá só o
// CAMINHO de cada um. Aqui a gente baixa usando o token da própria pessoa —
// então o RLS do Storage vale: só dá pra ler arquivo da pasta da própria família.

export const BUCKET = "anexos";
export const MAX_ANEXOS = 8;
export const MAX_BYTES_ARQUIVO = 15 * 1024 * 1024;
// Soma máxima de bytes mandados pro modelo numa mensagem (a API da Anthropic
// aceita até 32 MB por requisição e o base64 incha ~33%).
export const MAX_BYTES_TOTAL = 20 * 1024 * 1024;
const MAX_BYTES_IMAGEM = 5 * 1024 * 1024; // limite do modelo por imagem
const MAX_CARACTERES_TEXTO = 20000;

const IMAGENS_ACEITAS = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const MIME_POR_EXTENSAO = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  csv: "text/csv",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
};

// Só aceita um caminho no formato que o app gera (<familia>/<arquivo>), sem
// subir diretórios — o RLS já barra o resto, isto é defesa em profundidade.
export function caminhoValido(caminho) {
  return typeof caminho === "string"
    && caminho.length > 0 && caminho.length < 300
    && !caminho.includes("..") && !caminho.startsWith("/")
    && /^[0-9a-f-]{36}\/[^/]+$/i.test(caminho);
}

export function mimeEfetivo(mime, nome = "") {
  const m = String(mime || "").toLowerCase();
  if (m && m !== "application/octet-stream") return m;
  const ext = (String(nome).split(".").pop() || "").toLowerCase();
  return MIME_POR_EXTENSAO[ext] || m || "application/octet-stream";
}

export async function baixarAnexo(supabase, caminho) {
  if (!caminhoValido(caminho)) throw new Error("Caminho de arquivo inválido.");
  const { data, error } = await supabase.storage.from(BUCKET).download(caminho);
  if (error || !data) throw new Error(`Não consegui baixar o arquivo (${error?.message || "vazio"}).`);
  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length > MAX_BYTES_ARQUIVO) throw new Error("Arquivo grande demais (máximo 15 MB).");
  return buffer;
}

export async function textoDoWord(buffer) {
  const mammoth = await import("mammoth");
  const r = await mammoth.extractRawText({ buffer });
  return r.value || "";
}

// Baixa os anexos e monta os blocos de conteúdo da API da Anthropic:
//   foto → bloco "image"; PDF → bloco "document" (o modelo lê texto E imagem
//   do PDF); Word/texto/CSV → bloco "text" com o conteúdo extraído.
// Devolve { blocos, avisos, lidos } — o que não deu pra ler vira um aviso (o
// COSMO é informado e conta pra pessoa), nunca derruba a mensagem inteira.
export async function lerAnexos(supabase, anexos) {
  const blocos = [];
  const avisos = [];
  let lidos = 0;
  let total = 0;
  const lista = Array.isArray(anexos) ? anexos.slice(0, MAX_ANEXOS) : [];
  if (Array.isArray(anexos) && anexos.length > MAX_ANEXOS) avisos.push(`Só li os ${MAX_ANEXOS} primeiros arquivos (a mensagem tinha ${anexos.length}).`);

  for (const a of lista) {
    const nome = String(a?.nome || "arquivo").slice(0, 120);
    try {
      const mime = mimeEfetivo(a?.mime_type, nome);
      const buffer = await baixarAnexo(supabase, a?.caminho);
      if (total + buffer.length > MAX_BYTES_TOTAL) { avisos.push(`"${nome}": passou do limite total de tamanho da mensagem, não li.`); continue; }

      if (IMAGENS_ACEITAS.has(mime)) {
        if (buffer.length > MAX_BYTES_IMAGEM) { avisos.push(`"${nome}": a foto passa de 5 MB, não consegui ler.`); continue; }
        blocos.push({ type: "text", text: `Arquivo anexado: ${nome}` });
        blocos.push({ type: "image", source: { type: "base64", media_type: mime, data: buffer.toString("base64") } });
      } else if (mime === "application/pdf") {
        blocos.push({ type: "text", text: `Arquivo anexado: ${nome}` });
        blocos.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } });
      } else if (mime.includes("wordprocessingml") || /\.docx$/i.test(nome)) {
        const texto = (await textoDoWord(buffer)).trim();
        if (!texto) { avisos.push(`"${nome}": não achei texto no documento.`); continue; }
        blocos.push({ type: "text", text: `Conteúdo do arquivo anexado "${nome}":\n---\n${texto.slice(0, MAX_CARACTERES_TEXTO)}` });
      } else if (mime === "text/plain" || mime === "text/csv" || /\.(txt|csv)$/i.test(nome)) {
        const texto = buffer.toString("utf-8").trim();
        if (!texto) { avisos.push(`"${nome}": o arquivo está vazio.`); continue; }
        blocos.push({ type: "text", text: `Conteúdo do arquivo anexado "${nome}":\n---\n${texto.slice(0, MAX_CARACTERES_TEXTO)}` });
      } else {
        avisos.push(`"${nome}": não sei ler esse tipo de arquivo (só foto, PDF, Word, texto e CSV).`);
        continue;
      }
      total += buffer.length;
      lidos++;
    } catch (e) {
      avisos.push(`"${nome}": ${e.message}`);
    }
  }
  return { blocos, avisos, lidos };
}
