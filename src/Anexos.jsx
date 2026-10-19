import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C } from "./theme.js";
import { ACCEPT_LEITURA, abrirAnexo, ehImagem, excluirAnexo, formatarTamanho, registrarAnexos, subirArquivos, urlAssinada, validarEscolha } from "./anexosUtil.js";

// Anexos (migração 18, 19/10/2026): comprovantes de um lançamento — PDF, fotos
// e qualquer outro arquivo, vários de uma vez.

function iconeDoArquivo(mime, nome = "") {
  if (ehImagem(mime)) return "🖼️";
  if (mime === "application/pdf" || /\.pdf$/i.test(nome)) return "📕";
  if (/word|\.docx?$/i.test(mime + nome)) return "📘";
  if (/sheet|excel|csv|\.xlsx?$/i.test(mime + nome)) return "📗";
  return "📎";
}

// Miniatura quando é foto (link assinado carregado sob demanda), emoji nos outros.
export function MiniaturaAnexo({ caminho, mime, nome, tamanho = 40, onCarregou }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelado = false;
    if (!ehImagem(mime)) return;
    urlAssinada(caminho, 3600).then((u) => { if (!cancelado) setUrl(u); }).catch(() => {});
    return () => { cancelado = true; };
  }, [caminho, mime]);
  if (url) return <img src={url} alt={nome} onLoad={onCarregou} style={{ width: tamanho, height: tamanho, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />;
  return <div style={{ width: tamanho, height: tamanho, borderRadius: 10, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: tamanho * 0.5, flexShrink: 0 }}>{iconeDoArquivo(mime, nome)}</div>;
}

// Lista de arquivos ESCOLHIDOS mas ainda não enviados (usada ao criar um
// lançamento e no chat) — cada um com "×" pra tirar.
export function ArquivosPendentes({ arquivos, onRemover }) {
  if (!arquivos || arquivos.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {arquivos.map((f, i) => (
        <div key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 100, padding: "5px 6px 5px 10px", maxWidth: "100%" }}>
          <span style={{ fontSize: 13 }}>{iconeDoArquivo(f.type, f.name)}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{f.name}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: C.inkFaint }}>{formatarTamanho(f.size)}</span>
          <button type="button" onClick={() => onRemover(i)} aria-label={`Tirar ${f.name}`} style={{ border: "none", background: C.line, color: C.inkMute, width: 20, height: 20, borderRadius: "50%", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

// Botão "Anexar arquivos" que aceita VÁRIOS de uma vez. `jaEscolhidos` serve só
// pra respeitar o limite total; quem chama recebe só os aceitos em `onEscolher`.
export function BotaoAnexar({ jaEscolhidos = [], onEscolher, onAviso, soLeitura = false, rotulo = "📎 Anexar arquivos", disabled }) {
  const ref = useRef(null);
  function aoEscolher(e) {
    const novos = Array.from(e.target.files || []);
    e.target.value = "";
    if (novos.length === 0) return;
    const { aceitos, avisos } = validarEscolha(jaEscolhidos, novos, { soLeitura });
    if (avisos.length > 0 && onAviso) onAviso(avisos.join(" "));
    if (aceitos.length > 0) onEscolher(aceitos);
  }
  return (
    <>
      <input ref={ref} type="file" multiple accept={soLeitura ? ACCEPT_LEITURA : undefined} hidden onChange={aoEscolher} />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} style={{ padding: "8px 14px", borderRadius: 100, border: `1px solid ${C.lineStrong}`, background: "#fff", color: C.ink, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        {rotulo}
      </button>
    </>
  );
}

// Comprovantes de um lançamento que JÁ existe: lista, abre, exclui e anexa mais.
export default function Anexos({ lancamentoId, familiaId }) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState("");

  async function carregar() {
    const { data, error } = await supabase.from("anexos").select("*").eq("lancamento_id", lancamentoId).order("created_at");
    if (error) setAviso(`Não consegui carregar os anexos (rodou a migração 18?): ${error.message}`);
    setItens(data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, [lancamentoId]);

  async function enviar(arquivos) {
    setAviso(""); setEnviando(true);
    try {
      const metas = await subirArquivos(familiaId, arquivos);
      try {
        await registrarAnexos({ lancamentoId, metas });
      } catch (e) {
        // Arquivo subiu mas o registro falhou: não deixa arquivo órfão no Storage.
        await supabase.storage.from("anexos").remove(metas.map((m) => m.caminho)).catch(() => {});
        throw e;
      }
      await carregar();
    } catch (e) {
      setAviso(e.message || "Erro ao enviar os anexos.");
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(a) {
    if (!confirm(`Excluir o anexo "${a.nome}"?`)) return;
    try { await excluirAnexo(a); await carregar(); } catch (e) { setAviso(e.message || "Erro ao excluir."); }
  }

  async function abrir(a) {
    try { await abrirAnexo(a.caminho); } catch (e) { setAviso(e.message || "Não consegui abrir o arquivo."); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.04em" }}>Anexos</div>
      {carregando && <div style={{ fontSize: 12, color: C.inkFaint }}>Carregando…</div>}
      {!carregando && itens.length === 0 && <div style={{ fontSize: 12, color: C.inkFaint }}>Nenhum anexo ainda.</div>}
      {itens.map((a) => (
        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 12, padding: "8px 10px" }}>
          <MiniaturaAnexo caminho={a.caminho} mime={a.mime_type} nome={a.nome} />
          <button type="button" onClick={() => abrir(a)} style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nome}</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: C.inkFaint }}>{formatarTamanho(a.tamanho)} · toque para abrir</div>
          </button>
          <button type="button" onClick={() => excluir(a)} style={{ border: "none", background: "transparent", color: C.danger, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>excluir</button>
        </div>
      ))}
      {aviso && <div style={{ fontSize: 12, color: C.danger }}>{aviso}</div>}
      <div>
        <BotaoAnexar jaEscolhidos={itens} onEscolher={enviar} onAviso={setAviso} disabled={enviando} rotulo={enviando ? "Enviando…" : "📎 Anexar PDF, fotos ou outros arquivos"} />
      </div>
    </div>
  );
}
