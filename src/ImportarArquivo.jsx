import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda } from "./theme.js";
import { IconUpload } from "./Icons.jsx";
import { ArquivosPendentes, BotaoAnexar } from "./Anexos.jsx";
import { BUCKET, subirArquivos } from "./anexosUtil.js";

// Importar e anexar — lê PDF/Word/foto e propõe lançamentos pra revisão.
// Mesmo princípio do chat: o COSMO nunca lança nada de arquivo sozinho.
//
// 19/10/2026 (pedido do Matheus: "poder anexar PDF, fotos e tudo (...) e mais de
// um anexo de uma vez"): agora aceita VÁRIOS arquivos de uma vez. Cada um sobe
// pro Storage, é lido em separado (uma chamada por arquivo, pra não estourar
// o tempo da função) e as propostas aparecem agrupadas por arquivo. Ao
// confirmar, cada arquivo fica ANEXADO aos lançamentos que saíram dele — o
// comprovante passa a morar junto do lançamento.
//
// `frentesGasto`/`fontesReceita` (migração 10, categorias personalizadas,
// 16/09/2026): mescladas (fixas + criadas pela família) de OwnerView.jsx —
// usadas aqui só pra mostrar o rótulo certo de cada proposta encontrada; a
// própria extração (api/extrair-arquivo.js) também recebe essas categorias,
// pra poder propor usando as personalizadas quando fizer sentido.

export default function ImportarArquivo({ membro, frentesGasto, fontesReceita, onVoltar, onSalvo }) {
  const [escolhidos, setEscolhidos] = useState([]); // File[] ainda não lidos
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [erro, setErro] = useState("");
  // Resultado da leitura: [{ meta, erro?, propostas: [{...campos, selecionado}] }]
  const [resultados, setResultados] = useState(null);
  const [salvando, setSalvando] = useState(false);
  // Arquivos já no Storage mas ainda não confirmados — se a pessoa sair da
  // tela ou descartar, a gente apaga pra não sobrar lixo.
  const naoConfirmados = useRef([]);

  useEffect(() => () => {
    if (naoConfirmados.current.length > 0) supabase.storage.from(BUCKET).remove(naoConfirmados.current.map((m) => m.caminho)).catch(() => {});
  }, []);

  function aoEscolher(novos) {
    if (novos.some((f) => /\.ofx$/i.test(f.name))) {
      setErro("Arquivo OFX (fatura de cartão) se importa pela tela do cartão: Mais → Contas e cartões → escolha o cartão → \"Importar fatura (OFX)\".");
    } else {
      setErro("");
    }
    setEscolhidos((atual) => [...atual, ...novos.filter((f) => !/\.ofx$/i.test(f.name))]);
  }

  async function descartar() {
    const metas = naoConfirmados.current;
    naoConfirmados.current = [];
    setResultados(null);
    if (metas.length > 0) await supabase.storage.from(BUCKET).remove(metas.map((m) => m.caminho)).catch(() => {});
  }

  async function lerArquivos() {
    if (escolhidos.length === 0) return;
    setErro(""); setProcessando(true); setResultados(null);
    let metas = [];
    try {
      setProgresso("Enviando os arquivos…");
      metas = await subirArquivos(membro.familia_id, escolhidos);
      naoConfirmados.current = metas;
      const { data: { session } } = await supabase.auth.getSession();
      const categoriasResumo = {
        gasto: frentesGasto.map((f) => ({ chave: f.chave, label: f.label })),
        receita: fontesReceita.map((f) => ({ chave: f.chave, label: f.label })),
      };
      const lidos = [];
      for (let i = 0; i < metas.length; i++) {
        const meta = metas[i];
        setProgresso(`Lendo ${i + 1} de ${metas.length}: ${meta.nome}`);
        try {
          const resp = await fetch("/api/extrair-arquivo", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
            body: JSON.stringify({ nomeArquivo: meta.nome, mimeType: meta.mime_type, caminho: meta.caminho, categoriasResumo }),
          });
          const dados = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(dados.error || "Erro ao processar arquivo.");
          lidos.push({ meta, propostas: (dados.lancamentos || []).map((l) => ({ ...l, selecionado: true })) });
        } catch (e) {
          // Um arquivo com problema não derruba os outros.
          lidos.push({ meta, erro: e.message || "Erro ao processar arquivo.", propostas: [] });
        }
      }
      setResultados(lidos);
      setEscolhidos([]);
    } catch (e) {
      setErro(e.message || "Erro ao processar os arquivos.");
    } finally {
      setProcessando(false); setProgresso("");
    }
  }

  function alternar(ri, pi) {
    setResultados((rs) => rs.map((r, i) => (i !== ri ? r : { ...r, propostas: r.propostas.map((p, j) => (j === pi ? { ...p, selecionado: !p.selecionado } : p)) })));
  }

  const totalSelecionados = (resultados || []).reduce((s, r) => s + r.propostas.filter((p) => p.selecionado).length, 0);
  const totalEncontrados = (resultados || []).reduce((s, r) => s + r.propostas.length, 0);

  async function adicionarSelecionados() {
    if (totalSelecionados === 0) return;
    setSalvando(true);
    const avisos = [];
    let adicionados = 0;
    const processados = new Set(); // arquivos já resolvidos (não aparecem de novo se der erro no meio)
    const tirarDosNaoConfirmados = (caminho) => { naoConfirmados.current = naoConfirmados.current.filter((m) => m.caminho !== caminho); };
    try {
      const paraApagar = [];
      for (const r of resultados) {
        const escolhidosDoArquivo = r.propostas.filter((p) => p.selecionado);
        if (escolhidosDoArquivo.length === 0) { paraApagar.push(r.meta.caminho); tirarDosNaoConfirmados(r.meta.caminho); processados.add(r.meta.caminho); continue; }
        const linhas = escolhidosDoArquivo.map((p) => ({
          familia_id: membro.familia_id,
          membro_id: membro.id,
          tipo: p.tipo,
          categoria: p.categoria,
          valor: Number(p.valor),
          descricao: p.descricao || null,
          data: p.data || new Date().toISOString().slice(0, 10),
        }));
        const { data: criados, error } = await supabase.from("lancamentos").insert(linhas).select("id");
        if (error) throw new Error(`${r.meta.nome}: ${error.message}`);
        adicionados += (criados || []).length;
        tirarDosNaoConfirmados(r.meta.caminho);
        processados.add(r.meta.caminho);
        // O mesmo arquivo é ligado a cada lançamento que saiu dele (uma só
        // chamada, mesmo que o extrato tenha dezenas de linhas).
        try {
          const { error: erroAnexo } = await supabase.from("anexos").insert(
            (criados || []).map((c) => ({ lancamento_id: c.id, caminho: r.meta.caminho, nome: r.meta.nome, mime_type: r.meta.mime_type, tamanho: r.meta.tamanho }))
          );
          if (erroAnexo) throw erroAnexo;
        } catch (e) {
          avisos.push(`Os lançamentos de "${r.meta.nome}" foram salvos, mas não consegui anexar o arquivo a eles (${e.message}).`);
        }
      }
      if (paraApagar.length > 0) await supabase.storage.from(BUCKET).remove(paraApagar).catch(() => {});
      setResultados(null);
      onSalvo && onSalvo();
      if (avisos.length > 0) alert(avisos.join("\n"));
    } catch (e) {
      // O que já foi inserido antes do erro fica salvo — avisa quanto foi.
      alert(`${adicionados > 0 ? `${adicionados} lançamento(s) já foram adicionados antes do erro. ` : ""}${e.message}`);
      if (adicionados > 0) {
        setResultados((rs) => (rs || []).filter((r) => !processados.has(r.meta.caminho)));
        onSalvo && onSalvo();
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>}

      <div style={{ background: C.card, border: `1.5px dashed ${C.lineStrong}`, borderRadius: 18, padding: "26px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <IconUpload size={22} color={C.accent} strokeWidth={1.9} />
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Anexar PDFs, Words ou fotos</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, lineHeight: 1.4 }}>Extratos, comprovantes, resumos — escolha vários de uma vez. O COSMO lê e sugere os lançamentos; cada arquivo fica anexado aos lançamentos que saírem dele.</span>

        <ArquivosPendentes arquivos={escolhidos} onRemover={(i) => setEscolhidos((a) => a.filter((_, j) => j !== i))} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
          <BotaoAnexar jaEscolhidos={escolhidos} onEscolher={aoEscolher} onAviso={setErro} soLeitura disabled={processando} rotulo={escolhidos.length > 0 ? "＋ Mais arquivos" : "Escolher arquivos"} />
          {escolhidos.length > 0 && (
            <button onClick={lerArquivos} disabled={processando} style={{ background: C.accent, borderRadius: 100, padding: "8px 20px", border: "none", color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
              {processando ? "Lendo…" : `Ler ${escolhidos.length} arquivo${escolhidos.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
        {progresso && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.inkMute }}>{progresso}</span>}
      </div>

      <div style={{ display: "flex", gap: 10, background: C.amberSoft, border: `1px solid ${C.amberBorder}`, borderRadius: 14, padding: "12px 14px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.amberText, lineHeight: 1.45 }}>
          No iPhone, compartilhar direto do rolo de fotos pra um app da web ainda não existe (limitação da Apple) — por isso o botão acima. Um Atalho do iOS pode deixar isso em 1 toque a mais.
        </span>
      </div>

      {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}

      {resultados && (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {totalEncontrados === 0
            ? <div style={{ color: C.inkFaint, fontSize: 13 }}>Não encontrei nenhum lançamento {resultados.length === 1 ? "nesse arquivo" : "nesses arquivos"}.</div>
            : <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{totalEncontrados} lançamento{totalEncontrados === 1 ? "" : "s"} encontrado{totalEncontrados === 1 ? "" : "s"} — confira antes de adicionar:</div>}

          {resultados.map((r, ri) => (
            <div key={r.meta.caminho} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.inkMute, textTransform: "uppercase", letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {r.meta.nome}</div>
              {r.erro && <div style={{ color: C.danger, fontSize: 12.5 }}>Não consegui ler este arquivo: {r.erro}</div>}
              {!r.erro && r.propostas.length === 0 && <div style={{ color: C.inkFaint, fontSize: 12.5 }}>Nenhum lançamento encontrado neste arquivo.</div>}
              {r.propostas.map((p, pi) => {
                const info = (p.tipo === "receita" ? fontesReceita : frentesGasto).find((f) => f.chave === p.categoria);
                return (
                  <label key={pi} style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 12, padding: "10px 12px", cursor: "pointer" }}>
                    <input type="checkbox" checked={p.selecionado} onChange={() => alternar(ri, pi)} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{p.descricao || info?.label || p.categoria}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.inkFaint }}>{p.data || ""} · {p.tipo === "receita" ? "Receita" : "Gasto"} → {info?.label || p.categoria}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: p.tipo === "receita" ? C.greenText : C.coralText }}>{moeda(p.valor)}</span>
                  </label>
                );
              })}
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={descartar} disabled={salvando} style={{ background: "transparent", borderRadius: 10, border: `1px solid ${C.lineStrong}`, padding: "11px 16px", color: C.inkMute, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Descartar</button>
            {totalEncontrados > 0 && (
              <button onClick={adicionarSelecionados} disabled={salvando || totalSelecionados === 0} style={{ flex: 1, background: C.accent, borderRadius: 10, border: "none", padding: "11px 0", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: totalSelecionados === 0 ? 0.5 : 1 }}>
                {salvando ? "Adicionando…" : `Adicionar ${totalSelecionados}`}
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, background: C.navy, borderRadius: 14, padding: "13px 15px" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>O COSMO nunca lança nada de arquivo sozinho — ele sempre mostra o que encontrou primeiro, pra você confirmar.</span>
      </div>
    </div>
  );
}
