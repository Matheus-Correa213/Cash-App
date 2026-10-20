import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, SEM_CATEGORIA } from "./theme.js";
import { gastosPorCategoria, gastosPorCartao, CHAVE_FATURA } from "./relatorioCalculo.js";

const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: "0.02em" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const input = { padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "9px 14px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "9px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 13.5, cursor: "pointer" };
const lineItem = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` };
const statLabel = { fontSize: 12, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.06em" };
const statBig = { fontSize: 22, fontWeight: 700, color: C.ink };

function moeda(v) { return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`; }
function mesAtualStr() { return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7); } // "YYYY-MM" (horário de Brasília)
function primeiroDiaDoMes(mesStr) { return `${mesStr}-01`; }
function primeiroDiaProximoMes(mesStr) {
  const [ano, mes] = mesStr.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes, 1)); // mes já é 1-based -> vira o mês seguinte
  return d.toISOString().slice(0, 10);
}

const ABAS = [
  ["categorias", "Categorias"],
  ["cartoes", "Cartões"],
  ["entradas-saidas", "Entradas x Saídas"],
  ["contas", "Contas"],
  ["tags", "Tags"],
];

// Relatórios do Correa Cash, em abas — segue o formato descrito no
// MEGA-DOSSIE-COSMO-FINANCEIRO.md ("relatórios em abas: Categorias /
// Entradas x Saídas / Contas / Tags"). As três primeiras abas olham um mês
// por vez (o casal decide o que aconteceu naquele mês); a de Tags é o
// contrário de propósito — um projeto como "Casamento" ou "TCC" atravessa
// vários meses, então ali o total é sempre desde o início.
export default function Relatorios({ familiaId, frentesGasto, onVoltar }) {
  const [aba, setAba] = useState("categorias");
  const [mes, setMes] = useState(mesAtualStr());

  return (
    <div>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 10, padding: 0 }}>‹ Voltar</button>}
      <div style={{ ...row, marginBottom: 4 }}>
        {ABAS.map(([v, l]) => (
          <button key={v} style={aba === v ? btn : btnGhost} onClick={() => setAba(v)}>{l}</button>
        ))}
      </div>

      {aba !== "tags" && (
        <div style={{ margin: "12px 0" }}>
          <label style={{ fontSize: 12.5, color: C.inkMute, marginRight: 8 }}>Mês:</label>
          <input style={input} type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </div>
      )}

      {aba === "categorias" && <RelatorioCategorias familiaId={familiaId} mes={mes} frentesGasto={frentesGasto} />}
      {aba === "cartoes" && <RelatorioCartoes familiaId={familiaId} mes={mes} frentesGasto={frentesGasto} />}
      {aba === "entradas-saidas" && <RelatorioEntradasSaidas familiaId={familiaId} mes={mes} />}
      {aba === "contas" && <RelatorioContas familiaId={familiaId} />}
      {aba === "tags" && <RelatorioTags familiaId={familiaId} />}
    </div>
  );
}

function useLancamentosDoMes(familiaId, mes) {
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true); setErro("");
      try {
        const { data, error } = await supabase
          .from("lancamentos").select("*").eq("familia_id", familiaId)
          .gte("data", primeiroDiaDoMes(mes)).lt("data", primeiroDiaProximoMes(mes))
          .order("data", { ascending: false });
        if (error) throw error;
        if (!cancelado) setLancamentos(data || []);
      } catch (e) {
        if (!cancelado) setErro(e.message || "Erro ao carregar lançamentos do mês.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [familiaId, mes]);

  return { lancamentos, carregando, erro };
}

// Aparência de uma categoria (cor + ícone/emoji), igual ao resto do app. As duas
// chaves "especiais" não existem na tabela de categorias: o pagamento de fatura
// (dinheiro que saiu de conta pra quitar o cartão) e o marcador do COSMO.
function infoCategoria(chave, frentesGasto) {
  if (chave === CHAVE_FATURA) return { chave, label: "Pagamento de fatura", cor: "#8A93A6", corTexto: "#5C6475", corSoft: "#EEF0F6", emoji: "💳", Icone: null };
  if (chave === SEM_CATEGORIA) return { chave, label: "Categorizando…", cor: "#8A05BE", corTexto: "#8A05BE", corSoft: "#FDF3FF", emoji: "🤖", Icone: null };
  return frentesGasto?.find((f) => f.chave === chave) || { chave, label: chave, cor: C.inkMute, corTexto: C.inkMute, corSoft: C.line, emoji: null, Icone: null };
}

function Selo({ f, tamanho = 34 }) {
  const Icone = f.Icone;
  return (
    <div style={{ width: tamanho, height: tamanho, borderRadius: Math.round(tamanho * 0.3), background: f.cor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {f.emoji ? <span style={{ fontSize: Math.round(tamanho * 0.47), lineHeight: 1 }}>{f.emoji}</span> : (Icone && <Icone size={Math.round(tamanho * 0.47)} color="#fff" strokeWidth={2} />)}
    </div>
  );
}

function Barra({ pct, cor }) {
  return (
    <div style={{ height: 6, borderRadius: 100, background: C.line, marginTop: 6 }}>
      <div style={{ width: `${Math.max(2, Math.min(100, pct))}%`, height: "100%", borderRadius: 100, background: cor }} />
    </div>
  );
}

function RelatorioCategorias({ familiaId, mes, frentesGasto }) {
  const { lancamentos, carregando, erro } = useLancamentosDoMes(familiaId, mes);
  const [visao, setVisao] = useState("total"); // "total" (com cartões) | "parcial" (só contas e carteiras)
  const calc = useMemo(() => gastosPorCategoria(lancamentos), [lancamentos]);
  const linhas = useMemo(() => calc.linhas.filter((l) => l[visao] > 0).sort((a, b) => b[visao] - a[visao]), [calc, visao]);
  const totalVisao = visao === "total" ? calc.totalTotal : calc.parcialTotal;
  const maior = linhas.length ? linhas[0][visao] : 0;

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["total", "Total · com cartões"], ["parcial", "Parcial · contas e carteiras"]].map(([v, l]) => (
          <button key={v} onClick={() => setVisao(v)} style={{ ...(visao === v ? btn : btnGhost), flex: 1, padding: "9px 6px", fontSize: 12.5 }}>{l}</button>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={statLabel}>{visao === "total" ? "Gasto total do mês" : "Saiu das contas e carteiras"}</div>
        <div style={{ ...statBig, marginTop: 2 }}>{moeda(totalVisao)}</div>
        <div style={{ fontSize: 12.5, color: C.inkMute, marginTop: 6, lineHeight: 1.5 }}>
          {visao === "total"
            ? <>Contas e carteiras <b>{moeda(calc.contaSemFatura)}</b> + compras no cartão <b>{moeda(calc.cartaoTotal)}</b>. O pagamento de fatura não entra aqui (a compra já foi contada).</>
            : <>Só o dinheiro que saiu de conta/carteira{calc.faturasPagas > 0 ? <>, incluindo <b>{moeda(calc.faturasPagas)}</b> de pagamento de fatura</> : null}. Compras no cartão: <b>{moeda(calc.cartaoTotal)}</b> (só aparecem em Total).</>}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={h2}>GASTOS POR CATEGORIA</div>
        {linhas.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhum gasto neste mês.</div>}
        {linhas.map((l, idx) => {
          const f = infoCategoria(l.chave, frentesGasto);
          const val = l[visao];
          const detalhe = [l.conta > 0 && `conta ${moeda(l.conta)}`, l.cartao > 0 && visao === "total" && `cartão ${moeda(l.cartao)}`].filter(Boolean).join(" · ");
          return (
            <div key={l.chave} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: idx === linhas.length - 1 ? "none" : `1px solid ${C.line}` }}>
              <Selo f={f} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{f.label}</span>
                  <span style={{ fontSize: 13.5, color: C.ink }}><b>{moeda(val)}</b> <span style={{ color: C.inkFaint, fontSize: 11.5 }}>{totalVisao > 0 ? Math.round((val / totalVisao) * 100) : 0}%</span></span>
                </div>
                <Barra pct={maior > 0 ? (val / maior) * 100 : 0} cor={f.cor} />
                {detalhe && <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint, marginTop: 4 }}>{detalhe}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Custo dos cartões no mês: o que foi COMPRADO em cada cartão (pela data da compra),
// quebrado por categoria. Não é a fatura (a fatura fecha em outro dia e desconta
// pagamentos antecipados) — é o quanto o cartão custou de consumo no mês.
function RelatorioCartoes({ familiaId, mes, frentesGasto }) {
  const { lancamentos, carregando, erro } = useLancamentosDoMes(familiaId, mes);
  const [cartoes, setCartoes] = useState([]);
  const [aberto, setAberto] = useState(null);
  useEffect(() => {
    let cancelado = false;
    supabase.from("cartoes_credito").select("id, nome").eq("familia_id", familiaId).order("nome")
      .then(({ data }) => { if (!cancelado) setCartoes(data || []); });
    return () => { cancelado = true; };
  }, [familiaId]);

  const porCartao = useMemo(() => gastosPorCartao(lancamentos), [lancamentos]);
  const lista = useMemo(() => {
    const nome = Object.fromEntries(cartoes.map((c) => [c.id, c.nome]));
    return Object.entries(porCartao).map(([id, x]) => ({ id, nome: nome[id] || "Cartão", ...x })).sort((a, b) => b.total - a.total);
  }, [porCartao, cartoes]);
  const totalGeral = lista.reduce((s, c) => s + c.total, 0);
  const maior = lista.length ? lista[0].total : 0;

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}
      <div style={cardStyle}>
        <div style={statLabel}>Comprado nos cartões no mês</div>
        <div style={{ ...statBig, marginTop: 2 }}>{moeda(totalGeral)}</div>
        <div style={{ fontSize: 12.5, color: C.inkMute, marginTop: 6, lineHeight: 1.5 }}>Pela data da compra. Pagamentos antecipados, estornos e pagamento de fatura não entram.</div>
      </div>
      <div style={cardStyle}>
        <div style={h2}>POR CARTÃO</div>
        {lista.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhuma compra no cartão neste mês.</div>}
        {lista.map((c, idx) => {
          const cats = Object.entries(c.porCategoria).sort((a, b) => b[1] - a[1]);
          const abertoAqui = aberto === c.id;
          return (
            <div key={c.id} style={{ borderBottom: idx === lista.length - 1 ? "none" : `1px solid ${C.line}`, padding: "11px 0" }}>
              <div onClick={() => setAberto(abertoAqui ? null : c.id)} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>💳 {c.nome}</span>
                  <span style={{ fontSize: 14, color: C.ink }}><b>{moeda(c.total)}</b> <span style={{ color: C.inkFaint, fontSize: 11.5 }}>{totalGeral > 0 ? Math.round((c.total / totalGeral) * 100) : 0}%</span></span>
                </div>
                <Barra pct={maior > 0 ? (c.total / maior) * 100 : 0} cor={C.accent} />
                <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint, marginTop: 4 }}>{c.qtd} {c.qtd === 1 ? "compra" : "compras"} · toque para {abertoAqui ? "recolher" : "ver por categoria"}</div>
              </div>
              {abertoAqui && (
                <div style={{ marginTop: 8 }}>
                  {cats.map(([chave, val]) => {
                    const f = infoCategoria(chave, frentesGasto);
                    return (
                      <div key={chave} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                        <Selo f={f} tamanho={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: C.ink }}>
                            <span style={{ fontWeight: 600 }}>{f.label}</span>
                            <span><b>{moeda(val)}</b> <span style={{ color: C.inkFaint, fontSize: 11 }}>{Math.round((val / c.total) * 100)}%</span></span>
                          </div>
                          <Barra pct={(val / cats[0][1]) * 100} cor={f.cor} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelatorioEntradasSaidas({ familiaId, mes }) {
  const { lancamentos, carregando, erro } = useLancamentosDoMes(familiaId, mes);
  const receitas = useMemo(() => lancamentos.filter((l) => l.tipo === "receita"), [lancamentos]);
  const gastos = useMemo(() => lancamentos.filter((l) => l.tipo === "gasto"), [lancamentos]);
  const totalReceitas = receitas.reduce((s, l) => s + Number(l.valor), 0);
  const totalGastos = gastos.reduce((s, l) => s + Number(l.valor), 0);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}
      <div style={row}>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Entradas</div>
          <div style={{ ...statBig, color: C.accent }}>{moeda(totalReceitas)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Saídas</div>
          <div style={{ ...statBig, color: C.danger }}>{moeda(totalGastos)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 140 }}>
          <div style={statLabel}>Saldo</div>
          <div style={{ ...statBig, color: totalReceitas - totalGastos >= 0 ? C.accent : C.danger }}>{moeda(totalReceitas - totalGastos)}</div>
        </div>
      </div>
      <div style={cardStyle}>
        <div style={h2}>LANÇAMENTOS DO MÊS</div>
        {lancamentos.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nada lançado neste mês.</div>}
        {lancamentos.map((l) => (
          <div key={l.id} style={lineItem}>
            <span style={{ fontSize: 14, color: C.ink }}>{l.descricao || l.categoria} <span style={{ color: C.inkFaint, fontSize: 12 }}>· {l.data}</span></span>
            <span style={{ fontSize: 14, fontWeight: 600, color: l.tipo === "gasto" ? C.danger : C.accent }}>{l.tipo === "gasto" ? "-" : "+"}{moeda(l.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelatorioContas({ familiaId }) {
  const [contas, setContas] = useState([]);
  const [saldos, setSaldos] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true); setErro("");
      try {
        const [{ data: c, error: e1 }, { data: s, error: e2 }] = await Promise.all([
          supabase.from("contas").select("*").eq("familia_id", familiaId).order("nome"),
          supabase.rpc("saldos_contas"),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (!cancelado) {
          setContas(c || []);
          setSaldos(Object.fromEntries((s || []).map((r) => [r.conta_id, r.saldo])));
        }
      } catch (e) {
        if (!cancelado) setErro(e.message || "Erro ao carregar contas.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [familiaId]);

  const totalGeral = Object.values(saldos).reduce((s, v) => s + Number(v), 0);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div style={cardStyle}>
      {erro && <div style={{ color: C.danger, marginBottom: 10 }}>{erro}</div>}
      <div style={h2}>SALDO POR CONTA</div>
      {contas.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhuma conta cadastrada ainda.</div>}
      {contas.map((c) => (
        <div key={c.id} style={lineItem}>
          <span style={{ fontSize: 14, color: C.ink }}>{c.nome}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{moeda(saldos[c.id] ?? c.saldo_inicial)}</span>
        </div>
      ))}
      {contas.length > 0 && (
        <div style={{ ...lineItem, borderBottom: "none", marginTop: 4 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Total</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{moeda(totalGeral)}</span>
        </div>
      )}
    </div>
  );
}

function RelatorioTags({ familiaId }) {
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true); setErro("");
      try {
        // Tags são projetos que atravessam meses (ex: "Casamento", "TCC") — por
        // isso aqui é o total desde sempre, sem filtro de mês, diferente das
        // outras abas.
        const { data, error } = await supabase
          .from("lancamentos").select("tipo, valor, tag").eq("familia_id", familiaId)
          .not("tag", "is", null);
        if (error) throw error;
        if (!cancelado) setLancamentos((data || []).filter((l) => l.tag && l.tag.trim() !== ""));
      } catch (e) {
        if (!cancelado) setErro(e.message || "Erro ao carregar tags.");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [familiaId]);

  const porTag = useMemo(() => {
    const m = {};
    for (const l of lancamentos) {
      const t = l.tag.trim();
      m[t] = m[t] || { gastos: 0, receitas: 0 };
      if (l.tipo === "gasto") m[t].gastos += Number(l.valor);
      else m[t].receitas += Number(l.valor);
    }
    return Object.entries(m).sort((a, b) => (b[1].gastos - b[1].receitas) - (a[1].gastos - a[1].receitas));
  }, [lancamentos]);

  if (carregando) return <div style={cardStyle}>Carregando…</div>;
  return (
    <div style={cardStyle}>
      {erro && <div style={{ color: C.danger, marginBottom: 10 }}>{erro}</div>}
      <div style={h2}>POR TAG (TOTAL DESDE SEMPRE)</div>
      {porTag.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Nenhum lançamento com tag ainda. Use tags livres (ex: "Casamento", "TCC") para acompanhar um projeto específico ao lançar um gasto ou receita.</div>}
      {porTag.map(([tag, v]) => (
        <div key={tag} style={lineItem}>
          <span style={{ fontSize: 14, color: C.ink }}>{tag}</span>
          <span style={{ fontSize: 14, color: C.ink }}>
            <span style={{ color: C.danger, fontWeight: 600 }}>-{moeda(v.gastos)}</span>
            {v.receitas > 0 && <span style={{ color: C.accent, fontWeight: 600, marginLeft: 8 }}>+{moeda(v.receitas)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
