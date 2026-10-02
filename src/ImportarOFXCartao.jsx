import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda, mesDaFatura, SEM_CATEGORIA } from "./theme.js";
import { decodificarOFX, lerOFX } from "./ofx.js";
import { conciliarFatura } from "./conciliacaoFatura.js";

// Importar a fatura de um cartão por arquivo OFX — pedido do Matheus
// (02/10/2026): "preciso que o sistema leia arquivos OFX, pra ver como está a
// fatura do cartão e, com isso, poder analisar as parcelas e ter as
// informações precisas do cartão".
//
// A leitura do arquivo e a conciliação são exatas e rodam aqui no navegador
// (ofx.js, conciliacaoFatura.js) — nada de IA nessa parte. Princípio de
// sempre do app: NADA é gravado antes da pessoa ver a prévia e confirmar.
//
// O que a confirmação faz:
//   1) compras novas → lançamentos no cartão (categoria "Categorizando…": o
//      botão "Categorizar com o COSMO" em Categorias classifica de uma vez);
//   2) compras parceladas novas → também as parcelas FUTURAS (opcional), cada
//      uma no mês certo da fatura, pra dar pra folhear/planejar os meses;
//   3) compras que já existiam → só guarda o código do banco (FITID) pra nunca
//      duplicar numa próxima importação; se o valor do banco for outro (juros,
//      IOF), corrige pro valor do banco;
//   4) acertos do cartão que deixam de fazer sentido com as compras reais
//      dentro do app (fatura inicial, limite "preso" em parcelas), cada um com
//      sua caixinha, ligadas por padrão e desligáveis.
//
// Pagamentos de fatura que aparecem no arquivo ("Pagamento recebido") são
// ignorados de propósito: o app controla isso em "Pagar fatura".

const nomeMesLongo = (mes) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};
const dataBR = (iso) => iso.split("-").reverse().join("/");

export default function ImportarOFXCartao({ cartao, membro, onVoltar, onConcluido }) {
  const inputRef = useRef(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [analise, setAnalise] = useState(null); // { ofx, resultado, existentes, mesFatura, totalAppAntes }
  const [marcados, setMarcados] = useState({}); // fitid -> boolean (novas e ajustes)
  const [lancarFuturas, setLancarFuturas] = useState(true);
  const [zerarFaturaInicial, setZerarFaturaInicial] = useState(true);
  const [abaterLimite, setAbaterLimite] = useState(true);
  const [jaPaga, setJaPaga] = useState(false);
  const [lancarCreditos, setLancarCreditos] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState(null);
  // Mensagens de sucesso/erro ficam fora da vista quando a pessoa está lá embaixo
  // (no botão "Importar") — então a tela rola até elas assim que aparecem.
  const sucessoRef = useRef(null);
  const erroRef = useRef(null);
  useEffect(() => {
    if (!erro && !concluido) return;
    const t = setTimeout(() => {
      const el = erro ? erroRef.current : sucessoRef.current;
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, 60);
    return () => clearTimeout(t);
  }, [erro, concluido]);

  const faturaInicial = Number(cartao.fatura_inicial || 0);
  const limiteExtra = Number(cartao.limite_comprometido_extra || 0);

  async function aoEscolher(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setErro(""); setAnalise(null); setConcluido(null); setNomeArquivo(arquivo.name); setLendo(true);
    try {
      const ofx = lerOFX(decodificarOFX(await arquivo.arrayBuffer()));
      if (ofx.transacoes.length === 0) throw new Error("O arquivo não tem nenhuma transação que dê pra importar.");
      if (ofx.tipoConta === "conta") throw new Error("Esse OFX é de uma conta corrente, não de cartão de crédito. Baixe o OFX da FATURA do cartão.");

      const { data: existentes, error } = await supabase
        .from("lancamentos")
        .select("id, valor, data, descricao, parcela_atual, parcela_total, compra_parcelada_id, ofx_fitid, fatura_paga")
        .eq("cartao_id", cartao.id).eq("tipo", "gasto").limit(5000);
      if (error) {
        if (/ofx_fitid/i.test(error.message)) throw new Error("Falta rodar a migração 16 no Supabase (coluna ofx_fitid). Rode o SQL e tente de novo.");
        throw error;
      }
      const resultado = conciliarFatura({ ofx, existentes: existentes || [], novoGrupoId: () => crypto.randomUUID(), diaFechamento: cartao.dia_fechamento });

      // Qual fatura é essa? O mês de fatura do fim do período do arquivo.
      const mesFatura = resultado.mesFatura;
      // "Recente" = a fatura que acabou de fechar ou a atual. Daí em diante
      // (mês anterior ou mais velho) é histórico: provavelmente já foi paga e
      // nada tem a ver com a "fatura inicial" que está no cartão.
      const agora = new Date();
      const mesDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mesAnterior = mesDe(new Date(agora.getFullYear(), agora.getMonth() - 1, 1));
      const recente = mesFatura >= mesAnterior;
      const totalAppAntes = (existentes || [])
        .filter((l) => !l.fatura_paga && mesDaFatura(l.data, cartao.dia_fechamento) === mesFatura)
        .reduce((s, l) => s + Number(l.valor), 0) + (recente ? faturaInicial : 0);

      const marc = {};
      for (const i of resultado.itens) if (i.status === "novo" || i.status === "ajustar") marc[i.fitid] = true;
      setMarcados(marc);
      setLancarFuturas(resultado.totais.nFuturas > 0);
      // Fatura velha (2+ meses atrás): entra como paga, senão apareceria como
      // fatura em aberto/atrasada. A que acabou de fechar entra em aberto —
      // é a que ainda vai ser paga (a pessoa pode trocar na caixinha).
      setJaPaga(!recente);
      setZerarFaturaInicial(recente);
      setAnalise({ ofx, resultado, existentes: existentes || [], mesFatura, totalAppAntes });
    } catch (err) {
      setErro(err.message || "Não consegui ler esse arquivo.");
    } finally {
      setLendo(false);
    }
  }

  async function confirmar() {
    const { resultado } = analise;
    const novos = resultado.itens.filter((i) => i.status === "novo" && marcados[i.fitid]);
    const ajustes = resultado.itens.filter((i) => i.status === "ajustar" && marcados[i.fitid]);
    const casados = resultado.itens.filter((i) => i.status === "ja_lancado" && !i.casouCom.ofx_fitid);
    setSalvando(true); setErro("");
    try {
      const base = { familia_id: membro.familia_id, membro_id: membro.id, tipo: "gasto", categoria: SEM_CATEGORIA, cartao_id: cartao.id };
      // IMPORTANTE: num insert em lote, coluna que falta em UMA linha vira NULL (não o
      // valor padrão da coluna) — e "fatura_paga" não aceita NULL. Foi o que derrubou a
      // 1ª importação real: as parcelas futuras iam sem esse campo e o banco recusava o
      // lote inteiro. Por isso TODA linha sai com TODAS as colunas, sempre.
      const nova = (campos) => ({
        ...base, ofx_fitid: null, fatura_paga: false, parcela_atual: null, parcela_total: null, compra_parcelada_id: null, ...campos,
      });
      const linhas = [];
      let somaFuturas = 0;
      for (const i of novos) {
        linhas.push(nova({
          valor: i.valorAbs, descricao: i.descricao, data: i.dataFinal, ofx_fitid: i.fitid, fatura_paga: jaPaga,
          parcela_atual: i.parcela?.atual ?? null, parcela_total: i.parcela?.total ?? null, compra_parcelada_id: i.parcela ? i.grupoId : null,
        }));
        if (lancarFuturas) {
          for (const f of i.futuras) {
            linhas.push(nova({ valor: f.valor, descricao: f.descricao, data: f.data, parcela_atual: f.atual, parcela_total: f.total, compra_parcelada_id: i.grupoId }));
            somaFuturas += f.valor;
          }
        }
      }
      // Estornos/créditos entram como gasto NEGATIVO (abatem a fatura).
      let nCreditos = 0;
      if (lancarCreditos) {
        for (const c of resultado.creditosNovos) {
          linhas.push(nova({ valor: -c.valorAbs, descricao: c.memo || "Estorno", data: c.data, ofx_fitid: c.fitid, fatura_paga: jaPaga }));
          nCreditos++;
        }
      }
      if (linhas.length) {
        const { data, error } = await supabase.from("lancamentos").insert(linhas).select("id");
        if (error) {
          console.error("Importar OFX — erro do banco:", error);
          throw new Error(/ofx_fitid/i.test(error.message) ? "Falta rodar a migração 16 no Supabase (coluna ofx_fitid)." : `O banco recusou: ${error.message}${error.details ? ` (${error.details})` : ""}`);
        }
        if (!data || data.length !== linhas.length) throw new Error("O banco não confirmou todos os lançamentos — nada foi dado como importado. Tente de novo.");
      }

      // Corrige valor (e carimba o FITID) das parcelas que o banco cobrou diferente.
      let falhas = 0;
      for (const i of ajustes) {
        const { data, error } = await supabase.from("lancamentos").update({ valor: i.valorAbs, ofx_fitid: i.fitid }).eq("id", i.casouCom.id).select("id");
        if (error || !data?.length) falhas++;
      }
      // Carimbar o FITID nos que já existiam é só uma facilidade pra próxima
      // importação — se falhar, não atrapalha (a conciliação por valor/data
      // acha de novo).
      for (const i of casados) {
        await supabase.from("lancamentos").update({ ofx_fitid: i.fitid }).eq("id", i.casouCom.id).select("id");
      }

      // Acertos do cartão. Só mexe no que faz sentido e a pessoa deixou marcado.
      const ajustesCartao = {};
      if (zerarFaturaInicial && faturaInicial > 0) ajustesCartao.fatura_inicial = 0;
      if (abaterLimite && lancarFuturas && limiteExtra > 0 && somaFuturas > 0) ajustesCartao.limite_comprometido_extra = Math.max(0, Math.round((limiteExtra - somaFuturas) * 100) / 100);
      let avisoCartao = "";
      if (Object.keys(ajustesCartao).length) {
        const { data, error } = await supabase.from("cartoes_credito").update(ajustesCartao).eq("id", cartao.id).select("id");
        if (error || !data?.length) avisoCartao = "As compras entraram, mas não consegui atualizar os dados do cartão (fatura inicial / limite preso). Ajuste em 'Editar cartão'.";
      }

      setConcluido({
        mesFatura: analise.mesFatura,
        novas: novos.length, estornos: nCreditos, futuras: lancarFuturas ? novos.reduce((s, i) => s + i.futuras.length, 0) : 0, ajustadas: ajustes.length - falhas,
        falhas, aviso: avisoCartao, ajustesCartao,
      });
      setAnalise(null);
      onConcluido && onConcluido({ mesFatura: analise.mesFatura });
    } catch (err) {
      console.error("Importar OFX:", err);
      setErro(err.message || "Erro ao importar.");
    } finally {
      setSalvando(false);
    }
  }

  const botaoSec = { padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 13, cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>‹ Voltar</button>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>Importar fatura (OFX)</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkMute, marginTop: 4, lineHeight: 1.45 }}>
          No app do banco, abra a fatura do <b>{cartao.nome}</b> e exporte em OFX. O app confere com o que você já lançou e só traz o que falta — nada é gravado antes de você ver e confirmar.
        </div>
        {/* SEM o atributo "accept" de propósito: o celular não conhece a extensão .ofx e,
            com filtro, deixa o arquivo cinza/não selecionável (aconteceu com o OFX do
            Nubank). Quem decide se é OFX é o leitor, que dá erro claro se não for. */}
        <input ref={inputRef} type="file" hidden onChange={aoEscolher} />
        <button
          onClick={() => inputRef.current?.click()} disabled={lendo || salvando}
          style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, border: "none", background: C.purple, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          {lendo ? "Lendo o arquivo…" : analise || concluido ? "Escolher outro arquivo" : "Escolher arquivo OFX"}
        </button>
        {nomeArquivo && <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: C.inkFaint }}>{nomeArquivo}</div>}
        {erro && !analise && <div ref={erroRef} role="alert" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: C.danger }}>{erro}</div>}
      </div>

      {concluido && (
        <div ref={sucessoRef} role="status" style={{ background: C.greenSoft, borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.greenText }}>Fatura importada ✓</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.greenText, marginTop: 6, lineHeight: 1.5 }}>
            {concluido.novas} {concluido.novas === 1 ? "compra nova" : "compras novas"}
            {concluido.estornos > 0 && `, ${concluido.estornos} ${concluido.estornos === 1 ? "estorno" : "estornos"}`}
            {concluido.futuras > 0 && `, ${concluido.futuras} ${concluido.futuras === 1 ? "parcela futura" : "parcelas futuras"}`}
            {concluido.ajustadas > 0 && `, ${concluido.ajustadas} ${concluido.ajustadas === 1 ? "valor corrigido" : "valores corrigidos"}`}.
            {concluido.ajustesCartao?.fatura_inicial === 0 && " Fatura inicial zerada (agora as compras reais estão aqui)."}
            {concluido.ajustesCartao?.limite_comprometido_extra != null && ` Limite preso em parcelas: ${moeda(concluido.ajustesCartao.limite_comprometido_extra)}.`}
          </div>
          {concluido.falhas > 0 && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: C.danger }}>{concluido.falhas} correção(ões) de valor não foram confirmadas pelo banco.</div>}
          {concluido.aviso && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: C.danger }}>{concluido.aviso}</div>}
          {concluido.novas > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: C.greenText }}>
              As compras novas entraram como "Categorizando…". Em Mais → Categorias, o botão "Categorizar com o COSMO" classifica todas de uma vez.
            </div>
          )}
          <button onClick={onVoltar} style={{ marginTop: 12, padding: "11px 16px", borderRadius: 12, border: "none", background: C.purple, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            Ver a fatura no cartão
          </button>
        </div>
      )}

      {analise && <Previa
        analise={analise} cartao={cartao} marcados={marcados} setMarcados={setMarcados}
        lancarFuturas={lancarFuturas} setLancarFuturas={setLancarFuturas}
        zerarFaturaInicial={zerarFaturaInicial} setZerarFaturaInicial={setZerarFaturaInicial}
        abaterLimite={abaterLimite} setAbaterLimite={setAbaterLimite} jaPaga={jaPaga} setJaPaga={setJaPaga} lancarCreditos={lancarCreditos} setLancarCreditos={setLancarCreditos}
        faturaInicial={faturaInicial} limiteExtra={limiteExtra}
        salvando={salvando} erro={erro} erroRef={erroRef} onConfirmar={confirmar} onCancelar={() => { setAnalise(null); setNomeArquivo(""); }} botaoSec={botaoSec}
      />}
    </div>
  );
}

function Previa({ analise, cartao, marcados, setMarcados, lancarFuturas, setLancarFuturas, zerarFaturaInicial, setZerarFaturaInicial, abaterLimite, setAbaterLimite, jaPaga, setJaPaga, lancarCreditos, setLancarCreditos, faturaInicial, limiteExtra, salvando, erro, erroRef, onConfirmar, onCancelar, botaoSec }) {
  const { ofx, resultado, mesFatura, totalAppAntes } = analise;
  const { totais, itens } = resultado;
  const novos = itens.filter((i) => i.status === "novo");
  const ajustes = itens.filter((i) => i.status === "ajustar");
  const jaTem = itens.filter((i) => i.status === "ja_lancado" || i.status === "ja_importado");
  const nCreditosNovos = lancarCreditos ? resultado.creditosNovos.length : 0;
  const nSelecionados = [...novos, ...ajustes].filter((i) => marcados[i.fitid]).length + nCreditosNovos;
  const futurasDosMarcados = novos.filter((i) => marcados[i.fitid]).reduce((s, i) => s + i.futuras.reduce((x, f) => x + f.valor, 0), 0);
  const nFuturasMarcadas = novos.filter((i) => marcados[i.fitid]).reduce((s, i) => s + i.futuras.length, 0);

  // As compras novas caem em quais meses de fatura? Se for mais de um, o dia
  // de fechamento do cartão provavelmente está diferente do real.
  const meses = {};
  for (const i of novos.filter((x) => marcados[x.fitid])) { const m = mesDaFatura(i.dataFinal, cartao.dia_fechamento); meses[m] = (meses[m] || 0) + 1; }
  const mesesFora = Object.keys(meses).filter((m) => m !== mesFatura);

  const alternar = (fitid) => setMarcados((m) => ({ ...m, [fitid]: !m[fitid] }));
  const diferenca = totais.fatura - totalAppAntes;

  return (
    <>
      <div style={{ background: C.purpleSoft, borderRadius: 18, padding: 18 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5B3FD9" }}>
          Fatura de {nomeMesLongo(mesFatura)}{ofx.inicio && ofx.fim ? ` · ${dataBR(ofx.inicio)} a ${dataBR(ofx.fim)}` : ""}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: "#5B3FD9", marginTop: 4 }}>{moeda(totais.fatura)}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#5B3FD9", marginTop: 4 }}>
          {itens.length} compras{totais.creditos > 0 ? ` − estornos ${moeda(totais.creditos)}` : ""} no arquivo
          {ofx.saldo?.valor != null ? ` · saldo informado pelo banco ${moeda(Math.abs(ofx.saldo.valor))}` : ""}
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: Math.abs(diferenca) < 0.01 ? C.greenText : C.amberText }}>
          {Math.abs(diferenca) < 0.01
            ? "O app já está batendo com o banco ✓"
            : `No app essa fatura está em ${moeda(totalAppAntes)} — ${diferenca > 0 ? "faltam" : "sobram"} ${moeda(Math.abs(diferenca))} em relação ao banco.`}
        </div>
      </div>

      {mesesFora.length > 0 && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amberBorder}`, borderRadius: 12, padding: "10px 14px", fontSize: 12, fontWeight: 600, color: C.amberText, lineHeight: 1.45 }}>
          Atenção: {mesesFora.reduce((s, m) => s + meses[m], 0)} compra(s) cairiam em outra fatura ({mesesFora.map(nomeMesLongo).join(", ")}). Isso costuma ser o dia de fechamento do cartão ({cartao.dia_fechamento ? `hoje: dia ${cartao.dia_fechamento}` : "não preenchido"}) diferente do real — confira em "Editar cartão".
        </div>
      )}

      {novos.length > 0 && (
        <Bloco titulo={`Compras novas (${novos.length})`} subtitulo="Ainda não estão no app">
          {novos.map((i) => (
            <Linha key={i.fitid} marcado={!!marcados[i.fitid]} onToggle={() => alternar(i.fitid)} titulo={i.descricao} data={i.dataFinal} valor={i.valorAbs}
              selo={i.parcela ? `${i.parcela.atual}/${i.parcela.total}` : null}
              extra={i.futuras.length > 0 ? `+ ${i.futuras.length} ${i.futuras.length === 1 ? "parcela futura" : "parcelas futuras"} (${moeda(i.futuras.reduce((s, f) => s + f.valor, 0))})` : null} />
          ))}
        </Bloco>
      )}

      {ajustes.length > 0 && (
        <Bloco titulo={`Valor diferente do banco (${ajustes.length})`} subtitulo="Já estavam lançadas, mas o banco cobrou outro valor (juros, IOF…). Marcadas = corrigir pro valor do banco">
          {ajustes.map((i) => (
            <Linha key={i.fitid} marcado={!!marcados[i.fitid]} onToggle={() => alternar(i.fitid)} titulo={i.descricao} data={i.data} valor={i.valorAbs}
              selo={i.parcela ? `${i.parcela.atual}/${i.parcela.total}` : null} extra={`no app: ${moeda(i.casouCom.valor)}`} />
          ))}
        </Bloco>
      )}

      {jaTem.length > 0 && (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.inkMute, padding: "0 4px" }}>
          ✓ {jaTem.length} {jaTem.length === 1 ? "compra já estava" : "compras já estavam"} no app ({moeda(jaTem.reduce((s, i) => s + i.valorAbs, 0))}) — não serão duplicadas.
        </div>
      )}
      {resultado.pagamentos.length > 0 && (
        <div style={{ fontSize: 12, fontWeight: 600, color: C.inkFaint, padding: "0 4px", lineHeight: 1.45 }}>
          Ignorado no arquivo: {resultado.pagamentos.length} pagamento(s) de fatura ({moeda(totais.pagamentos)}) — o app controla isso em "Pagar fatura".
        </div>
      )}
      {ofx.descartadas > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: C.inkFaint, padding: "0 4px" }}>{ofx.descartadas} linha(s) do arquivo sem valor ou data foram ignoradas.</div>}

      {(novos.length > 0 || nFuturasMarcadas > 0 || faturaInicial > 0 || resultado.creditosNovos.length > 0) && (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {novos.length > 0 && (
            <Opcao ativo={jaPaga} onToggle={() => setJaPaga((v) => !v)}
              titulo="Essa fatura já foi paga"
              texto="As compras novas entram como pagas (não aparecem como fatura em aberto). Deixe desmarcado se a fatura ainda vai ser paga." />
          )}
          {resultado.creditosNovos.length > 0 && (
            <Opcao ativo={lancarCreditos} onToggle={() => setLancarCreditos((v) => !v)}
              titulo={`Lançar ${resultado.creditosNovos.length === 1 ? "o estorno" : `os ${resultado.creditosNovos.length} estornos`}/crédito${resultado.creditosNovos.length === 1 ? "" : "s"} (−${moeda(resultado.creditosNovos.reduce((s, c) => s + c.valorAbs, 0))})`}
              texto="Entram como valor negativo no cartão e abatem a fatura — sem isso o total do app ficaria acima do que o banco cobra." />
          )}
          {nFuturasMarcadas > 0 && (
            <Opcao ativo={lancarFuturas} onToggle={() => setLancarFuturas((v) => !v)}
              titulo={`Lançar também as ${nFuturasMarcadas} parcelas futuras (${moeda(futurasDosMarcados)})`}
              texto="Cada uma no seu mês, pra você ver as faturas dos próximos meses e planejar. Quando chegar o OFX do mês seguinte, elas são reconhecidas — não duplicam." />
          )}
          {faturaInicial > 0 && (
            <Opcao ativo={zerarFaturaInicial} onToggle={() => setZerarFaturaInicial((v) => !v)}
              titulo={`Zerar a "fatura inicial" (${moeda(faturaInicial)})`}
              texto="Era um valor que você informou à mão antes de lançar tudo. Com as compras reais da fatura no app, mantê-lo contaria a dívida duas vezes." />
          )}
          {limiteExtra > 0 && nFuturasMarcadas > 0 && lancarFuturas && (
            <Opcao ativo={abaterLimite} onToggle={() => setAbaterLimite((v) => !v)}
              titulo={`Abater do "limite preso em parcelas" (${moeda(limiteExtra)} → ${moeda(Math.max(0, limiteExtra - futurasDosMarcados))})`}
              texto="Esse valor representava parcelas que o app ainda não conhecia. As que você acabou de lançar agora contam por conta própria — sem abater, o limite disponível ficaria menor do que é." />
          )}
        </div>
      )}

      {erro && (
        <div ref={erroRef} role="alert" style={{ background: C.dangerSoft || "#FDECEC", border: `1px solid ${C.danger}`, borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 700, color: C.danger, lineHeight: 1.45 }}>
          Não importei nada. {erro}
          <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600 }}>Pode tentar de novo — nada fica duplicado.</div>
        </div>
      )}
      {(novos.length > 0 || ajustes.length > 0 || resultado.creditosNovos.length > 0) ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onConfirmar} disabled={salvando || nSelecionados === 0}
            style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: nSelecionados === 0 ? C.line : C.purple, color: nSelecionados === 0 ? C.inkFaint : "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            {salvando ? "Importando…" : `Importar ${nSelecionados} ${nSelecionados === 1 ? "item" : "itens"}`}
          </button>
          <button onClick={onCancelar} disabled={salvando} style={botaoSec}>Cancelar</button>
        </div>
      ) : (
        <div style={{ background: C.greenSoft, borderRadius: 14, padding: 14, fontSize: 13, fontWeight: 700, color: C.greenText }}>
          Nada a importar: tudo que está nessa fatura já está no app.
          <div style={{ marginTop: 8 }}><button onClick={onCancelar} style={botaoSec}>Fechar</button></div>
        </div>
      )}
    </>
  );
}

function Bloco({ titulo, subtitulo, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "12px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{titulo}</div>
      {subtitulo && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 2 }}>{subtitulo}</div>}
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Linha({ marcado, onToggle, titulo, data, valor, selo, extra }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
      <input type="checkbox" checked={marcado} onChange={onToggle} style={{ width: 18, height: 18, accentColor: C.purple, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, wordBreak: "break-word" }}>{titulo}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{dataBR(data)}{extra ? ` · ${extra}` : ""}</div>
      </div>
      {selo && <span style={{ background: "#FDF3FF", color: "#8A05BE", borderRadius: 100, padding: "3px 9px", fontSize: 10.5, fontWeight: 700 }}>{selo}</span>}
      <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{moeda(valor)}</span>
    </label>
  );
}

function Opcao({ ativo, onToggle, titulo, texto }) {
  return (
    <label style={{ display: "flex", gap: 10, cursor: "pointer", alignItems: "flex-start" }}>
      <input type="checkbox" checked={ativo} onChange={onToggle} style={{ width: 18, height: 18, accentColor: C.purple, marginTop: 1, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{titulo}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 2, lineHeight: 1.4 }}>{texto}</div>
      </div>
    </label>
  );
}
