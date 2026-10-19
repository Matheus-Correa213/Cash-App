import { supabase } from "./supabaseClient.js";

// Anexos (migração 18, 19/10/2026) — PDF, fotos e outros arquivos, vários de
// uma vez. Os arquivos ficam no bucket PRIVADO "anexos" do Supabase Storage,
// numa pasta por família (<familia_id>/<uuid>-<nome>); a tabela `anexos`
// liga cada arquivo a um lançamento (quando é comprovante dele).
//
// Por que o arquivo vai direto pro Storage (e não dentro do corpo da chamada
// pras funções da Vercel): uma função serverless da Vercel aceita no máximo
// ~4,5 MB por requisição, e um PDF ou algumas fotos em base64 estouram isso
// fácil. Assim o navegador sobe o arquivo e a função só recebe o CAMINHO, e
// baixa de lá usando o token da própria pessoa (então o RLS do Storage vale).

export const BUCKET = "anexos";
export const MAX_ARQUIVOS = 8;
export const MAX_BYTES = 15 * 1024 * 1024;

// O que o COSMO consegue LER (chat e importação). Pra guardar como comprovante
// de um lançamento, qualquer tipo serve.
export const ACCEPT_LEITURA = "image/*,application/pdf,.pdf,.docx,.txt,.csv";

const MIME_POR_EXTENSAO = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
};

export function mimeDoArquivo(arquivo) {
  if (arquivo.type) return arquivo.type;
  const ext = (arquivo.name.split(".").pop() || "").toLowerCase();
  return MIME_POR_EXTENSAO[ext] || "application/octet-stream";
}

export function ehImagem(mime) { return /^image\//.test(mime || ""); }

// O COSMO só lê estes tipos (as imagens que o modelo aceita + PDF + Word + texto).
export function tipoLegivelPeloCosmo(mime, nome = "") {
  if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) return true;
  if (mime === "application/pdf") return true;
  if (mime.includes("wordprocessingml")) return true;
  if (mime === "text/plain" || mime === "text/csv") return true;
  return /\.(txt|csv|docx)$/i.test(nome);
}

export function formatarTamanho(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function nomeSeguro(nome) {
  const limpo = String(nome || "arquivo")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (limpo || "arquivo").slice(-80);
}

// Foto de celular costuma ter 3–8 MB; o modelo recusa imagem acima de 5 MB e
// o upload fica lento no 4G. Reduz pra no máximo 2000 px no lado maior e
// regrava como JPEG — texto de comprovante continua perfeitamente legível.
// Qualquer falha devolve o arquivo original, nunca trava o envio.
export async function prepararArquivo(arquivo) {
  const mime = mimeDoArquivo(arquivo);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) return arquivo;
  try {
    const bitmap = await createImageBitmap(arquivo);
    const maior = Math.max(bitmap.width, bitmap.height);
    if (arquivo.size <= 1_200_000 && maior <= 2000 && mime === "image/jpeg") { bitmap.close?.(); return arquivo; }
    const escala = Math.min(1, 2000 / maior);
    const largura = Math.round(bitmap.width * escala);
    const altura = Math.round(bitmap.height * escala);
    const canvas = document.createElement("canvas");
    canvas.width = largura; canvas.height = altura;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, largura, altura); // PNG transparente vira fundo branco
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= arquivo.size && mime === "image/jpeg") return arquivo;
    const nome = arquivo.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg" });
  } catch {
    return arquivo;
  }
}

// Confere a lista escolhida (quantidade e tamanho) e devolve { aceitos, avisos }.
export function validarEscolha(jaEscolhidos, novos, { soLeitura = false } = {}) {
  const aceitos = [];
  const avisos = [];
  for (const f of novos) {
    const mime = mimeDoArquivo(f);
    if (soLeitura && !tipoLegivelPeloCosmo(mime, f.name)) { avisos.push(`"${f.name}": o COSMO lê só foto, PDF, Word (.docx) e texto/CSV.`); continue; }
    if (f.size > MAX_BYTES) { avisos.push(`"${f.name}" passa de ${formatarTamanho(MAX_BYTES)}.`); continue; }
    if (jaEscolhidos.length + aceitos.length >= MAX_ARQUIVOS) { avisos.push(`Máximo de ${MAX_ARQUIVOS} arquivos por vez — "${f.name}" ficou de fora.`); continue; }
    aceitos.push(f);
  }
  return { aceitos, avisos };
}

// Sobe os arquivos (já preparados) pro Storage e devolve os metadados
// [{ caminho, nome, mime_type, tamanho }]. Se UM falhar, apaga os que já
// subiram nesta chamada e lança o erro — tudo ou nada.
export async function subirArquivos(familiaId, arquivos) {
  const subidos = [];
  try {
    for (const original of arquivos) {
      const arquivo = await prepararArquivo(original);
      const mime = mimeDoArquivo(arquivo);
      const caminho = `${familiaId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: mime, upsert: false });
      if (error) throw new Error(`Não consegui enviar "${original.name}": ${error.message}`);
      subidos.push({ caminho, nome: arquivo.name, mime_type: mime, tamanho: arquivo.size });
    }
    return subidos;
  } catch (e) {
    if (subidos.length > 0) await supabase.storage.from(BUCKET).remove(subidos.map((s) => s.caminho)).catch(() => {});
    throw e;
  }
}

// Liga arquivos já enviados a um lançamento (insere as linhas em `anexos`).
export async function registrarAnexos({ lancamentoId, metas }) {
  if (!metas || metas.length === 0) return [];
  const { data, error } = await supabase.from("anexos").insert(
    metas.map((m) => ({ lancamento_id: lancamentoId || null, caminho: m.caminho, nome: m.nome, mime_type: m.mime_type, tamanho: m.tamanho }))
  ).select();
  if (error) throw error;
  return data || [];
}

export async function urlAssinada(caminho, segundos = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, segundos);
  if (error) throw error;
  return data.signedUrl;
}

export async function abrirAnexo(caminho) {
  // Abre a aba ANTES da chamada assíncrona: o navegador do celular bloqueia
  // window.open feito depois de um await (não conta mais como clique).
  const aba = window.open("", "_blank");
  try {
    const url = await urlAssinada(caminho, 600);
    if (aba) aba.location.href = url; else window.location.href = url;
  } catch (e) {
    if (aba) aba.close();
    throw e;
  }
}

// Apaga o registro e, se nenhum outro registro usa o mesmo arquivo (a
// importação liga um mesmo PDF a vários lançamentos), apaga o arquivo também.
export async function excluirAnexo(anexo) {
  const { data, error } = await supabase.from("anexos").delete().eq("id", anexo.id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("O anexo não foi excluído — o banco não confirmou.");
  const { count } = await supabase.from("anexos").select("id", { count: "exact", head: true }).eq("caminho", anexo.caminho);
  if (!count) await supabase.storage.from(BUCKET).remove([anexo.caminho]).catch(() => {});
}
