import React, { useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, FRENTES_GASTO, FONTES_RECEITA, frenteDe, instituicaoDe, moeda } from "./theme.js";
import { IconCosmoFull, IconChevronLeft, IconSend, IconReceiptScan } from "./Icons.jsx";

// Chat com o COSMO, versão financeira. A IA só PROPÕE (ver api/chat.js) — o
// lançamento de verdade só acontece quando a pessoa aperta "Confirmar e
// lançar" aqui embaixo, que insere direto no Supabase como qualquer outro
// lançamento do app (sem passar pela IA de novo).

const SUGESTOES = ["Adicionar gasto", "Anexar comprovante", "Como estão minhas finanças?"];

export default function ChatCosmo({ membro, contas, cartoes, onVoltar, onSalvo }) {
  const [mensagens, setMensagens] = useState([
    { autor: "cosmo", texto: "Oi! Posso lançar gastos e receitas, ler comprovantes e te dar um resumo rápido. É só me mandar uma mensagem ou uma foto." },
  ]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const inputArquivo = useRef(null);
  const areaTexto = useRef(null);

  // Textarea que cresce pra baixo conforme a pessoa escreve (até um teto,
  // pra não tomar a tela toda), com Enter enviando e Shift+Enter quebrando
  // linha — o padrão de qualquer chat de verdade, em vez do <input> de uma
  // linha só que tinha antes.
  function ajustarAltura(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function aoDigitar(e) {
    setTexto(e.target.value);
    ajustarAltura(e.target);
  }

  function aoTeclar(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (texto.trim() && !enviando) {
        enviar(texto.trim());
        requestAnimationFrame(() => ajustarAltura(areaTexto.current));
      }
    }
  }

  async function enviar(mensagemTexto, imagem) {
    setErro("");
    setEnviando(true);
    const minhaMensagem = { autor: "usuario", texto: mensagemTexto, imagemPreview: imagem?.preview };
    setMensagens((m) => [...m, minhaMensagem]);
    setTexto("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ mensagem: mensagemTexto || undefined, imagemBase64: imagem?.base64, imagemMimeType: imagem?.mimeType }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.error || "Erro ao falar com o COSMO.");
      setMensagens((m) => [...m, { autor: "cosmo", texto: dados.texto, proposta: dados.proposta || null }]);
    } catch (e) {
      setErro(e.message || "Erro ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  function onEscolherArquivo(e) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      const base64 = String(leitor.result).split(",")[1];
      enviar(null, { base64, mimeType: arquivo.type, preview: URL.createObjectURL(arquivo) });
    };
    leitor.readAsDataURL(arquivo);
    e.target.value = "";
  }

  async function confirmarProposta(proposta, indiceMensagem) {
    try {
      const opcoesPagamento = [...contas.map((c) => ({ tipo: "conta", id: c.id, nome: c.nome })), ...cartoes.map((k) => ({ tipo: "cartao", id: k.id, nome: k.nome }))];
      const achado = proposta.pago_com_nome ? opcoesPagamento.find((o) => o.nome.toLowerCase().includes(String(proposta.pago_com_nome).toLowerCase())) : null;
      const { error } = await supabase.from("lancamentos").insert({
        familia_id: membro.familia_id,
        membro_id: membro.id,
        tipo: proposta.tipo,
        categoria: proposta.categoria,
        valor: Number(proposta.valor),
        descricao: proposta.descricao || null,
        data: proposta.data || new Date().toISOString().slice(0, 10),
        conta_id: achado?.tipo === "conta" ? achado.id : null,
        cartao_id: achado?.tipo === "cartao" ? achado.id : null,
      });
      if (error) throw error;
      setMensagens((m) => m.map((msg, i) => (i === indiceMensagem ? { ...msg, confirmada: true } : msg)));
      onSalvo && onSalvo();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "70vh", background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
        {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, cursor: "pointer", display: "flex" }}><IconChevronLeft size={20} color={C.ink} strokeWidth={2.2} /></button>}
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent} 0%, ${C.navyDeep} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconCosmoFull size={16} color="#fff" strokeWidth={1.9} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>COSMO · Finanças</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>sincronizado com Correa Cash</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 18px", overflowX: "auto" }}>
        {SUGESTOES.map((s) => (
          <button key={s} onClick={() => s === "Anexar comprovante" ? inputArquivo.current?.click() : enviar(s)} style={{ whiteSpace: "nowrap", padding: "7px 12px", borderRadius: 100, border: `1px solid ${C.lineStrong}`, background: "#fff", color: C.ink, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {mensagens.map((m, i) => (
          <Bolha key={i} mensagem={m} onConfirmar={() => confirmarProposta(m.proposta, i)} />
        ))}
        {enviando && <div style={{ fontSize: 12, color: C.inkFaint }}>o COSMO está pensando…</div>}
        {erro && <div style={{ fontSize: 12, color: C.danger }}>{erro}</div>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (texto.trim()) { enviar(texto.trim()); requestAnimationFrame(() => ajustarAltura(areaTexto.current)); } }}
        style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "10px 14px", borderTop: `1px solid ${C.line}` }}
      >
        <input ref={inputArquivo} type="file" accept="image/*" hidden onChange={onEscolherArquivo} />
        <button type="button" onClick={() => inputArquivo.current?.click()} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: C.line, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} title="Anexar foto">
          <IconReceiptScan size={16} color={C.inkMute} strokeWidth={1.9} />
        </button>
        <textarea
          ref={areaTexto}
          value={texto} onChange={aoDigitar} onKeyDown={aoTeclar}
          placeholder="Fale com o COSMO ou anexe um arquivo… (Enter envia, Shift+Enter quebra linha)"
          rows={1}
          style={{ flex: 1, padding: "10px 16px", borderRadius: 18, border: `1px solid ${C.line}`, fontSize: 13.5, fontFamily: "inherit", resize: "none", overflowY: "auto", maxHeight: 120, lineHeight: 1.4 }}
        />
        <button type="submit" disabled={enviando} style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: C.accent, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconSend size={15} color="#fff" strokeWidth={2.1} />
        </button>
      </form>
    </div>
  );
}

function Bolha({ mensagem, onConfirmar }) {
  const deUsuario = mensagem.autor === "usuario";
  return (
    <div style={{ display: "flex", justifyContent: deUsuario ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: 8 }}>
        {mensagem.imagemPreview && <img src={mensagem.imagemPreview} alt="comprovante" style={{ width: 170, borderRadius: 12 }} />}
        {mensagem.texto && (
          <div style={{
            background: deUsuario ? C.accent : "#fff", color: deUsuario ? "#fff" : C.ink,
            border: deUsuario ? "none" : `1px solid ${C.line}`,
            borderRadius: deUsuario ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
            padding: "10px 14px", fontSize: 13, fontWeight: 600, lineHeight: 1.4, whiteSpace: "pre-wrap",
          }}>
            {mensagem.texto}
          </div>
        )}
        {mensagem.proposta && !mensagem.confirmada && <CardProposta proposta={mensagem.proposta} onConfirmar={onConfirmar} />}
        {mensagem.confirmada && <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greenTextAlt }}>✓ Lançado</div>}
      </div>
    </div>
  );
}

function CardProposta({ proposta, onConfirmar }) {
  const info = proposta.tipo === "receita" ? FONTES_RECEITA.find((f) => f.chave === proposta.categoria) : frenteDe(proposta.categoria);
  const cor = proposta.tipo === "receita" ? C.green : C.coral;
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${C.accentSoft}`, borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase" }}>{proposta.tipo === "receita" ? "Receita" : "Gasto"} proposto</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: cor }}>{moeda(proposta.valor)}</span>
      </div>
      <div style={{ height: 1, background: C.line }} />
      {proposta.descricao && <Linha label="Descrição" valor={proposta.descricao} />}
      <Linha label="Categoria" valor={info?.label || proposta.categoria} />
      {proposta.pago_com_nome && <Linha label="Pago com" valor={proposta.pago_com_nome} />}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onConfirmar} style={{ flex: 1, background: C.accent, borderRadius: 10, border: "none", padding: "9px 0", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Confirmar e lançar</button>
      </div>
    </div>
  );
}

function Linha({ label, valor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: C.inkMute }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{valor}</span>
    </div>
  );
}
