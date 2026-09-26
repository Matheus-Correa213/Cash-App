import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, FRENTES_GASTO, FONTES_RECEITA } from "./theme.js";
import Painel from "./Painel.jsx";
import Receitas from "./Receitas.jsx";
import Gastos from "./Gastos.jsx";
import ContasCartoes from "./ContasCartoes.jsx";
import CartaoDetalhe from "./CartaoDetalhe.jsx";
import Investimentos from "./Investimentos.jsx";
import Relatorios from "./Relatorios.jsx";
import Assinaturas from "./Assinaturas.jsx";
import ChatCosmo from "./ChatCosmo.jsx";
import ImportarArquivo from "./ImportarArquivo.jsx";
import Categorias from "./Categorias.jsx";
import Planejamento from "./Planejamento.jsx";
import { IconHomeNav, IconArrowUp, IconArrowDown, IconGrid, IconCard, IconRefresh, IconTrendingUp, IconBarChart, IconCosmo, IconUpload, IconChevronRight, IconUsers, IconStar, IconCalendar, ICONE_FRENTE_GASTO, ICONE_FONTE_RECEITA, resolverIconeCategoria } from "./Icons.jsx";

const wrap = { padding: 18, maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 90 };
const cardStyle = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 };
const input = { flex: "1 1 120px", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14 };
const btn = { padding: "10px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const btnGhost = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 12.5, cursor: "pointer" };

// A navegação de baixo tem só 4 abas fixas (Painel/Receitas/Gastos/Mais),
// exatamente como no mockup do redesign. Tudo o que não coube nas 4 abas
// (Contas, Cartão em detalhe, Investimentos, Relatórios, Assinaturas, Chat,
// Importar, Membros) é alcançado pelos atalhos do Painel ou pelo menu "Mais",
// e fica guardado num "tela" à parte pra poder empilhar (ex: entrar num
// cartão específico a partir de Contas).
const ABAS_PRINCIPAIS = [
  { chave: "painel", label: "Painel", Icone: IconHomeNav },
  { chave: "receitas", label: "Receitas", Icone: IconArrowUp },
  { chave: "gastos", label: "Gastos", Icone: IconArrowDown },
  { chave: "mais", label: "Mais", Icone: IconGrid },
];

// Correção 16/09/2026 (unificação do acesso da Alessia): este componente
// era só do dono — agora é a casca inteira do app (Painel/Receitas/Gastos/
// Mais), compartilhada por qualquer papel. `podeEditar` (= é dono) decide,
// tela por tela dentro de "Mais", se aparecem os botões de
// cadastrar/editar/excluir/pagar fatura — o dado em si continua vindo do
// banco já filtrado pelo RLS (RLS é quem decide o que cada um VÊ; isto aqui
// só decide o que cada um consegue MEXER na interface, pra não deixar
// ninguém clicar num botão que ia dar erro do banco).
//
// Atualização 16/09/2026 (migração 10, "editar tudo"): contas e cartões
// saíram dessa regra — o Matheus pediu explicitamente que os dois papéis
// editem/criem/excluam contas e cartões sem distinção, então ContasCartoes
// e a edição de cartão em CartaoDetalhe não recebem mais `podeEditar` (só
// "Pagar fatura atual" continua exclusivo do dono, por mexer com dinheiro
// de verdade). Investimentos, Assinaturas e Membros continuam do jeito que
// estavam — não fizeram parte do pedido.
export default function OwnerView({ membro, onMembroAtualizado }) {
  const podeEditar = membro.papel === "dono";
  const [lancamentos, setLancamentos] = useState([]);
  const [membros, setMembros] = useState([]);
  const [contas, setContas] = useState([]);
  const [cartoes, setCartoes] = useState([]);
  const [assinaturas, setAssinaturas] = useState([]);
  const [investimentos, setInvestimentos] = useState([]);
  // Categorias personalizadas (migração 10, 16/09/2026) — criadas pela
  // própria família na tela "Categorias", somadas às fixas da doutrina
  // financeira (FRENTES_GASTO/FONTES_RECEITA) logo abaixo, em frentesGasto/
  // fontesReceita.
  const [categorias, setCategorias] = useState([]);
  // Planejamento financeiro (migração 12, 25/09/2026) — "lembrete de
  // boletos" pedido pelo Matheus, ver Planejamento.jsx pro raciocínio
  // completo de como o "pago" é calculado (nunca gravado).
  const [planejamentoItens, setPlanejamentoItens] = useState([]);
  // Categorização automática pelo COSMO (migração 12, 25/09/2026) — o
  // registro da própria família (só a coluna categorizacao_automatica
  // interessa aqui; RLS de UPDATE em "familias" já é dono-only, então o
  // toggle em Categorias.jsx só aparece pra quem pode mesmo mudar isso).
  const [familiaInfo, setFamiliaInfo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("painel");
  const [tela, setTela] = useState(null); // ex: "contas" | "cartao:<id>" | "investimentos" | "relatorios" | "assinaturas" | "chat" | "importar" | "membros" | "categorias" | "planejamento"
  // "Lançar agora" dentro de Planejamento.jsx: em vez de criar o lançamento
  // a partir da tela de planejamento (decisão explícita do Matheus: "eu iria
  // lançar o pagamento e na aba de planejamento, ele iria identificar e
  // marcar"), isso só leva a pessoa pra Gastos com o formulário de novo
  // lançamento já aberto e pré-preenchido (categoria + valor, quando fixo) —
  // ela confirma/ajusta e lança do jeito de sempre.
  const [presetLancamento, setPresetLancamento] = useState(null);

  // `silencioso=true` é pra recarregar depois de uma ação (confirmar um
  // lançamento no chat, editar permissões, etc) SEM esconder a tela atual
  // atrás do "Carregando…" — isso era um bug real: toda vez que algo chamava
  // carregarTudo(), o `carregando=true` fazia esse componente inteiro trocar
  // pra tela de loading e voltar do zero depois, o que desmontava (e
  // resetava) qualquer estado local da aba aberta — no ChatCosmo isso
  // aparecia como "confirmei e a conversa inteira sumiu, voltou do zero".
  // Só a primeira carga (no useEffect abaixo) passa por essa tela cheia.
  async function carregarTudo({ silencioso } = {}) {
    if (!silencioso) setCarregando(true);
    setErro("");
    try {
      const [{ data: lanc, error: e1 }, { data: memb, error: e2 }, { data: cts, error: e3 }, { data: crt, error: e4 }, { data: assn, error: e5 }, { data: inv, error: e6 }, { data: cats, error: e7 }, { data: planj, error: e8 }, { data: fam, error: e9 }] = await Promise.all([
        supabase.from("lancamentos").select("*").order("data", { ascending: false }).order("created_at", { ascending: false }).limit(300),
        supabase.from("membros").select("*").eq("familia_id", membro.familia_id).order("papel", { ascending: false }),
        supabase.from("contas").select("*").eq("familia_id", membro.familia_id).order("nome"),
        supabase.from("cartoes_credito").select("*").eq("familia_id", membro.familia_id).order("nome"),
        supabase.from("assinaturas").select("*").eq("familia_id", membro.familia_id).order("dia_cobranca"),
        supabase.from("investimentos").select("*").eq("familia_id", membro.familia_id),
        supabase.from("categorias").select("*").eq("familia_id", membro.familia_id).order("created_at"),
        supabase.from("planejamento_itens").select("*").eq("familia_id", membro.familia_id).order("created_at"),
        supabase.from("familias").select("*").eq("id", membro.familia_id).single(),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (e3) throw e3;
      if (e4) throw e4;
      if (e5) throw e5;
      if (e6) throw e6;
      // categorias (migração 10) e planejamento_itens (migração 12) são
      // tabelas novas — se o banco do Matheus ainda não rodou essas
      // migrações, e7/e8 vêm preenchidos (tabela não existe); em vez de
      // travar o app inteiro, só loga e segue com a lista vazia. e9
      // (familias.categorizacao_automatica) é só uma coluna nova numa tabela
      // que já existia — se a migração 12 ainda não rodou, a coluna não
      // existe e este select falha inteiro; mesma lógica, só loga e segue
      // (a opção "deixar o COSMO decidir" simplesmente não aparece até a
      // migração rodar).
      if (e7) console.error("Não consegui carregar categorias personalizadas (rodou a migração 10?):", e7.message);
      if (e8) console.error("Não consegui carregar o planejamento financeiro (rodou a migração 12?):", e8.message);
      if (e9) console.error("Não consegui carregar as configurações da família (rodou a migração 12?):", e9.message);
      setLancamentos(lanc || []);
      setMembros(memb || []);
      setContas(cts || []);
      setCartoes(crt || []);
      setAssinaturas(assn || []);
      setInvestimentos(inv || []);
      setCategorias(cats || []);
      setPlanejamentoItens(planj || []);
      setFamiliaInfo(fam || null);
    } catch (e) {
      setErro(e.message || "Erro ao carregar dados.");
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  useEffect(() => { carregarTudo(); }, []);

  const nomePorMembroId = useMemo(() => Object.fromEntries(membros.map((m) => [m.id, m.nome])), [membros]);

  // frentesGasto/fontesReceita (migração 10, categorias personalizadas,
  // 16/09/2026; migração 13, "poder total", 26/09/2026, pedido do Matheus:
  // "Não existe essa de fixas, elas devem ser editadas ou excluídas também.
  // Poder total para mim, e o COSMO."): agora que a migração 13 seeda as 10
  // categorias da doutrina financeira do COSMO como linhas DE VERDADE na
  // tabela `categorias` (pra toda família, novas e antigas), essas listas
  // passam a confiar 100% na tabela — nada de mesclar com as constantes
  // hard-coded FRENTES_GASTO/FONTES_RECEITA (theme.js) por cima. Isso é o que
  // torna a exclusão REAL: excluir uma dessas categorias faz ela sumir da
  // lista de vez, exatamente como já acontecia com qualquer personalizada —
  // os lançamentos antigos que usam a chave excluída continuam existindo, só
  // caem no mesmo "rótulo cru + cor cinza" que Gastos/Receitas/Planejamento
  // já usam pra qualquer chave que não bate com nada na lista (nada novo:
  // sempre foi assim pra uma personalizada excluída).
  //
  // As constantes de theme.js só entram como ÚLTIMO RECURSO — se não existir
  // NENHUMA categoria de verdade daquele tipo (família ainda não rodou a
  // migração 13, ou o extremo de excluir todas as opções de um tipo) — pra
  // nunca deixar o seletor de categoria de Novo lançamento completamente
  // vazio. Assim que existir QUALQUER linha real daquele tipo, esse
  // fallback não entra mais.
  const frentesGasto = useMemo(() => {
    const reais = categorias.filter((c) => c.tipo === "gasto").map((c) => ({
      chave: c.chave, label: c.label, cor: c.cor, corSoft: c.cor_soft, corTexto: c.cor,
      ...resolverIconeCategoria(c.icone),
      personalizada: true, id: c.id,
    }));
    if (reais.length > 0) return reais;
    return FRENTES_GASTO.map((f) => ({ ...f, Icone: ICONE_FRENTE_GASTO[f.chave] || IconStar, emoji: null, personalizada: false, id: null }));
  }, [categorias]);

  const fontesReceita = useMemo(() => {
    const reais = categorias.filter((c) => c.tipo === "receita").map((c) => ({
      chave: c.chave, label: c.label, cor: c.cor, corSoft: c.cor_soft,
      ...resolverIconeCategoria(c.icone),
      personalizada: true, id: c.id,
    }));
    if (reais.length > 0) return reais;
    return FONTES_RECEITA.map((f) => ({ ...f, Icone: ICONE_FONTE_RECEITA[f.chave] || IconStar, emoji: null, personalizada: false, id: null }));
  }, [categorias]);

  // O seletor "lançar em nome de outro membro" (dentro de NovoLancamento) só
  // faz sentido pro dono — a política de RLS de INSERT em "lancamentos" só
  // deixa quem tem acesso restrito lançar em NOME PRÓPRIO (membro_id =
  // meu_membro_id()); se ela escolhesse outro nome nesse seletor, o
  // lançamento seria recusado pelo banco com um erro cru. Passar
  // `undefined` aqui esconde o seletor pra ela, do mesmo jeito que o
  // MemberView de antes nunca passava essa lista.
  const membrosParaLancar = podeEditar ? membros : undefined;
  // Default true por segurança (bate com o default da coluna no banco,
  // migração 12) enquanto familiaInfo ainda não carregou ou se a migração
  // ainda não rodou nesta instalação.
  const categorizacaoAutomatica = familiaInfo?.categorizacao_automatica ?? true;

  // Chamado por Planejamento.jsx quando a pessoa toca em "lançar agora" num
  // item ainda em aberto — só preenche o formulário, não lança nada sozinho
  // (ver comentário no state `presetLancamento` acima).
  function lancarAgoraDoPlanejamento(item) {
    setPresetLancamento({ categoria: item.categoria, valor: item.tipo_valor === "fixo" ? item.valor_fixo : "" });
    setAba("gastos");
    setTela(null);
  }

  function irPara(destino) {
    if (destino === "painel" || destino === "receitas" || destino === "gastos") {
      setAba(destino); setTela(null);
    } else {
      setAba("mais"); setTela(destino);
    }
  }

  function abrirAba(nomeAba) {
    // Correção 21/09/2026 (falta de "voltar" dentro de "Mais"): antes, tocar
    // de novo em "Mais" enquanto já se estava dentro de um sub-tela (ex:
    // Relatórios) não fazia nada — `nomeAba` já era "mais", então o `if`
    // abaixo nunca resetava `tela`, e a pessoa ficava presa lá (mesmo esse
    // reset sozinho já ajudava: tocar em "Mais" de novo agora volta pro
    // menu). Isso complementa o `onVoltar` que cada sub-tela ganhou.
    if (nomeAba !== "mais" || aba === "mais") setTela(null);
    setAba(nomeAba);
  }

  return (
    <div style={wrap}>
      {erro && <div style={{ ...cardStyle, color: C.danger }}>{erro}</div>}
      {carregando ? (
        <div style={{ color: C.inkFaint, fontSize: 13.5 }}>Carregando…</div>
      ) : (
        <>
          {aba === "painel" && (
            <Painel
              membro={membro} membros={membrosParaLancar} lancamentos={lancamentos} contas={contas} cartoes={cartoes} assinaturas={assinaturas} investimentos={investimentos}
              frentesGasto={frentesGasto} fontesReceita={fontesReceita} categorizacaoAutomatica={categorizacaoAutomatica}
              onNavegar={irPara} onSalvo={() => carregarTudo({ silencioso: true })}
              onMembroAtualizado={() => { carregarTudo({ silencioso: true }); onMembroAtualizado && onMembroAtualizado(); }}
            />
          )}

          {aba === "receitas" && (
            <Receitas membro={membro} membros={membrosParaLancar} lancamentos={lancamentos} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita} nomePorMembroId={nomePorMembroId} categorizacaoAutomatica={categorizacaoAutomatica} onSalvo={() => carregarTudo({ silencioso: true })} />
          )}

          {aba === "gastos" && (
            <Gastos
              membro={membro} membros={membrosParaLancar} lancamentos={lancamentos} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita} nomePorMembroId={nomePorMembroId}
              presetLancamento={presetLancamento} onPresetConsumido={() => setPresetLancamento(null)} categorizacaoAutomatica={categorizacaoAutomatica}
              onSalvo={() => carregarTudo({ silencioso: true })}
            />
          )}

          {aba === "mais" && (
            <TelaMais
              tela={tela} setTela={setTela}
              membro={membro} membros={membros} contas={contas} cartoes={cartoes} categorias={categorias} podeEditar={podeEditar}
              frentesGasto={frentesGasto} fontesReceita={fontesReceita} nomePorMembroId={nomePorMembroId}
              lancamentos={lancamentos} planejamentoItens={planejamentoItens} onLancarAgora={lancarAgoraDoPlanejamento}
              familiaInfo={familiaInfo}
              onMembroAtualizado={() => { carregarTudo({ silencioso: true }); onMembroAtualizado && onMembroAtualizado(); }}
              onSalvo={() => carregarTudo({ silencioso: true })}
            />
          )}
        </>
      )}

      <BarraInferior aba={aba} onEscolher={abrirAba} />
    </div>
  );
}

function TelaMais({ tela, setTela, membro, membros, contas, cartoes, categorias, podeEditar, frentesGasto, fontesReceita, nomePorMembroId, lancamentos, planejamentoItens, onLancarAgora, familiaInfo, onMembroAtualizado, onSalvo }) {
  if (tela?.startsWith("cartao:")) {
    const cartaoId = tela.split(":")[1];
    return (
      <CartaoDetalhe
        cartaoId={cartaoId} familiaId={membro.familia_id} membro={membro} membros={membros} contas={contas} cartoes={cartoes}
        frentesGasto={frentesGasto} fontesReceita={fontesReceita} podeEditar={podeEditar}
        onVoltar={() => setTela("contas")} onSalvo={onSalvo}
      />
    );
  }
  if (tela === "contas") return <ContasCartoes familiaId={membro.familia_id} onAbrirCartao={(id) => setTela(`cartao:${id}`)} onVoltar={() => setTela(null)} />;
  if (tela === "investimentos") return <Investimentos familiaId={membro.familia_id} podeEditar={podeEditar} onVoltar={() => setTela(null)} />;
  if (tela === "relatorios") return <Relatorios familiaId={membro.familia_id} frentesGasto={frentesGasto} onVoltar={() => setTela(null)} />;
  if (tela === "assinaturas") return <Assinaturas familiaId={membro.familia_id} contas={contas} cartoes={cartoes} podeEditar={podeEditar} onVoltar={() => setTela(null)} />;
  if (tela === "chat") return <ChatCosmo membro={membro} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita} onVoltar={() => setTela(null)} onSalvo={onSalvo} />;
  if (tela === "importar") return <ImportarArquivo membro={membro} frentesGasto={frentesGasto} fontesReceita={fontesReceita} onVoltar={() => setTela(null)} onSalvo={onSalvo} />;
  if (tela === "membros") return <GerenciarMembros membros={membros} membroLogado={membro} contas={contas} cartoes={cartoes} podeEditar={podeEditar} onAtualizado={onMembroAtualizado} onVoltar={() => setTela(null)} />;
  // Categorias personalizadas (migração 10, 16/09/2026) — a lista em si
  // (criar/editar/excluir categoria) continua disponível pros dois papéis,
  // sem distinção. A partir da leva 12 (25/09/2026), esta tela também ganhou
  // o toggle de categorização automática (dono-only, RLS de "familias" já é
  // assim) e o painel de categorização em lote — por isso agora recebe
  // `podeEditar`, `familiaInfo` e os lançamentos. A partir da 16ª leva
  // (26/09/2026), clicar numa categoria expande os lançamentos dela no mês
  // (editáveis ali mesmo, inclusive a categoria) — por isso ganhou também
  // `membro`/`membros`/`contas`/`cartoes`/`nomePorMembroId` (já eram props
  // de TelaMais, ou passaram a ser — `membros` aqui é a lista cheia, igual
  // já vale pra CartaoDetalhe/GerenciarMembros; quem realmente decide se o
  // seletor "lançar em nome de outro membro" aparece dentro do
  // EditarLancamento é o `podeEscolherMembro` que Categorias.jsx calcula,
  // não a lista em si).
  if (tela === "categorias") {
    return (
      <Categorias
        familiaId={membro.familia_id} categorias={categorias} lancamentos={lancamentos}
        frentesGasto={frentesGasto} fontesReceita={fontesReceita}
        podeEditar={podeEditar} familiaInfo={familiaInfo}
        membro={membro} membros={membros} contas={contas} cartoes={cartoes} nomePorMembroId={nomePorMembroId}
        onAtualizado={onSalvo} onVoltar={() => setTela(null)}
      />
    );
  }
  // Planejamento financeiro (migração 12, 25/09/2026) — mesma filosofia de
  // "editar tudo" das outras telas de configuração: os dois papéis
  // criam/editam/excluem itens, sem distinção (mesma decisão já tomada pra
  // Categorias/Contas/Cartões).
  if (tela === "planejamento") {
    return (
      <Planejamento
        familiaId={membro.familia_id} itens={planejamentoItens} lancamentos={lancamentos} frentesGasto={frentesGasto}
        onAtualizado={onSalvo} onLancarAgora={onLancarAgora} onVoltar={() => setTela(null)}
      />
    );
  }

  const itens = [
    { chave: "contas", label: "Contas e cartões", Icone: IconCard, cor: C.accent, corSoft: C.accentSoft },
    { chave: "categorias", label: "Categorias", Icone: IconStar, cor: C.gold, corSoft: C.amberSoft },
    { chave: "planejamento", label: "Planejamento financeiro", Icone: IconCalendar, cor: "#5B3FD9", corSoft: C.purpleSoft },
    { chave: "assinaturas", label: "Assinaturas", Icone: IconRefresh, cor: C.purple, corSoft: C.purpleSoft },
    { chave: "investimentos", label: "Investimentos", Icone: IconTrendingUp, cor: C.green, corSoft: C.greenSoft },
    { chave: "relatorios", label: "Relatórios", Icone: IconBarChart, cor: C.accent, corSoft: C.accentSoft },
    { chave: "chat", label: "Falar com o COSMO", Icone: IconCosmo, cor: C.accent, corSoft: C.accentSoft },
    { chave: "importar", label: "Importar e anexar", Icone: IconUpload, cor: C.accent, corSoft: C.accentSoft },
    { chave: "membros", label: "Membros e permissões", Icone: IconUsers, cor: C.purple, corSoft: C.purpleSoft },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Mais</div>
      {itens.map((it) => (
        <button key={it.chave} onClick={() => setTela(it.chave)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 16px", fontSize: 14, fontWeight: 700, color: C.ink, cursor: "pointer", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: it.corSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <it.Icone size={17} color={it.cor} strokeWidth={1.9} />
            </div>
            {it.label}
          </div>
          <IconChevronRight size={16} color={C.inkFaint} strokeWidth={2.2} />
        </button>
      ))}
    </div>
  );
}

function BarraInferior({ aba, onEscolher }) {
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1px solid ${C.line}`, display: "grid", gridTemplateColumns: "repeat(4,1fr)", padding: "10px 0 14px 0", maxWidth: 720, margin: "0 auto" }}>
      {ABAS_PRINCIPAIS.map((a) => (
        <button key={a.chave} onClick={() => onEscolher(a.chave)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer" }}>
          <a.Icone size={20} color={aba === a.chave ? C.accent : "#9AA2B5"} strokeWidth={aba === a.chave ? 2 : 1.9} />
          <span style={{ fontSize: 10, fontWeight: 800, color: aba === a.chave ? C.accent : "#9AA2B5" }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// Correção 16/09/2026 (unificação do acesso da Alessia, resposta à pergunta
// "o que ela deve ver dentro do Mais?"): ela enxerga esta mesma tela — vê a
// lista de membros da família — mas sem nenhum botão de editar
// permissões/mesada/visibilidade nem de adicionar gente nova. `podeEditar`
// (= é dono) é quem decide isso; a lista em si (`membros`) já é a mesma pra
// qualquer papel, já que a política de RLS "membros: qualquer um da familia
// ve os membros da familia" nunca escondeu isso de ninguém.
function GerenciarMembros({ membros, membroLogado, contas, cartoes, podeEditar, onAtualizado, onVoltar }) {
  const [mostrarForm, setMostrarForm] = useState(false);

  return (
    <div style={cardStyle}>
      {onVoltar && <button onClick={onVoltar} style={{ border: "none", background: "transparent", color: C.ink, fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 10 }}>‹ Voltar</button>}
      <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 12 }}>MEMBROS DA FAMÍLIA</div>
      {membros.map((m) => <MembroCard key={m.id} membro={m} contas={contas} cartoes={cartoes} souEu={m.id === membroLogado.id} podeEditar={podeEditar} onAtualizado={onAtualizado} />)}
      {podeEditar && !mostrarForm && <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => setMostrarForm(true)}>+ Adicionar membro</button>}
      {podeEditar && mostrarForm && <AdicionarMembro familiaId={membroLogado.familia_id} onSalvo={() => { setMostrarForm(false); onAtualizado(); }} onCancelar={() => setMostrarForm(false)} />}
    </div>
  );
}

// A visibilidade de cada conta/cartão pra quem tem acesso restrito
// (visivel_para_restrito) é uma propriedade da PRÓPRIA conta/cartão no
// banco, não um vínculo por pessoa — então, embora essa edição fique
// dentro do cartão de cada membro (pra ficar junto das permissões dela),
// hoje ela vale igual pra qualquer membro com acesso restrito que exista
// na família (só a Alessia, por enquanto).
function MembroCard({ membro, contas, cartoes, souEu, podeEditar, onAtualizado }) {
  const [editando, setEditando] = useState(false);
  const [mesada, setMesada] = useState(membro.mesada_mensal || 0);
  const [perm, setPerm] = useState(membro.permissoes || {});
  const [visContas, setVisContas] = useState(() => Object.fromEntries(contas.map((c) => [c.id, !!c.visivel_para_restrito])));
  const [visCartoes, setVisCartoes] = useState(() => Object.fromEntries(cartoes.map((c) => [c.id, !!c.visivel_para_restrito])));
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      // `.select()` em cada update, de propósito: o Supabase não avisa
      // quando um "update" não bate em nenhuma linha (não é erro de RLS pra
      // ele, é só "zero linhas no WHERE") — sem conferir `data.length`, dava
      // pra "Salvar" parecer ter funcionado e nada mudar de fato no banco.
      const tarefas = [
        { rotulo: "permissões", promessa: supabase.from("membros").update({ mesada_mensal: Number(mesada), permissoes: perm }).eq("id", membro.id).select() },
        ...contas.map((c) => ({ rotulo: `conta "${c.nome}"`, promessa: supabase.from("contas").update({ visivel_para_restrito: !!visContas[c.id] }).eq("id", c.id).select() })),
        ...cartoes.map((c) => ({ rotulo: `cartão "${c.nome}"`, promessa: supabase.from("cartoes_credito").update({ visivel_para_restrito: !!visCartoes[c.id] }).eq("id", c.id).select() })),
      ];
      const resultados = await Promise.all(tarefas.map((t) => t.promessa));
      const comErro = resultados.find((r) => r.error);
      if (comErro) throw comErro.error;
      const semLinha = resultados.findIndex((r) => !r.data || r.data.length === 0);
      if (semLinha !== -1) throw new Error(`Não consegui salvar ${tarefas[semLinha].rotulo} — o banco não confirmou nenhuma alteração.`);
      setEditando(false);
      onAtualizado();
    } catch (e) {
      alert(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.line}`, padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{membro.nome} {souEu && "(você)"}</div>
          <div style={{ fontSize: 12, color: C.inkFaint }}>{membro.papel === "dono" ? "Administrador(a)" : "Acesso restrito"} {membro.email ? `· ${membro.email}` : ""} {!membro.user_id ? "· convite pendente" : ""}</div>
        </div>
        {podeEditar && membro.papel === "restrito" && !editando && <button style={btnGhost} onClick={() => setEditando(true)}>Editar</button>}
      </div>
      {podeEditar && membro.papel === "restrito" && editando && (
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 12.5, color: C.inkMute }}>Mesada mensal</label>
          <input style={{ ...input, display: "block", marginTop: 4, marginBottom: 10 }} type="number" step="0.01" value={mesada} onChange={(e) => setMesada(e.target.value)} />
          {[
            ["ver_saldo_geral", "Pode ver o saldo geral da família"],
            ["ver_gastos_dono", "Pode ver os gastos do administrador"],
            ["ver_resumo_categorias", "Pode ver o resumo por categoria"],
          ].map(([chave, label]) => (
            <label key={chave} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginBottom: 6 }}>
              <input type="checkbox" checked={!!perm[chave]} onChange={(e) => setPerm({ ...perm, [chave]: e.target.checked })} />
              {label}
            </label>
          ))}

          {(contas.length > 0 || cartoes.length > 0) && (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <label style={{ fontSize: 12.5, color: C.inkMute, display: "block", marginBottom: 6 }}>Contas e cartões que ela pode ver</label>
              {contas.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginBottom: 6 }}>
                  <input type="checkbox" checked={!!visContas[c.id]} onChange={(e) => setVisContas({ ...visContas, [c.id]: e.target.checked })} />
                  {c.nome}{c.titular ? ` (${c.titular})` : ""}
                </label>
              ))}
              {cartoes.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.ink, marginBottom: 6 }}>
                  <input type="checkbox" checked={!!visCartoes[c.id]} onChange={(e) => setVisCartoes({ ...visCartoes, [c.id]: e.target.checked })} />
                  {c.nome}{c.titular ? ` (${c.titular})` : ""}
                </label>
              ))}
              <div style={{ fontSize: 11, color: C.inkFaint, marginTop: 2 }}>
                Vale pra qualquer pessoa com acesso restrito na família — hoje só a Alessia.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={btn} onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
            <button style={btnGhost} onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdicionarMembro({ familiaId, onSalvo, onCancelar }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [mesada, setMesada] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      const { error } = await supabase.from("membros").insert({
        familia_id: familiaId,
        nome: nome.trim(),
        email: email.trim(),
        papel: "restrito",
        mesada_mensal: Number(mesada) || 0,
        permissoes: { ver_saldo_geral: false, ver_gastos_dono: false, ver_resumo_categorias: false },
      });
      if (error) throw error;
      onSalvo();
    } catch (e) {
      setErro(e.message || "Erro ao convidar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
      {erro && <div style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input style={input} placeholder="Nome (ex: Alessia)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input style={input} type="email" placeholder="E-mail dela" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input style={input} type="number" step="0.01" placeholder="Mesada mensal" value={mesada} onChange={(e) => setMesada(e.target.value)} />
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, margin: "8px 0" }}>
        O Cash App não manda nenhum e-mail sozinho — avise você mesmo a ela. Ela precisa abrir o app e criar a conta dela usando ESTE MESMO e-mail (em "Ainda não tem conta? Criar uma"); assim que ela entrar pela primeira vez, o app liga a conta dela à sua família sozinho.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn} type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        <button type="button" style={btnGhost} onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
