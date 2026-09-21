import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe, moeda, somarMeses } from "./theme.js";
import { IconCard, IconCash, IconCreditCard, IconClose } from "./Icons.jsx";

// Lançamento simplificado por toques (chips), com um seletor real de
// conta/cartão (cores por instituição) e, quando o pagamento é num cartão,
// um "parcelar em quantas vezes" que já espalha as parcelas nas faturas
// futuras (criar_compra_parcelada no banco) — exatamente o fluxo desenhado
// no mockup do redesign. Usado tanto pelo dono (com todas as contas/cartões)
// quanto pelo membro restrito (só com o que foi liberado pra ela).
//
// `frentesGasto`/`fontesReceita` (migração 10, categorias personalizadas,
// 16/09/2026): vêm prontos de OwnerView.jsx, já mesclando as categorias
// fixas da doutrina financeira (theme.js) com as que a família criou na
// tela "Categorias" — cada item já chega com um `Icone` (componente,
// resolvido lá) pra este arquivo não precisar saber a diferença entre uma
// categoria fixa e uma personalizada.

// Correção 21/09/2026 (pedido do Matheus: "permita colocar a quantidade, de
// 1 a 15"): antes só dava pra escolher entre um punhado fixo de opções
// (1/2/3/4/6/12x) — quem parcelava em, por exemplo, 5x, 7x ou 9x não
// conseguia. Trocado por um campo numérico livre de 1 a 15 (ver o input mais
// abaixo) — o banco (criar_compra_parcelada) sempre aceitou até 24x, então
// esse número é só o limite que o Matheus pediu pra tela.
const MAX_PARCELAS = 15;

export default function NovoLancamento({ membroLogado, membros, contas, cartoes, frentesGasto, fontesReceita, tipoInicial = "gasto", aberto, onAbrir, onFechar, onSalvo }) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [categoria, setCategoria] = useState(tipo === "receita" ? fontesReceita[0].chave : frentesGasto[0].chave);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [membroId, setMembroId] = useState(membroLogado.id);
  const [pagoCom, setPagoCom] = useState(""); // "" | `conta:<id>` | `cartao:<id>`
  const [parcelas, setParcelas] = useState(1);
  // Correção 21/09/2026 (pedido do Matheus: "nem sempre a parcela é sem
  // juros... permita... escrever como as parcelas ficaram"): antes o app
  // sempre assumia divisão igual e sem juros (valor ÷ parcelas). Esses dois
  // campos deixam a pessoa digitar o valor REAL de cada parcela (o que
  // apareceu na fatura), pra quando a operadora cobra juros no parcelamento
  // — nesse caso `criar_compra_parcelada` usa esse valor em todas as
  // parcelas, em vez de tentar dividir o total original.
  const [parcelaComJuros, setParcelaComJuros] = useState(false);
  const [valorParcelaManual, setValorParcelaManual] = useState("");
  const [tag, setTag] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const opcoesCategoria = tipo === "receita" ? fontesReceita : frentesGasto;
  const corTipo = tipo === "receita" ? C.green : C.coral;

  const [modoPagamento, idPagamento] = pagoCom ? pagoCom.split(":") : [null, null];
  const cartaoEscolhido = modoPagamento === "cartao" ? cartoes.find((c) => c.id === idPagamento) : null;
  const mostrarParcelamento = tipo === "gasto" && !!cartaoEscolhido;

  const valorParcela = useMemo(() => {
    const v = Number(valor);
    if (!v || parcelas <= 1) return null;
    return v / parcelas;
  }, [valor, parcelas]);

  // Some o parcelamento (ex: trocou de "pago com" pra uma conta em vez de
  // cartão) → limpa tudo que só faz sentido com ele, pra não carregar lixo
  // de estado pro próximo lançamento.
  useEffect(() => {
    if (!mostrarParcelamento) {
      setParcelas(1);
      setParcelaComJuros(false);
      setValorParcelaManual("");
    }
  }, [mostrarParcelamento]);

  function trocarTipo(novo) {
    setTipo(novo);
    setCategoria(novo === "receita" ? fontesReceita[0].chave : frentesGasto[0].chave);
    if (novo === "receita") { setPagoCom(""); setParcelas(1); setParcelaComJuros(false); setValorParcelaManual(""); }
  }

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!valor || Number(valor) <= 0) { setErro("Informe um valor válido."); return; }
    if (mostrarParcelamento && parcelas > 1 && parcelaComJuros && (!valorParcelaManual || Number(valorParcelaManual) <= 0)) {
      setErro("Informe o valor de cada parcela, ou desmarque a opção de juros.");
      return;
    }
    setSalvando(true);
    try {
      if (mostrarParcelamento && parcelas > 1) {
        const { error } = await supabase.rpc("criar_compra_parcelada", {
          p_cartao_id: cartaoEscolhido.id,
          p_membro_id: membroId,
          p_categoria: categoria,
          p_descricao: descricao.trim() || null,
          p_valor_total: Number(valor),
          p_parcelas: parcelas,
          p_data_compra: data,
          p_tag: tag.trim() || null,
          // Migração 11 (21/09/2026) — só manda o valor manual quando a
          // pessoa marcou "veio diferente"; do contrário fica `null` e o
          // banco continua dividindo o total igualmente, como sempre.
          p_valor_parcela_manual: parcelaComJuros && valorParcelaManual ? Number(valorParcelaManual) : null,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("lancamentos").insert({
          familia_id: membroLogado.familia_id,
          membro_id: membroId,
          tipo, categoria, valor: Number(valor), descricao: descricao.trim() || null, data,
          conta_id: modoPagamento === "conta" ? idPagamento : null,
          cartao_id: modoPagamento === "cartao" ? idPagamento : null,
          tag: tag.trim() || null,
        });
        if (error) throw error;
      }
      setValor(""); setDescricao(""); setTag(""); setPagoCom(""); setParcelas(1); setParcelaComJuros(false); setValorParcelaManual("");
      onSalvo && onSalvo();
      onFechar && onFechar();
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => onAbrir && onAbrir()}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "14px 0", borderRadius: 16, border: "none", background: corTipo, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        + Novo lançamento
      </button>
    );
  }

  return (
    <form onSubmit={salvar} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <ChipToggle ativo={tipo === "gasto"} cor={C.coral} onClick={() => trocarTipo("gasto")}>Gasto</ChipToggle>
        <ChipToggle ativo={tipo === "receita"} cor={C.green} onClick={() => trocarTipo("receita")}>Receita</ChipToggle>
        <button type="button" onClick={onFechar} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: C.inkFaint, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          fechar <IconClose size={13} color={C.inkFaint} strokeWidth={2.2} />
        </button>
      </div>

      <div>
        <Label>Quanto foi?</Label>
        <input
          autoFocus
          type="number" step="0.01" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)}
          style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1.5px solid ${C.line}`, fontSize: 22, fontWeight: 800, color: C.ink, marginTop: 4 }}
        />
      </div>

      <div>
        <Label>{tipo === "receita" ? "Fonte" : "Frente de gasto"}</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          {opcoesCategoria.map((op) => {
            const IconeOp = op.Icone;
            return (
              <ChipToggle key={op.chave} ativo={categoria === op.chave} cor={tipo === "receita" ? C.green : op.cor} onClick={() => setCategoria(op.chave)}>
                {IconeOp && <IconeOp size={14} color={categoria === op.chave ? "#fff" : C.inkMute} strokeWidth={2} />}
                {op.label}
              </ChipToggle>
            );
          })}
        </div>
      </div>

      {(contas.length > 0 || cartoes.length > 0) && (
        <div>
          <Label>Pago com</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            <ChipToggle ativo={pagoCom === ""} cor={C.inkMute} onClick={() => setPagoCom("")}>Não informar</ChipToggle>
            {contas.map((c) => {
              const inst = instituicaoDe(c.instituicao || c.nome);
              const ativo = pagoCom === `conta:${c.id}`;
              return (
                <ChipToggle key={`conta:${c.id}`} ativo={ativo} cor={c.tipo === "carteira" ? C.gold : inst.cor} onClick={() => setPagoCom(`conta:${c.id}`)}>
                  {c.tipo === "carteira"
                    ? <IconCash size={14} color={ativo ? "#fff" : C.inkMute} strokeWidth={2} />
                    : <IconCard size={14} color={ativo ? "#fff" : C.inkMute} strokeWidth={2} />}
                  {c.nome}{c.titular ? ` (${c.titular})` : ""}
                </ChipToggle>
              );
            })}
            {tipo === "gasto" && cartoes.map((k) => {
              const inst = instituicaoDe(k.bandeira || k.nome);
              const ativo = pagoCom === `cartao:${k.id}`;
              return (
                <ChipToggle key={`cartao:${k.id}`} ativo={ativo} cor={inst.cor} onClick={() => setPagoCom(`cartao:${k.id}`)}>
                  <IconCreditCard size={14} color={ativo ? "#fff" : C.inkMute} strokeWidth={2} />
                  {k.nome}{k.titular ? ` (${k.titular})` : ""}
                </ChipToggle>
              );
            })}
          </div>
        </div>
      )}

      {mostrarParcelamento && (
        <div style={{ background: "#FDF3FF", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Label>Parcelar em quantas vezes?</Label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="number" min={1} max={MAX_PARCELAS} value={parcelas}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                setParcelas(Number.isFinite(n) ? Math.max(1, Math.min(MAX_PARCELAS, n)) : 1);
              }}
              style={{ width: 64, padding: "8px 10px", borderRadius: 10, border: "1.5px solid #8A05BE", fontSize: 15, fontWeight: 800, color: C.ink, textAlign: "center" }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.inkFaint }}>vezes (de 1 a {MAX_PARCELAS})</span>
          </div>

          {parcelas > 1 && (
            <>
              {!parcelaComJuros && valorParcela != null && (
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8A05BE" }}>
                  {parcelas}x de {moeda(valorParcela)} — a última parcela cai em {new Date(somarMeses(data, parcelas - 1) + "T00:00:00Z").toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}.
                </div>
              )}

              {/* Pedido do Matheus (21/09/2026): "nem sempre a parcela é sem
                  juros" — quando a operadora cobra juros, o valor de cada
                  parcela na fatura é maior do que a divisão simples do
                  total. Esta opção deixa digitar o valor real. */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: C.inkMute, cursor: "pointer" }}>
                <input type="checkbox" checked={parcelaComJuros} onChange={(e) => { setParcelaComJuros(e.target.checked); if (!e.target.checked) setValorParcelaManual(""); }} />
                O valor de cada parcela veio diferente (ex: juros da operadora)
              </label>

              {parcelaComJuros && (
                <div>
                  <Label>Valor de cada parcela (o que apareceu/vai aparecer na fatura)</Label>
                  <input
                    type="number" step="0.01" placeholder="0,00" value={valorParcelaManual}
                    onChange={(e) => setValorParcelaManual(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #8A05BE", fontSize: 15, fontWeight: 800, color: C.ink, marginTop: 4 }}
                  />
                  {Number(valorParcelaManual) > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#8A05BE", marginTop: 6 }}>
                      {parcelas}x de {moeda(Number(valorParcelaManual))} = {moeda(Number(valorParcelaManual) * parcelas)} no total (a compra em si foi de {moeda(Number(valor) || 0)}).
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={campoInput} placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        <input style={campoInput} type="date" value={data} onChange={(e) => setData(e.target.value)} />
        {membros && membros.length > 1 && (
          <select style={campoInput} value={membroId} onChange={(e) => setMembroId(e.target.value)}>
            {membros.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        )}
        <input style={campoInput} placeholder="Tag (ex: Casamento)" value={tag} onChange={(e) => setTag(e.target.value)} />
      </div>

      <button type="submit" disabled={salvando} style={{ padding: "13px 0", borderRadius: 12, border: "none", background: corTipo, color: "#fff", fontSize: 14.5, fontWeight: 800, cursor: "pointer" }}>
        {salvando ? "Salvando…" : "Lançar"}
      </button>
    </form>
  );
}

const campoInput = { flex: "1 1 140px", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 13.5 };

function Label({ children }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</div>;
}

function ChipToggle({ ativo, cor, onClick, children, type = "button" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 14px", borderRadius: 100, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
        border: `1.5px solid ${ativo ? cor : C.line}`,
        background: ativo ? cor : "#fff",
        color: ativo ? "#fff" : C.inkMute,
        transition: "all 0.12s ease",
      }}
    >
      {children}
    </button>
  );
}
