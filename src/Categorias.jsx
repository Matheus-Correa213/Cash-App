import React, { useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, moeda, mesAtualISO, nomeMes, SEM_CATEGORIA } from "./theme.js";
import { PALETA_CORES, normalizarChave, SeletorCor, SeletorEmoji } from "./CategoriaCampos.jsx";
import EditarLancamento from "./EditarLancamento.jsx";
import { IconChevronDown, IconChevronUp } from "./Icons.jsx";

// Categorias personalizadas — migração 10 ("Criar categorias, isso é
// essencial, temos categorias limitadas", 16/09/2026); migração 13 ("poder
// total", 26/09/2026, pedido do Matheus: "Não existe essa de fixas, elas
// devem ser editadas ou excluídas também. Poder total para mim, e o
// COSMO."). As 6 frentes de gasto e 4 fontes de receita da doutrina
// financeira do COSMO (constantes em theme.js, usadas só como fallback
// visual) agora também têm uma linha de verdade na tabela `categorias` pra
// toda família (migração 13) — então esta tela trata TODAS as categorias do
// mesmo jeito, sem distinção de "fixa": qualquer uma pode ser editada ou
// excluída, por qualquer um dos dois papéis (mesma decisão do "editar
// tudo"). O selo "fixa" só aparece como fallback, pra uma família muito
// antiga cujo backfill da migração 13 não tenha rodado ainda.
//
// Decisão de design: depois de criada, `tipo` e `chave` de uma categoria não
// mudam mais (só label/cor/icone) — lançamentos já feitos guardam a CHAVE, e
// deixar mudar o tipo depois criaria uma categoria de gasto que na prática
// vira receita (ou vice-versa) pros lançamentos antigos, o que não faz
// sentido nenhum. Pra "trocar de tipo", a família cria uma nova.
//
// 16ª leva (26/09/2026): Matheus pediu "poder abrir as categorias e ver os
// gastos, poder acessar e mudar um gasto de categoria após acessar ele pela
// aba de categorias" — clicar numa categoria aqui agora expande a lista dos
// lançamentos dela no mês escolhido (mesma filtragem de `!cartao_id` já usada
// em `totalPorCategoria`, pra bater com o total mostrado), e cada lançamento
// tem "editar", que abre o MESMO `EditarLancamento.jsx` já usado em Gastos/
// Receitas/CartaoDetalhe — então mudar a categoria (ou qualquer outro campo)
// direto por aqui grava exatamente igual, sem nenhum caminho novo de escrita
// no banco. Mesma regra de acesso de sempre: quem tem acesso restrito só edita
// os PRÓPRIOS lançamentos (RLS de UPDATE em `lancamentos` já é assim); o botão
// "editar" só aparece quando a pessoa pode mesmo editar aquele lançamento.

const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 12, fontWeight: 800, color: C.inkFaint, marginBottom: 12, letterSpacing: "0.04em", textTransform: "uppercase" };
const input = { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };

export default function Categorias({ familiaId, categorias, lancamentos = [], frentesGasto = [], fontesReceita = [], podeEditar = false, familiaInfo, membro, membros, contas = [], cartoes = [], nomePorMembroId = {}, onAtualizado, onVoltar }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  // Seletor de mês (leva 13, 26/09/2026, pedido do Matheus: "na aba
  // categorias, ter todas, com seus gastos") — mesmo padrão de Gastos/
  // Receitas/Planejamento.
  const [mes, setMes] = useState(mesAtualISO());
  // Ver/editar os lançamentos de uma categoria direto por aqui (16ª leva,
  // 26/09/2026) — `categoriaAberta` guarda a chave composta "tipo:chave" da
  // categoria expandida (null = nenhuma); `editandoLancamentoId` é o
  // lançamento, dentro dela, aberto pra edição no momento.
  const [categoriaAberta, setCategoriaAberta] = useState(null);
  const [editandoLancamentoId, setEditandoLancamentoId] = useState(null);

  // Total lançado em cada categoria no mês escolhido. Mesma separação
  // cartão/conta usada em todo o resto do app desde a leva 12 (compra de
  // cartão só aparece dentro do Cartão em detalhe, nunca somada aqui). A
  // chave do mapa inclui o tipo porque uma categoria de gasto e uma de
  // receita podem, em tese, ter a mesma `chave` (ela só é única dentro do
  // próprio tipo).
  const totalPorCategoria = useMemo(() => {
    const mapa = {};
    for (const l of lancamentos) {
      if (l.data.slice(0, 7) !== mes) continue;
      if (l.tipo === "gasto" && l.cartao_id) continue;
      const k = `${l.tipo}:${l.categoria}`;
      mapa[k] = (mapa[k] || 0) + Number(l.valor);
    }
    return mapa;
  }, [lancamentos, mes]);

  // Mesmo filtro de cima, mas guardando os lançamentos em si (não só a soma)
  // — usado pra expandir uma categoria e mostrar/editar cada um (16ª leva).
  // Ordenados do mais recente pro mais antigo, igual Gastos/Receitas.
  const lancamentosPorCategoria = useMemo(() => {
    const mapa = {};
    for (const l of lancamentos) {
      if (l.data.slice(0, 7) !== mes) continue;
      if (l.tipo === "gasto" && l.cartao_id) continue;
      const k = `${l.tipo}:${l.categoria}`;
      (mapa[k] = mapa[k] || []).push(l);
    }
    for (const k in mapa) mapa[k].sort((a, b) => (a.data < b.data ? 1 : -1));
    return mapa;
  }, [lancamentos, mes]);

  async function excluir(c) {
    if (!confirm(`Excluir a categoria "${c.label}"? Lançamentos que já usam ela continuam existindo (só deixam de mostrar cor/ícone bonitos) — ela só some da lista de opções pra novos lançamentos.`)) return;
    const { error } = await supabase.from("categorias").delete().eq("id", c.id);
    if (error) return alert(error.message);
    onAtualizado();
  }

  return (
    <div>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>‹ Voltar</button>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>Categorias</div>
        <input
          type="month" value={mes} onChange={(e) => setMes(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 9, border: `1.5px solid ${C.line}`, background: "#fff", color: C.ink, fontSize: 12.5, fontWeight: 700 }}
        />
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 16, lineHeight: 1.5 }}>
        Todas as categorias — as da doutrina financeira do COSMO e as que vocês dois criaram — com o total lançado em cada uma em {nomeMes(mes)}. Todas podem ser editadas ou excluídas, por qualquer um dos dois ou pelo COSMO no chat; a opção de criar uma nova também aparece direto ao lançar um gasto ou receita.
      </div>

      <PainelCategorizacao
        familiaId={familiaId} familiaInfo={familiaInfo} podeEditar={podeEditar}
        lancamentos={lancamentos} frentesGasto={frentesGasto} fontesReceita={fontesReceita}
        onAtualizado={onAtualizado}
      />

      <div style={cardStyle}>
        <div style={h2}>Categorias de gasto</div>
        {frentesGasto.map((item) => {
          const chaveComposta = `gasto:${item.chave}`;
          const total = totalPorCategoria[chaveComposta] || 0;
          const bruta = item.personalizada ? categorias.find((c) => c.id === item.id) : null;
          if (editandoId === item.id) {
            return <EditarCategoria key={item.chave} categoria={bruta} onSalvo={() => { setEditandoId(null); onAtualizado(); }} onCancelar={() => setEditandoId(null)} />;
          }
          return (
            <React.Fragment key={item.chave}>
              <ItemCategoria
                item={item} total={total} podeMexer={!!bruta}
                aberta={categoriaAberta === chaveComposta}
                onToggle={() => setCategoriaAberta(categoriaAberta === chaveComposta ? null : chaveComposta)}
                onEditar={() => setEditandoId(item.id)} onExcluir={() => bruta && excluir(bruta)}
              />
              {categoriaAberta === chaveComposta && (
                <ListaLancamentosCategoria
                  lancamentos={lancamentosPorCategoria[chaveComposta] || []}
                  mes={mes} membro={membro} membros={membros} contas={contas} cartoes={cartoes}
                  frentesGasto={frentesGasto} fontesReceita={fontesReceita} nomePorMembroId={nomePorMembroId}
                  editandoLancamentoId={editandoLancamentoId} setEditandoLancamentoId={setEditandoLancamentoId}
                  onAtualizado={onAtualizado}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div style={cardStyle}>
        <div style={h2}>Categorias de receita</div>
        {fontesReceita.map((item) => {
          const chaveComposta = `receita:${item.chave}`;
          const total = totalPorCategoria[chaveComposta] || 0;
          const bruta = item.personalizada ? categorias.find((c) => c.id === item.id) : null;
          if (editandoId === item.id) {
            return <EditarCategoria key={item.chave} categoria={bruta} onSalvo={() => { setEditandoId(null); onAtualizado(); }} onCancelar={() => setEditandoId(null)} />;
          }
          return (
            <React.Fragment key={item.chave}>
              <ItemCategoria
                item={item} total={total} podeMexer={!!bruta}
                aberta={categoriaAberta === chaveComposta}
                onToggle={() => setCategoriaAberta(categoriaAberta === chaveComposta ? null : chaveComposta)}
                onEditar={() => setEditandoId(item.id)} onExcluir={() => bruta && excluir(bruta)}
              />
              {categoriaAberta === chaveComposta && (
                <ListaLancamentosCategoria
                  lancamentos={lancamentosPorCategoria[chaveComposta] || []}
                  mes={mes} membro={membro} membros={membros} contas={contas} cartoes={cartoes}
                  frentesGasto={frentesGasto} fontesReceita={fontesReceita} nomePorMembroId={nomePorMembroId}
                  editandoLancamentoId={editandoLancamentoId} setEditandoLancamentoId={setEditandoLancamentoId}
                  onAtualizado={onAtualizado}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div style={cardStyle}>
        {!mostrarForm && <button style={btnGhost} onClick={() => setMostrarForm(true)}>+ Nova categoria</button>}
        {mostrarForm && <NovaCategoria familiaId={familiaId} categorias={categorias} onSalvo={() => { setMostrarForm(false); onAtualizado(); }} onCancelar={() => setMostrarForm(false)} />}
      </div>
    </div>
  );
}

// `item` já vem pronto de OwnerView.jsx (frentesGasto/fontesReceita
// mesclados) — sempre com `Icone` (componente) OU `emoji` (string)
// resolvido. `podeMexer` é true sempre que existe uma linha de verdade na
// tabela `categorias` pra editar/excluir — desde a migração 13 isso inclui
// as 10 categorias da doutrina também. Só mostra o selo "fixa" no lugar dos
// botões, como último recurso, quando NENHUMA categoria de verdade daquele
// tipo existe ainda (família cujo backfill da migração 13 não rodou, ou o
// extremo de já ter excluído todas as opções daquele tipo).
// A partir da 16ª leva, a linha inteira (menos os botões de editar/excluir A
// CATEGORIA em si) abre/fecha a lista de lançamentos dela no mês — por isso
// `onToggle` fica no `onClick` da div e os botões próprios chamam
// `stopPropagation` pra não expandir/recolher junto por engano.
function ItemCategoria({ item, total, podeMexer, aberta, onToggle, onEditar, onExcluir }) {
  const Icone = item.Icone;
  return (
    <div
      onClick={onToggle}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: aberta ? "none" : `1px solid ${C.line}`, cursor: "pointer" }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 10, background: item.cor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {item.emoji ? <span style={{ fontSize: 16, lineHeight: 1 }}>{item.emoji}</span> : (Icone && <Icone size={16} color="#fff" strokeWidth={2} />)}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{item.label}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{total > 0 ? moeda(total) : "sem lançamentos neste mês"}</div>
      </div>
      {aberta ? <IconChevronUp size={16} color={C.inkFaint} strokeWidth={2} /> : <IconChevronDown size={16} color={C.inkFaint} strokeWidth={2} />}
      {podeMexer ? (
        <>
          <button style={btnGhost} onClick={(e) => { e.stopPropagation(); onEditar(); }}>editar</button>
          <button style={btnGhost} onClick={(e) => { e.stopPropagation(); onExcluir(); }}>excluir</button>
        </>
      ) : (
        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase", letterSpacing: "0.03em" }}>fixa</span>
      )}
    </div>
  );
}

// Lista de lançamentos de uma categoria já expandida (16ª leva, 26/09/2026)
// — clicar numa categoria mostra cada gasto/receita dela no mês escolhido, e
// "editar" abre o MESMO EditarLancamento.jsx de sempre, que já deixa mudar a
// categoria (entre outros campos). Mesma regra de acesso de Gastos/Receitas:
// acesso restrito só edita os PRÓPRIOS lançamentos.
function ListaLancamentosCategoria({ lancamentos, mes, membro, membros, contas, cartoes, frentesGasto, fontesReceita, nomePorMembroId, editandoLancamentoId, setEditandoLancamentoId, onAtualizado }) {
  async function excluirLancamento(id) {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("lancamentos").delete().eq("id", id);
    if (error) return alert(error.message);
    onAtualizado();
  }

  return (
    <div style={{ padding: "2px 0 10px 46px", borderBottom: `1px solid ${C.line}` }}>
      {lancamentos.length === 0 && (
        <div style={{ fontSize: 12, color: C.inkFaint, padding: "8px 0" }}>Nenhum lançamento nesta categoria em {nomeMes(mes)}.</div>
      )}
      {lancamentos.map((l) => {
        // Mesma regra de RLS de sempre: quem tem acesso restrito só
        // edita/exclui os PRÓPRIOS lançamentos (dono sempre pode).
        const podeMexer = !membro || membro.papel === "dono" || l.membro_id === membro.id;

        if (editandoLancamentoId === l.id) {
          return (
            <div key={l.id} style={{ padding: "10px 0" }}>
              <EditarLancamento
                lancamento={l} membros={membros} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita}
                podeEscolherMembro={!membro || membro.papel === "dono"}
                onSalvo={() => { setEditandoLancamentoId(null); onAtualizado(); }}
                onCancelar={() => setEditandoLancamentoId(null)}
              />
            </div>
          );
        }

        return (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.descricao || "(sem descrição)"}</div>
              <div style={{ fontSize: 11, color: C.inkFaint }}>{nomePorMembroId?.[l.membro_id] ? `${nomePorMembroId[l.membro_id]} · ` : ""}{l.data}</div>
            </div>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: l.tipo === "receita" ? C.green : C.coralText }}>{l.tipo === "receita" ? "+" : "-"}{moeda(l.valor)}</span>
            {podeMexer && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setEditandoLancamentoId(l.id)} style={{ border: "none", background: "transparent", color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>editar</button>
                <button onClick={() => excluirLancamento(l.id)} style={{ border: "none", background: "transparent", color: C.inkFaint, fontSize: 12, cursor: "pointer" }}>excluir</button>
              </div>
            )}
          </div>
        );
      })}
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
