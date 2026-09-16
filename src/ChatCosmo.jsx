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
    { autor: "cosmo", texto: "Oi! Posso lançar gastos e receitas, ler comprovantes, ajudar a cadastrar/atualizar contas e cartões, e te dar um resumo rápido. É só me mandar uma mensagem ou uma foto." },
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
      // Manda um resumo das contas/cartões já cadastrados junto — é assim que
      // o COSMO sabe se uma conta que o usuário mencionou já existe (pra
      // ATUALIZAR) ou é nova (pra CRIAR), sem precisar de outra ida ao banco.
      const contasResumo = contas.map((c) => ({ nome: c.nome, tipo: c.tipo, instituicao: c.instituicao, titular: c.titular }));
      const cartoesResumo = cartoes.map((k) => ({ nome: k.nome, bandeira: k.bandeira, titular: k.titular }));
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ mensagem: mensagemTexto || undefined, imagemBase64: imagem?.base64, imagemMimeType: imagem?.mimeType, contasResumo, cartoesResumo }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.error || "Erro ao falar com o COSMO.");
      const propostas = dados.propostas || [];
      setMensagens((m) => [...m, { autor: "cosmo", texto: dados.texto, propostas, confirmadas: propostas.map(() => false) }]);
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

  async function confirmarLancamento(dados) {
    const opcoesPagamento = [...contas.map((c) => ({ tipo: "conta", id: c.id, nome: c.nome })), ...cartoes.map((k) => ({ tipo: "cartao", id: k.id, nome: k.nome }))];
    const achado = dados.pago_com_nome ? opcoesPagamento.find((o) => o.nome.toLowerCase().includes(String(dados.pago_com_nome).toLowerCase())) : null;
    const { error } = await supabase.from("lancamentos").insert({
      familia_id: membro.familia_id,
      membro_id: membro.id,
      tipo: dados.tipo,
      categoria: dados.categoria,
      valor: Number(dados.valor),
      descricao: dados.descricao || null,
      data: dados.data || new Date().toISOString().slice(0, 10),
      conta_id: achado?.tipo === "conta" ? achado.id : null,
      cartao_id: achado?.tipo === "cartao" ? achado.id : null,
    });
    if (error) throw error;
  }

  // Só o dono consegue de fato gravar em contas/cartoes_credito (RLS "dono ve
  // e mexe em tudo") — pra Alessia essa proposta chegaria a dar erro aqui, o
  // que é o comportamento certo, já que só o dono mexe em contas/cartões em
  // qualquer outro lugar do app também.
  async function confirmarContaOuCartao(dados) {
    const acao = dados.acao;
    if (acao === "criar_conta") {
      const { error } = await supabase.from("contas").insert({
        familia_id: membro.familia_id,
        nome: dados.nome,
        tipo: dados.tipo || "outro",
        instituicao: dados.instituicao || null,
        titular: dados.titular || null,
        saldo_inicial: Number(dados.saldo_inicial) || 0,
        visivel_para_restrito: false,
      });
      if (error) throw error;
    } else if (acao === "atualizar_conta") {
      const alvo = contas.find((c) => c.nome.toLowerCase() === String(dados.nome_existente || dados.nome || "").toLowerCase());
      if (!alvo) throw new Error(`Não encontrei uma conta chamada "${dados.nome_existente || dados.nome}".`);
      const patch = {};
      if (dados.nome) patch.nome = dados.nome;
      if (dados.tipo) patch.tipo = dados.tipo;
      if (dados.instituicao !== undefined) patch.instituicao = dados.instituicao || null;
      if (dados.titular !== undefined) patch.titular = dados.titular || null;
      if (dados.saldo_inicial !== undefined && dados.saldo_inicial !== null) patch.saldo_inicial = Number(dados.saldo_inicial);
      const { error } = await supabase.from("contas").update(patch).eq("id", alvo.id);
      if (error) throw error;
    } else if (acao === "criar_cartao") {
      const { error } = await supabase.from("cartoes_credito").insert({
        familia_id: membro.familia_id,
        nome: dados.nome,
        bandeira: dados.bandeira || null,
        titular: dados.titular || null,
        limite: Number(dados.limite) || 0,
        dia_fechamento: dados.dia_fechamento != null ? Number(dados.dia_fechamento) : null,
        dia_vencimento: dados.dia_vencimento != null ? Number(dados.dia_vencimento) : null,
        visivel_para_restrito: false,
      });
      if (error) throw error;
    } else if (acao === "atualizar_cartao") {
      const alvo = cartoes.find((c) => c.nome.toLowerCase() === String(dados.nome_existente || dados.nome || "").toLowerCase());
      if (!alvo) throw new Error(`Não encontrei um cartão chamado "${dados.nome_existente || dados.nome}".`);
      const patch = {};
      if (dados.nome) patch.nome = dados.nome;
      if (dados.bandeira !== undefined) patch.bandeira = dados.bandeira || null;
      if (dados.titular !== undefined) patch.titular = dados.titular || null;
      if (dados.limite !== undefined && dados.limite !== null) patch.limite = Number(dados.limite);
      if (dados.dia_fechamento !== undefined && dados.dia_fechamento !== null) patch.dia_fechamento = Number(dados.dia_fechamento);
      if (dados.dia_vencimento !== undefined && dados.dia_vencimento !== null) patch.dia_vencimento = Number(dados.dia_vencimento);
      const { error } = await supabase.from("cartoes_credito").update(patch).eq("id", alvo.id);
      if (error) throw error;
    } else {
      throw new Error("Ação desconhecida na proposta.");
    }
  }

  async function confirmarItem(indiceMensagem, indiceProposta, proposta) {
    try {
      if (proposta.natureza === "lancamento") await confirmarLancamento(proposta.dados);
      else await confirmarContaOuCartao(proposta.dados);
      setMensagens((m) => m.map((msg, i) => {
        if (i !== indiceMensagem) return msg;
        const confirmadas = msg.confirmadas.slice();
        confirmadas[indiceProposta] = true;
        return { ...msg, confirmadas };
      }));
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
          <Bolha key={i} mensagem={m} onConfirmar={(indiceProposta, proposta) => confirmarItem(i, indiceProposta, proposta)} />
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
  const propostas = mensagem.propostas || [];
  return (
    <div style={{ display: "flex", justifyContent: deUsuario ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: "85%", display: "flex", flexDirection: "column", gap: 8 }}>
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
        {propostas.map((proposta, idx) => (
          mensagem.confirmadas?.[idx]
            ? <div key={idx} style={{ fontSize: 11.5, fontWeight: 700, color: C.greenTextAlt }}>✓ {proposta.natureza === "lancamento" ? "Lançado" : "Salvo"}</div>
            : (proposta.natureza === "lancamento"
              ? <CardProposta key={idx} dados={proposta.dados} onConfirmar={() => onConfirmar(idx, proposta)} />
              : <CardPropostaContaOuCartao key={idx} dados={proposta.dados} onConfirmar={() => onConfirmar(idx, proposta)} />)
        ))}
      </div>
    </div>
  );
}

function CardProposta({ dados, onConfirmar }) {
  const info = dados.tipo === "receita" ? FONTES_RECEITA.find((f) => f.chave === dados.categoria) : frenteDe(dados.categoria);
  const cor = dados.tipo === "receita" ? C.green : C.coral;
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${C.accentSoft}`, borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase" }}>{dados.tipo === "receita" ? "Receita" : "Gasto"} proposto</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: cor }}>{moeda(dados.valor)}</span>
      </div>
      <div style={{ height: 1, background: C.line }} />
      {dados.descricao && <Linha label="Descrição" valor={dados.descricao} />}
      <Linha label="Categoria" valor={info?.label || dados.categoria} />
      {dados.pago_com_nome && <Linha label="Pago com" valor={dados.pago_com_nome} />}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onConfirmar} style={{ flex: 1, background: C.accent, borderRadius: 10, border: "none", padding: "9px 0", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Confirmar e lançar</button>
      </div>
    </div>
  );
}

const ROTULO_ACAO = {
  criar_conta: "Nova conta/carteira",
  atualizar_conta: "Atualizar conta/carteira",
  criar_cartao: "Novo cartão",
  atualizar_cartao: "Atualizar cartão",
};

function CardPropostaContaOuCartao({ dados, onConfirmar }) {
  const ehCartao = dados.acao === "criar_cartao" || dados.acao === "atualizar_cartao";
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${C.accentSoft}`, borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase" }}>{ROTULO_ACAO[dados.acao] || "Proposta"}</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.accent }}>{dados.nome}</span>
      </div>
      <div style={{ height: 1, background: C.line }} />
      {dados.nome_existente && dados.nome_existente !== dados.nome && <Linha label="Conta/cartão" valor={dados.nome_existente} />}
      {dados.titular && <Linha label="Titular" valor={dados.titular} />}
      {!ehCartao && dados.tipo && <Linha label="Tipo" valor={dados.tipo === "carteira" ? "Dinheiro físico" : dados.tipo} />}
      {!ehCartao && dados.instituicao && <Linha label="Instituição" valor={dados.instituicao} />}
      {!ehCartao && dados.saldo_inicial != null && <Linha label="Saldo de hoje" valor={moeda(dados.saldo_inicial)} />}
      {ehCartao && dados.bandeira && <Linha label="Bandeira" valor={dados.bandeira} />}
      {ehCartao && dados.limite != null && <Linha label="Limite" valor={moeda(dados.limite)} />}
      {ehCartao && dados.dia_fechamento != null && <Linha label="Fechamento" valor={`dia ${dados.dia_fechamento}`} />}
      {ehCartao && dados.dia_vencimento != null && <Linha label="Vencimento" valor={`dia ${dados.dia_vencimento}`} />}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onConfirmar} style={{ flex: 1, background: C.accent, borderRadius: 10, border: "none", padding: "9px 0", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Confirmar e salvar</button>
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
