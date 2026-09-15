import React, { useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, frenteDe, FONTES_RECEITA, moeda } from "./theme.js";

// Importar e anexar — lê PDF/Word/foto e propõe lançamentos pra revisão.
// Mesmo princípio do chat: o COSMO nunca lança nada de arquivo sozinho.

export default function ImportarArquivo({ membro, onVoltar, onSalvo }) {
  const inputRef = useRef(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");
  const [propostas, setPropostas] = useState(null); // array de { ...campos, selecionado }
  const [salvando, setSalvando] = useState(false);

  async function onEscolherArquivo(e) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setNomeArquivo(arquivo.name);
    setErro("");
    setPropostas(null);
    setProcessando(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(String(leitor.result).split(",")[1]);
        leitor.onerror = reject;
        leitor.readAsDataURL(arquivo);
      });
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch("/api/extrair-arquivo", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ nomeArquivo: arquivo.name, mimeType: arquivo.type, base64 }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.error || "Erro ao processar arquivo.");
      setPropostas((dados.lancamentos || []).map((l) => ({ ...l, selecionado: true })));
    } catch (e) {
      setErro(e.message || "Erro ao processar arquivo.");
    } finally {
      setProcessando(false);
      e.target.value = "";
    }
  }

  function alternar(i) {
    setPropostas((ps) => ps.map((p, idx) => (idx === i ? { ...p, selecionado: !p.selecionado } : p)));
  }

  async function adicionarSelecionados() {
    const escolhidos = propostas.filter((p) => p.selecionado);
    if (escolhidos.length === 0) return;
    setSalvando(true);
    try {
      const linhas = escolhidos.map((p) => ({
        familia_id: membro.familia_id,
        membro_id: membro.id,
        tipo: p.tipo,
        categoria: p.categoria,
        valor: Number(p.valor),
        descricao: p.descricao || null,
        data: p.data || new Date().toISOString().slice(0, 10),
      }));
      const { error } = await supabase.from("lancamentos").insert(linhas);
      if (error) throw error;
      setPropostas(null);
      setNomeArquivo("");
      onSalvo && onSalvo();
    } catch (e) {
      alert(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>}

      <input ref={inputRef} type="file" accept="application/pdf,.docx,image/*" hidden onChange={onEscolherArquivo} />
      <div style={{ background: C.card, border: `1.5px dashed ${C.lineStrong}`, borderRadius: 18, padding: "26px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: C.accentSoft }} />
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Anexar PDF, Word ou foto</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, lineHeight: 1.4 }}>Extrato do banco, resumo de gastos em Word, ou foto de um comprovante — o COSMO lê e sugere os lançamentos.</span>
        <button onClick={() => inputRef.current?.click()} disabled={processando} style={{ background: C.accent, borderRadius: 10, padding: "10px 22px", marginTop: 6, border: "none", color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
          {processando ? "Lendo…" : "Escolher arquivo"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, background: C.amberSoft, border: `1px solid ${C.amberBorder}`, borderRadius: 14, padding: "12px 14px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.amberText, lineHeight: 1.45 }}>
          No iPhone, compartilhar direto do rolo de fotos pra um app da web ainda não existe (limitação da Apple) — por isso o botão acima. Um Atalho do iOS pode deixar isso em 1 toque a mais.
        </span>
      </div>

      {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}

      {propostas && (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{nomeArquivo}</div>
          {propostas.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13 }}>Não encontrei nenhum lançamento nesse arquivo.</div>}
          {propostas.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{propostas.length} lançamento{propostas.length === 1 ? "" : "s"} encontrado{propostas.length === 1 ? "" : "s"} — confira antes de adicionar:</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {propostas.map((p, i) => {
              const info = p.tipo === "receita" ? FONTES_RECEITA.find((f) => f.chave === p.categoria) : frenteDe(p.categoria);
              return (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 12, padding: "10px 12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={p.selecionado} onChange={() => alternar(i)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{p.descricao || info?.label || p.categoria}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.inkFaint }}>{p.data || ""} · {p.tipo === "receita" ? "Receita" : "Gasto"} → {info?.label || p.categoria}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 800, color: p.tipo === "receita" ? C.greenText : C.coralText }}>{moeda(p.valor)}</span>
                </label>
              );
            })}
          </div>
          {propostas.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={adicionarSelecionados} disabled={salvando} style={{ flex: 1, background: C.accent, borderRadius: 10, border: "none", padding: "11px 0", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
                {salvando ? "Adicionando…" : `Adicionar ${propostas.filter((p) => p.selecionado).length}`}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, background: C.navy, borderRadius: 14, padding: "13px 15px" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>O COSMO nunca lança nada de arquivo sozinho — ele sempre mostra o que encontrou primeiro, pra você confirmar.</span>
      </div>
    </div>
  );
}
