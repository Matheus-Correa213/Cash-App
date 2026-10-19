import React, { useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe } from "./theme.js";
import { IconCard, IconCash, IconCreditCard } from "./Icons.jsx";
import Anexos from "./Anexos.jsx";

// Editar um lançamento já existente (gasto OU receita) — pedido do Matheus
// (leva 12, 25/09/2026): "precisamos poder editar os lançamentos, valores e
// onde foram lançados." Reaproveita o mesmo padrão de "editar tudo" das
// migrações 9/10 (EditarConta, EditarCartao, EditarCategoria) e a MESMA regra
// de RLS que já vale pra lançamentos ("lancamentos: dono edita tudo, membro
// edita so o proprio") — nenhuma migração nova foi necessária pra isso, só
// esta tela (ver comentário no fim de supabase-migracao-12).
//
// Usado tanto em Gastos.jsx/Receitas.jsx (lista geral) quanto dentro de
// CartaoDetalhe.jsx (pra corrigir uma parcela específica).
//
// O TIPO (gasto/receita) não é editável aqui de propósito: trocar o tipo de
// um lançamento já feito bagunçaria totais e o casamento categoria+mês do
// Planejamento financeiro; pra "errei o tipo", a orientação é excluir e
// lançar de novo — mesma decisão já tomada pra `tipo`/`chave` de categorias
// (ver comentário no topo de Categorias.jsx).
export default function EditarLancamento({ lancamento, membros, contas, cartoes, frentesGasto, fontesReceita, podeEscolherMembro, onSalvo, onCancelar }) {
  const opcoesCategoria = lancamento.tipo === "receita" ? fontesReceita : frentesGasto;
  const corTipo = lancamento.tipo === "receita" ? C.green : C.coral;

  const [categoria, setCategoria] = useState(lancamento.categoria);
  const [valor, setValor] = useState(String(lancamento.valor ?? ""));
  const [descricao, setDescricao] = useState(lancamento.descricao || "");
  const [data, setData] = useState(lancamento.data);
  const [membroId, setMembroId] = useState(lancamento.membro_id);
  const [pagoCom, setPagoCom] = useState(
    lancamento.cartao_id ? `cartao:${lancamento.cartao_id}` : lancamento.conta_id ? `conta:${lancamento.conta_id}` : ""
  );
  const [tag, setTag] = useState(lancamento.tag || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const [modoPagamento, idPagamento] = pagoCom ? pagoCom.split(":") : [null, null];

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!valor || Number(valor) <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    try {
      // `.select()` no update, de propósito (mesmo motivo de EditarConta/
      // EditarCartao/EditarCategoria): sem isso, um update bloqueado pela RLS
      // (ex: membro restrito tentando editar lançamento de outra pessoa)
      // volta como "sucesso" com 0 linhas, e "Salvar" pareceria ter funcionado
      // sem mudar nada de fato.
      const { data: linhas, error } = await supabase.from("lancamentos").update({
        categoria,
        valor: Number(valor),
        descricao: descricao.trim() || null,
        data,
        conta_id: modoPagamento === "conta" ? idPagamento : null,
        cartao_id: modoPagamento === "cartao" ? idPagamento : null,
        tag: tag.trim() || null,
        ...(podeEscolherMembro ? { membro_id: membroId } : {}),
      }).eq("id", lancamento.id).select();
      if (error) throw error;
      if (!linhas || linhas.length === 0) throw new Error("Esse lançamento não foi atualizado — o banco não confirmou nenhuma alteração.");
      onSalvo && onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ background: C.card, border: `1.5px solid ${corTipo}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {erro && <div style={{ color: C.danger, fontSize: 12.5 }}>{erro}</div>}

      {lancamento.parcela_total > 1 && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.inkFaint }}>
          Parcela {lancamento.parcela_atual}/{lancamento.parcela_total} — editar aqui muda só ESTA parcela, as outras continuam como estavam.
        </div>
      )}

      <div>
        <Label>Valor</Label>
        <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} style={campoValor} />
      </div>

      <div>
        <Label>{lancamento.tipo === "receita" ? "Fonte" : "Frente de gasto"}</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          {opcoesCategoria.map((op) => {
            const IconeOp = op.Icone;
            const ativo = categoria === op.chave;
            return (
              <Chip key={op.chave} ativo={ativo} cor={lancamento.tipo === "receita" ? C.green : op.cor} onClick={() => setCategoria(op.chave)}>
                {op.emoji ? (
                  <span style={{ fontSize: 13, lineHeight: 1 }}>{op.emoji}</span>
                ) : (
                  IconeOp && <IconeOp size={13} color={ativo ? "#fff" : C.inkMute} strokeWidth={2} />
                )}
                {op.label}
              </Chip>
            );
          })}
        </div>
      </div>

      {(contas.length > 0 || cartoes.length > 0) && (
        <div>
          <Label>Pago com</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            <Chip ativo={pagoCom === ""} cor={C.inkMute} onClick={() => setPagoCom("")}>Não informar</Chip>
            {contas.map((c) => {
              const inst = instituicaoDe(c.instituicao || c.nome);
              const ativo = pagoCom === `conta:${c.id}`;
              return (
                <Chip key={`conta:${c.id}`} ativo={ativo} cor={c.tipo === "carteira" ? C.gold : inst.cor} onClick={() => setPagoCom(`conta:${c.id}`)}>
                  {c.tipo === "carteira"
                    ? <IconCash size={13} color={ativo ? "#fff" : C.inkMute} strokeWidth={2} />
                    : <IconCard size={13} color={ativo ? "#fff" : C.inkMute} strokeWidth={2} />}
                  {c.nome}{c.titular ? ` (${c.titular})` : ""}
                </Chip>
              );
            })}
            {lancamento.tipo === "gasto" && cartoes.map((k) => {
              const inst = instituicaoDe(k.bandeira || k.nome);
              const ativo = pagoCom === `cartao:${k.id}`;
              return (
                <Chip key={`cartao:${k.id}`} ativo={ativo} cor={inst.cor} onClick={() => setPagoCom(`cartao:${k.id}`)}>
                  <IconCreditCard size={13} color={ativo ? "#fff" : C.inkMute} strokeWidth={2} />
                  {k.nome}{k.titular ? ` (${k.titular})` : ""}
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={campoInput} placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        <input style={campoInput} type="date" value={data} onChange={(e) => setData(e.target.value)} />
        {podeEscolherMembro && membros && membros.length > 1 && (
          <select style={campoInput} value={membroId} onChange={(e) => setMembroId(e.target.value)}>
            {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        )}
        <input style={campoInput} placeholder="Tag (ex: Casamento)" value={tag} onChange={(e) => setTag(e.target.value)} />
      </div>

      {/* Anexos (migração 18, 19/10/2026): comprovantes em PDF/foto/qualquer
          arquivo, vários de uma vez. Sobem na hora (não dependem do botão
          "Salvar alterações" — o lançamento já existe). */}
      {lancamento.id && lancamento.familia_id && <Anexos lancamentoId={lancamento.id} familiaId={lancamento.familia_id} />}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={salvando} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: corTipo, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
          {salvando ? "Salvando…" : "Salvar alterações"}
        </button>
        <button type="button" onClick={onCancelar} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 13, cursor: "pointer" }}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

const campoInput = { flex: "1 1 140px", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13, boxSizing: "border-box" };
const campoValor = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${C.line}`, fontSize: 18, fontWeight: 800, color: C.ink, marginTop: 4, boxSizing: "border-box" };

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</div>;
}

function Chip({ ativo, cor, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "6px 12px", borderRadius: 100, fontSize: 12, fontWeight: 700, cursor: "pointer",
        border: `1.5px solid ${ativo ? cor : C.line}`,
        background: ativo ? cor : "#fff",
        color: ativo ? "#fff" : C.inkMute,
      }}
    >
      {children}
    </button>
  );
}
