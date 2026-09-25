import React, { useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda, SEM_CATEGORIA } from "./theme.js";
import { resolverIconeCategoria, EMOJI_SUGERIDOS } from "./Icons.jsx";

// Categorias personalizadas — migração 10 ("Criar categorias, isso é
// essencial, temos categorias limitadas", 16/09/2026). As 6 frentes de gasto
// e 4 fontes de receita da doutrina financeira do COSMO (theme.js) continuam
// fixas e não aparecem aqui pra editar/excluir — esta tela é só pras
// categorias que a PRÓPRIA família cria, com nome + cor + ícone escolhidos
// por ela. Disponível pros dois papéis, sem distinção (mesma decisão do
// "editar tudo").
//
// Decisão de design: depois de criada, `tipo` e `chave` de uma categoria não
// mudam mais (só label/cor/icone) — lançamentos já feitos guardam a CHAVE, e
// deixar mudar o tipo depois criaria uma categoria de gasto que na prática
// vira receita (ou vice-versa) pros lançamentos antigos, o que não faz
// sentido nenhum. Pra "trocar de tipo", a família cria uma nova.

const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 12, fontWeight: 800, color: C.inkFaint, marginBottom: 12, letterSpacing: "0.04em", textTransform: "uppercase" };
const input = { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };

// Paleta curada, nas mesmas cores já usadas no resto do app (ver theme.js) —
// pra uma categoria nova nunca destoar visualmente das fixas.
const PALETA_CORES = [
  { cor: "#0469FB", corSoft: "#E7F0FE" },
  { cor: "#7C5CFC", corSoft: "#EFEAFE" },
  { cor: "#1FAE7A", corSoft: "#E7FAF1" },
  { cor: "#FF5A5F", corSoft: "#FFEEEF" },
  { cor: "#F5934B", corSoft: "#FFF1E4" },
  { cor: "#E3A400", corSoft: "#FFF6DA" },
  { cor: "#0EA5A0", corSoft: "#E1F7F6" },
  { cor: "#E85D8A", corSoft: "#FDE9F0" },
  { cor: "#8A05BE", corSoft: "#FDF3FF" },
  { cor: "#5B647A", corSoft: "#EEF0F6" },
];

// Transforma o nome digitado numa chave estável (sem acento, minúscula,
// espaços viram "_") — é essa chave, não o nome, que fica gravada em cada
// lançamento, então precisa ser previsível e nunca mudar depois de criada.
function normalizarChave(nome) {
  return (
    String(nome || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    || "categoria"
  );
}

export default function Categorias({ familiaId, categorias, lancamentos = [], frentesGasto = [], fontesReceita = [], podeEditar = false, familiaInfo, onAtualizado, onVoltar }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);

  const doGasto = categorias.filter((c) => c.tipo === "gasto");
  const doReceita = categorias.filter((c) => c.tipo === "receita");

  async function excluir(c) {
    if (!confirm(`Excluir a categoria "${c.label}"? Lançamentos que já usam ela continuam existindo (só deixam de mostrar cor/ícone bonitos) — ela só some da lista de opções pra novos lançamentos.`)) return;
    const { error } = await supabase.from("categorias").delete().eq("id", c.id);
    if (error) return alert(error.message);
    onAtualizado();
  }

  return (
    <div>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>‹ Voltar</button>}

      <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Categorias</div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 16, lineHeight: 1.5 }}>
        As categorias fixas da doutrina financeira do COSMO (dia a dia, recorrentes, trabalho…) continuam do jeito que são. Aqui vocês dois podem criar quantas categorias próprias quiserem — elas aparecem somadas às fixas em Gastos, Receitas, Novo lançamento e no chat do COSMO.
      </div>

      <PainelCategorizacao
        familiaId={familiaId} familiaInfo={familiaInfo} podeEditar={podeEditar}
        lancamentos={lancamentos} frentesGasto={frentesGasto} fontesReceita={fontesReceita}
        onAtualizado={onAtualizado}
      />

      <div style={cardStyle}>
        <div style={h2}>Categorias de gasto</div>
        {doGasto.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, marginBottom: 10 }}>Nenhuma categoria de gasto personalizada ainda.</div>}
        {doGasto.map((c) => (
          editandoId === c.id
            ? <EditarCategoria key={c.id} categoria={c} onSalvo={() => { setEditandoId(null); onAtualizado(); }} onCancelar={() => setEditandoId(null)} />
            : <ItemCategoria key={c.id} categoria={c} onEditar={() => setEditandoId(c.id)} onExcluir={() => excluir(c)} />
        ))}
      </div>

      <div style={cardStyle}>
        <div style={h2}>Categorias de receita</div>
        {doReceita.length === 0 && <div style={{ color: C.inkFaint, fontSize: 13.5, marginBottom: 10 }}>Nenhuma categoria de receita personalizada ainda.</div>}
        {doReceita.map((c) => (
          editandoId === c.id
            ? <EditarCategoria key={c.id} categoria={c} onSalvo={() => { setEditandoId(null); onAtualizado(); }} onCancelar={() => setEditandoId(null)} />
            : <ItemCategoria key={c.id} categoria={c} onEditar={() => setEditandoId(c.id)} onExcluir={() => excluir(c)} />
        ))}
      </div>

      <div style={cardStyle}>
        {!mostrarForm && <button style={btnGhost} onClick={() => setMostrarForm(true)}>+ Nova categoria</button>}
        {mostrarForm && <NovaCategoria familiaId={familiaId} categorias={categorias} onSalvo={() => { setMostrarForm(false); onAtualizado(); }} onCancelar={() => setMostrarForm(false)} />}
      </div>
    </div>
  );
}

function ItemCategoria({ categoria, onEditar, onExcluir }) {
  const { Icone, emoji } = resolverIconeCategoria(categoria.icone);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: categoria.cor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {emoji ? <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span> : <Icone size={16} color="#fff" strokeWidth={2} />}
      </div>
      <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: C.ink }}>{categoria.label}</div>
      <button style={btnGhost} onClick={onEditar}>editar</button>
      <button style={btnGhost} onClick={onExcluir}>excluir</button>
    </div>
  );
}

// Categorização automática pelo COSMO — leva 12 (25/09/2026), pedido do
// Matheus: "o COSMO deveria ajudar, podendo analisar todos os gastos e
// colocar cada um em sua categoria, comigo podendo ajustar." Resposta dele
// à pergunta de escopo ("automático em lançamentos novos, ou um botão pra
// categorizar os que já existem, ou os dois?"): "Os 2, mas é importante eu
// poder editar essa configuração." Por isso duas peças nesta tela:
//   1) o toggle (só dono, mesma regra de RLS de "familias") que liga/desliga
//      a opção "deixar o COSMO decidir" em Novo lançamento;
//   2) este painel — categoriza em LOTE os lançamentos que já ficaram
//      pendentes (categoria = SEM_CATEGORIA), sempre com revisão antes de
//      gravar (a diferença pro automático de cima é só essa: aqui a pessoa
//      vê e pode trocar cada sugestão antes de confirmar).
function PainelCategorizacao({ familiaId, familiaInfo, podeEditar, lancamentos, frentesGasto, fontesReceita, onAtualizado }) {
  const pendentes = lancamentos.filter((l) => l.categoria === SEM_CATEGORIA);
  const [sugestoes, setSugestoes] = useState(null); // null = ainda não pediu; {} = pedido, um id -> categoria por item
  const [buscando, setBuscando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState("");
  const [salvandoToggle, setSalvandoToggle] = useState(false);

  async function alternarAutomatico(novoValor) {
    setSalvandoToggle(true);
    try {
      // `.select()` no update, de propósito — mesmo cuidado de sempre com
      // "0 linhas afetadas" (aqui seria: alguém sem ser dono tentando mudar,
      // já que a RLS de UPDATE em "familias" é dono-only).
      const { data, error } = await supabase.from("familias").update({ categorizacao_automatica: novoValor }).eq("id", familiaId).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Não consegui salvar — só o administrador da família pode mudar essa configuração.");
      onAtualizado();
    } catch (e) {
      alert(e.message);
    } finally {
      setSalvandoToggle(false);
    }
  }

  async function pedirSugestoes() {
    setBuscando(true); setErro("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada — recarregue a página.");
      const categoriasResumo = {
        gasto: frentesGasto.map((f) => ({ chave: f.chave, label: f.label })),
        receita: fontesReceita.map((f) => ({ chave: f.chave, label: f.label })),
      };
      const resp = await fetch("/api/categorizar-lancamentos", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          lancamentos: pendentes.map((l) => ({ id: l.id, tipo: l.tipo, descricao: l.descricao, valor: l.valor })),
          categoriasResumo,
        }),
      });
      const corpo = await resp.json();
      if (!resp.ok) throw new Error(corpo.error || "Erro ao pedir sugestões ao COSMO.");
      const mapa = {};
      for (const s of corpo.sugestoes || []) mapa[s.id] = s.categoria;
      setSugestoes(mapa);
    } catch (e) {
      setErro(e.message || "Erro ao pedir sugestões.");
    } finally {
      setBuscando(false);
    }
  }

  async function confirmarTudo() {
    setConfirmando(true); setErro("");
    try {
      const tarefas = pendentes
        .filter((l) => sugestoes[l.id])
        .map((l) => supabase.from("lancamentos").update({ categoria: sugestoes[l.id] }).eq("id", l.id).select());
      const resultados = await Promise.all(tarefas);
      const comErro = resultados.find((r) => r.error);
      if (comErro) throw comErro.error;
      setSugestoes(null);
      onAtualizado();
    } catch (e) {
      setErro(e.message || "Erro ao confirmar categorias.");
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div style={cardStyle}>
      <div style={h2}>Categorização automática do COSMO</div>

      {podeEditar ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: C.ink, cursor: "pointer", marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={familiaInfo?.categorizacao_automatica ?? true}
            disabled={salvandoToggle}
            onChange={(e) => alternarAutomatico(e.target.checked)}
          />
          Deixar o COSMO categorizar sozinho quando alguém escolher "deixar o COSMO decidir" num lançamento novo
        </label>
      ) : (
        <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 14 }}>
          {familiaInfo?.categorizacao_automatica ?? true ? "A categorização automática está ligada nesta família." : "A categorização automática está desligada nesta família."} Só o administrador pode mudar isso.
        </div>
      )}

      <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 10, lineHeight: 1.5 }}>
        {pendentes.length === 0
          ? "Nenhum lançamento esperando categoria no momento."
          : `${pendentes.length} lançamento${pendentes.length > 1 ? "s" : ""} aguardando categoria.`}
      </div>

      {erro && <div style={{ color: C.danger, fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}

      {pendentes.length > 0 && sugestoes === null && (
        <button style={btn} onClick={pedirSugestoes} disabled={buscando}>{buscando ? "Pedindo ao COSMO…" : "Categorizar com o COSMO"}</button>
      )}

      {sugestoes !== null && (
        <div>
          {pendentes.map((l) => {
            const opcoes = l.tipo === "receita" ? fontesReceita : frentesGasto;
            const valorEscolhido = sugestoes[l.id] || opcoes[0]?.chave || "";
            return (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.descricao || "(sem descrição)"}</div>
                  <div style={{ fontSize: 11, color: C.inkFaint }}>{l.tipo === "receita" ? "+" : "-"}{moeda(l.valor)} · {l.data}</div>
                </div>
                <select
                  value={valorEscolhido}
                  onChange={(e) => setSugestoes({ ...sugestoes, [l.id]: e.target.value })}
                  style={{ padding: "7px 9px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12.5 }}
                >
                  {opcoes.map((op) => <option key={op.chave} value={op.chave}>{op.label}</option>)}
                </select>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={btn} onClick={confirmarTudo} disabled={confirmando}>{confirmando ? "Confirmando…" : "Confirmar tudo"}</button>
            <button type="button" style={btnGhost} onClick={() => setSugestoes(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SeletorCor({ valor, onEscolher }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {PALETA_CORES.map((p) => (
        <button
          key={p.cor} type="button" onClick={() => onEscolher(p)}
          style={{ width: 30, height: 30, borderRadius: "50%", background: p.cor, border: valor === p.cor ? `3px solid ${C.ink}` : "3px solid transparent", cursor: "pointer", padding: 0 }}
        />
      ))}
    </div>
  );
}

// Substitui a antiga galeria de ícones SVG (migração 12, 25/09/2026) — a
// pessoa digita/cola qualquer emoji no campo (no celular isso já abre o
// teclado de emoji nativo) ou toca numa das sugestões rápidas da grade.
// Categorias criadas ANTES desta leva continuam mostrando o ícone SVG de
// sempre (ver resolverIconeCategoria em Icons.jsx) — isto aqui só afeta o
// que é escolhido DAQUI PRA FRENTE.
function SeletorEmoji({ valor, onEscolher }) {
  // Pega só o primeiro "grapheme" digitado/colado — evita que colar uma
  // frase inteira vire o "emoji" da categoria por engano.
  function aoDigitar(texto) {
    const graphemes = Array.from(texto.trim());
    onEscolher(graphemes.length ? graphemes[0] : "");
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: C.line, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
          {valor || "🙂"}
        </div>
        <input
          style={{ ...input, width: 110, textAlign: "center", fontSize: 20 }}
          placeholder="🙂" value={valor || ""}
          onChange={(e) => aoDigitar(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {EMOJI_SUGERIDOS.map((e) => (
          <button
            key={e} type="button" onClick={() => onEscolher(e)}
            style={{ width: 36, height: 36, borderRadius: 10, background: valor === e ? C.ink : C.line, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipTipo({ ativo, onClick, children }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{ padding: "8px 16px", borderRadius: 100, border: `1.5px solid ${ativo ? C.accent : C.line}`, background: ativo ? C.accent : "#fff", color: ativo ? "#fff" : C.inkMute, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

function NovaCategoria({ familiaId, categorias, onSalvo, onCancelar }) {
  const [tipo, setTipo] = useState("gasto");
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(PALETA_CORES[0]);
  const [icone, setIcone] = useState("⭐");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome pra categoria."); return; }
    setSalvando(true);
    try {
      const base = normalizarChave(nome);
      // Garante uma chave única por família+tipo — se já existe (ex: duas
      // tentativas de "Pet" em gasto), acrescenta um número no final em vez
      // de deixar o banco recusar com um erro cru de restrição única.
      const chavesExistentes = new Set(categorias.filter((c) => c.tipo === tipo).map((c) => c.chave));
      let chave = base, n = 2;
      while (chavesExistentes.has(chave)) { chave = `${base}_${n}`; n++; }

      // `.select()` no insert, de propósito, seguindo o mesmo cuidado do
      // resto do app com "0 linhas afetadas" — aqui uma falha silenciosa é
      // menos provável (RLS bloqueando um INSERT levanta erro, não some
      // sozinho), mas confere mesmo assim por segurança.
      const { data, error } = await supabase.from("categorias").insert({
        familia_id: familiaId, tipo, chave, label: nome.trim(), cor: cor.cor, cor_soft: cor.corSoft, icone,
      }).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("A categoria não foi salva — o banco não confirmou a criação.");
      onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <ChipTipo ativo={tipo === "gasto"} onClick={() => setTipo("gasto")}>Gasto</ChipTipo>
        <ChipTipo ativo={tipo === "receita"} onClick={() => setTipo("receita")}>Receita</ChipTipo>
      </div>
      <input style={input} placeholder="Nome da categoria (ex: Pet, Igreja, Escola)" value={nome} onChange={(e) => setNome(e.target.value)} required />
      <div>
        <div style={{ fontSize: 12, color: C.inkMute, marginBottom: 6 }}>Cor</div>
        <SeletorCor valor={cor.cor} onEscolher={setCor} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: C.inkMute, marginBottom: 6 }}>Emoji</div>
        <SeletorEmoji valor={icone} onEscolher={setIcone} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Criar categoria"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function EditarCategoria({ categoria, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(categoria.label);
  const [cor, setCor] = useState({ cor: categoria.cor, corSoft: categoria.cor_soft });
  const [icone, setIcone] = useState(categoria.icone);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome pra categoria."); return; }
    setSalvando(true);
    try {
      const { data, error } = await supabase.from("categorias").update({
        label: nome.trim(), cor: cor.cor, cor_soft: cor.corSoft, icone,
      }).eq("id", categoria.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(`A categoria "${categoria.label}" não foi atualizada — o banco não confirmou nenhuma alteração.`);
      onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
      {erro && <div style={{ color: C.danger, fontSize: 13 }}>{erro}</div>}
      <input style={input} value={nome} onChange={(e) => setNome(e.target.value)} required />
      <div>
        <div style={{ fontSize: 12, color: C.inkMute, marginBottom: 6 }}>Cor</div>
        <SeletorCor valor={cor.cor} onEscolher={setCor} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: C.inkMute, marginBottom: 6 }}>Emoji</div>
        <SeletorEmoji valor={icone} onEscolher={setIcone} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar alterações"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
