import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, frenteDe, fonteDe } from "./theme.js";
import NovoLancamento from "./NovoLancamento.jsx";
import { ICONE_FRENTE_GASTO, ICONE_FONTE_RECEITA } from "./Icons.jsx";

const wrap = { padding: 18, maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 };
const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 };
const h2 = { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 12, letterSpacing: "0.02em" };
const row = { display: "flex", gap: 10, flexWrap: "wrap" };
const statBig = { fontSize: 26, fontWeight: 700, color: C.ink };
const statLabel = { fontSize: 12, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.06em" };
const lineItem = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` };

function moeda(v) { return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`; }
function inicioMesISO() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

export default function MemberView({ membro }) {
  const [lancamentos, setLancamentos] = useState([]);
  const [contas, setContas] = useState([]);
  const [cartoes, setCartoes] = useState([]);
  const [resumoFamilia, setResumoFamilia] = useState(null);
  const [resumoCategorias, setResumoCategorias] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [lancamentoAberto, setLancamentoAberto] = useState(false);

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const { data: lanc, error: e1 } = await supabase
        .from("lancamentos").select("*").eq("membro_id", membro.id)
        .order("data", { ascending: false }).limit(100);
      if (e1) throw e1;
      setLancamentos(lanc || []);

      // Ela só enxerga as contas/cartões que o Matheus deixou explicitamente
      // visíveis (políticas "membro ve as marcadas como visiveis" no banco,
      // via RLS) — é o mesmo seletor "pago com" do NovoLancamento.jsx que o
      // dono usa, só que a lista que chega já vem filtrada pelo próprio banco.
      const [{ data: cts }, { data: crt }] = await Promise.all([
        supabase.from("contas").select("id, nome, tipo, instituicao, titular").eq("familia_id", membro.familia_id),
        supabase.from("cartoes_credito").select("id, nome, bandeira, titular").eq("familia_id", membro.familia_id),
      ]);
      setContas(cts || []);
      setCartoes(crt || []);

      if (membro.permissoes?.ver_saldo_geral) {
        const { data: r1 } = await supabase.rpc("resumo_familia_do_membro");
        setResumoFamilia(r1 || null);
      }
      if (membro.permissoes?.ver_resumo_categorias) {
        const { data: r2 } = await supabase.rpc("resumo_categorias_do_membro");
        setResumoCategorias(r2 || null);
      }
    } catch (e) {
      setErro(e.message || "Erro ao carregar seus dados.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  const doMes = useMemo(() => lancamentos.filter((l) => l.data >= inicioMesISO()), [lancamentos]);
  const gastoDoMes = useMemo(() => doMes.filter((l) => l.tipo === "gasto").reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const mesada = Number(membro.mesada_mensal || 0);
  const restante = mesada - gastoDoMes;

  return (
    <div style={wrap}>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}

      <div style={row}>
        <div style={{ ...cardStyle, flex: 1, minWidth: 130 }}>
          <div style={statLabel}>Sua mesada</div>
          <div style={statBig}>{moeda(mesada)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 130 }}>
          <div style={statLabel}>Já gastou</div>
          <div style={statBig}>{moeda(gastoDoMes)}</div>
        </div>
        <div style={{ ...cardStyle, flex: 1, minWidth: 130 }}>
          <div style={statLabel}>Sobra</div>
          <div style={{ ...statBig, color: restante >= 0 ? C.accent : C.danger }}>{moeda(restante)}</div>
        </div>
      </div>

      {resumoFamilia?.permitido && (
        <div style={cardStyle}>
          <div style={h2}>SALDO GERAL DA FAMÍLIA (MÊS)</div>
          <div style={row}>
            <div style={{ flex: 1 }}><div style={statLabel}>Gastos</div><div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{moeda(resumoFamilia.total_gastos)}</div></div>
            <div style={{ flex: 1 }}><div style={statLabel}>Receitas</div><div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{moeda(resumoFamilia.total_receitas)}</div></div>
            <div style={{ flex: 1 }}><div style={statLabel}>Saldo</div><div style={{ fontSize: 18, fontWeight: 700, color: resumoFamilia.saldo >= 0 ? C.accent : C.danger }}>{moeda(resumoFamilia.saldo)}</div></div>
          </div>
        </div>
      )}

      {resumoCategorias?.permitido && Object.keys(resumoCategorias.categorias || {}).length > 0 && (
        <div style={cardStyle}>
          <div style={h2}>GASTOS DA FAMÍLIA POR CATEGORIA (MÊS)</div>
          {Object.entries(resumoCategorias.categorias).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
            <div key={cat} style={lineItem}>
              <span style={{ fontSize: 14, color: C.ink, textTransform: "capitalize" }}>{cat}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{moeda(val)}</span>
            </div>
          ))}
        </div>
      )}

      <NovoLancamento
        membroLogado={membro} contas={contas} cartoes={cartoes} tipoInicial="gasto"
        aberto={lancamentoAberto} onAbrir={() => setLancamentoAberto(true)} onFechar={() => setLancamentoAberto(false)} onSalvo={() => { setLancamentoAberto(false); carregar(); }}
      />

      <div style={cardStyle}>
        <div style={h2}>SEUS LANÇAMENTOS</div>
        {carregando && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Carregando…</div>}
        {!carregando && lancamentos.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Você ainda não lançou nada.</div>}
        {lancamentos.slice(0, 30).map((l) => {
          const info = l.tipo === "receita" ? fonteDe(l.categoria) : frenteDe(l.categoria);
          const Icone = (l.tipo === "receita" ? ICONE_FONTE_RECEITA : ICONE_FRENTE_GASTO)[l.categoria];
          return (
          <div key={l.id} style={{ ...lineItem, gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: info.corSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {Icone && <Icone size={15} color={info.cor} strokeWidth={1.9} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: C.ink }}>{l.descricao || info.label} <span style={{ color: C.inkFaint, fontSize: 12 }}>· {l.data}</span></div>
              <div style={{ fontSize: 12, color: C.inkFaint }}>{info.label}</div>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: l.tipo === "gasto" ? C.danger : C.accent }}>{l.tipo === "gasto" ? "-" : "+"}{moeda(l.valor)}</span>
          </div>
          );
        })}
      </div>
    </div>
  );
}
