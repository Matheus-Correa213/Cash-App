import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe, moeda, inicioMesISO, mesDaFatura } from "./theme.js";
import NovoLancamento from "./NovoLancamento.jsx";
import { IconPlus, IconCosmo, IconCard, IconRefresh, IconUpload, IconBarChart, IconChevronRight, IconChevronUp, IconChevronDown, IconSettings, IconTrendingUp } from "./Icons.jsx";
import LogoInstituicao from "./LogoInstituicao.jsx";

// Catálogo de tudo que PODE aparecer em "Seus widgets" — cada pessoa escolhe
// quais entram e em que ordem (gravado em membros.preferencias_painel).
// Quando essa coluna está vazia (ninguém personalizou ainda), usamos
// PADRAO_WIDGETS, que reproduz exatamente o painel de antes dessa mudança —
// ninguém perde nada até tocar na engrenagem.
const CATALOGO_WIDGETS = [
  { tipo: "cartao", label: "Cartão de crédito" },
  { tipo: "assinaturas", label: "Assinaturas" },
  { tipo: "investimentos", label: "Investimentos" },
  { tipo: "insight", label: "Percebido pelo COSMO" },
];
const PADRAO_WIDGETS = [{ tipo: "cartao" }, { tipo: "assinaturas" }, { tipo: "insight" }];

// Painel principal — redesenhado pra ser só um resumo (saldo do casal), duas
// ações principais (lançar ou falar com o COSMO), atalhos, e uma seção de
// "widgets" modulares. Widgets de verdade na tela inicial do celular (fora
// do app) exigiriam um app nativo — aqui são cartões dentro do próprio app.
//
// Os ícones e os detalhes decorativos (o brilho desfocado no cartão de saldo,
// a saudação, o "toque para reordenar") vêm direto do mockup aprovado no
// Design Canvas — a primeira versão portada trocou tudo isso por quadradinhos
// de cor sólida, o que deixou a tela com cara de esqueleto em vez do app
// "de banco de verdade" que foi desenhado.

const shortcuts = [
  { chave: "contas", label: "Contas", cor: C.accent, corSoft: C.accentSoft, Icone: IconCard },
  { chave: "assinaturas", label: "Assinaturas", cor: C.purple, corSoft: C.purpleSoft, Icone: IconRefresh },
  { chave: "importar", label: "Anexar", cor: C.accent, corSoft: C.accentSoft, Icone: IconUpload },
  { chave: "relatorios", label: "Relatórios", cor: C.accent, corSoft: C.accentSoft, Icone: IconBarChart },
];

function saudacao() {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default function Painel({ membro, membros, lancamentos, contas, cartoes, assinaturas, investimentos, frentesGasto, fontesReceita, categorizacaoAutomatica, onNavegar, onSalvo, onMembroAtualizado }) {
  const [lancamentoAberto, setLancamentoAberto] = useState(false);
  const [personalizando, setPersonalizando] = useState(false);
  const podeEditar = membro?.papel === "dono";

  const doMes = useMemo(() => lancamentos.filter((l) => l.data >= inicioMesISO()), [lancamentos]);
  // `!l.cartao_id` nos gastos (leva 12, 25/09/2026 — mesma separação usada em
  // Gastos.jsx): compra de cartão só vira dinheiro saindo de verdade quando a
  // fatura é paga (esse lançamento não tem `cartao_id`), então contar as
  // compras E a fatura ao mesmo tempo contaria o mesmo gasto duas vezes.
  const totalGastos = useMemo(() => doMes.filter((l) => l.tipo === "gasto" && !l.cartao_id).reduce((s, l) => s + Number(l.valor), 0), [doMes]);
  const totalReceitas = useMemo(() => doMes.filter((l) => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0), [doMes]);

  // BUG CORRIGIDO (16/09/2026): "Saldo total do casal" estava sendo calculado
  // como receitas-do-mês menos gastos-do-mês — ou seja, o fluxo de caixa do
  // mês, não o dinheiro que existe de verdade. Isso é por isso que o Painel
  // mostrava R$ 0,00 mesmo com R$ 1.630,62 reais espalhados pelas contas: uma
  // atualização de saldo feita pelo chat do COSMO mexe direto em
  // `contas.saldo_inicial`, nunca cria um lançamento, então nunca entrava
  // nessa conta. Agora o saldo real vem da mesma fonte que a tela de Contas e
  // cartões já usa e mostra certinho — a função `saldos_contas()` do banco
  // (saldo_inicial + lançamentos daquela conta), com o mesmo recorte dela:
  // contas bancárias + carteiras físicas, sem poupança (tratada à parte) e
  // sem entrar no crédito disponível dos cartões (que é uma dívida, não
  // dinheiro em caixa). Os dois números continuam mostrando a mesma coisa nas
  // duas telas.
  const [saldosContas, setSaldosContas] = useState({});
  useEffect(() => {
    if (!podeEditar) return; // dono só — ver comentário no bloco de baixo
    let cancelado = false;
    supabase.rpc("saldos_contas").then(({ data, error }) => {
      if (cancelado) return;
      if (error) { console.error("Não consegui buscar os saldos reais das contas:", error.message); return; }
      setSaldosContas(Object.fromEntries((data || []).map((r) => [r.conta_id, r.saldo])));
    });
    return () => { cancelado = true; };
    // CORREÇÃO (21/09/2026): faltava `lancamentos.length` e `contas.length`
    // aqui — o saldo REAL mora no banco (essa RPC soma saldo_inicial +
    // lançamentos daquela conta), e antes esse efeito só rodava quando
    // `podeEditar`/`familia_id` mudavam, ou seja, uma vez ao entrar no
    // Painel. Lançar um gasto/receita atualiza a lista `lancamentos` (via
    // `carregarTudo` no OwnerView), mas isso não disparava um novo fetch —
    // o número só se atualizava se a pessoa saísse do Painel (desmontando
    // o componente) e voltasse. Agora qualquer mudança na quantidade de
    // lançamentos ou de contas (nova conta criada, por exemplo) refaz a
    // busca na hora.
  }, [podeEditar, membro?.familia_id, lancamentos.length, contas.length]);
  const saldoTotalCasal = useMemo(() => {
    return contas
      .filter((c) => c.tipo !== "poupanca")
      .reduce((s, c) => s + Number(saldosContas[c.id] ?? c.saldo_inicial ?? 0), 0);
  }, [contas, saldosContas]);

  // Unificação do acesso da Alessia (16/09/2026): quando não é o dono, o
  // "saldo total do casal" NÃO pode vir só das `contas` que chegaram aqui —
  // essa lista já é filtrada pelo RLS pra só o que está marcado como
  // visível pra ela (visivel_para_restrito), então somar só essas contas
  // daria um número MENOR do que o real (o Matheus esconde de propósito
  // algumas contas dela, mas mesmo assim quer que o saldo GERAL bata com o
  // dele). resumo_familia_do_membro() resolve isso: é uma função do banco
  // que enxerga TODAS as contas da família e só devolve o número agregado
  // se a permissão "ver_saldo_geral" permitir — nunca o detalhe de cada
  // conta escondida.
  const [resumoRestrito, setResumoRestrito] = useState(null);
  useEffect(() => {
    if (podeEditar) return;
    let cancelado = false;
    supabase.rpc("resumo_familia_do_membro").then(({ data, error }) => {
      if (cancelado) return;
      if (error) { console.error("Não consegui buscar o resumo geral da família:", error.message); return; }
      setResumoRestrito(data || null);
    });
    return () => { cancelado = true; };
    // Mesma correção de 21/09/2026 explicada no efeito de `saldos_contas`
    // acima: sem `lancamentos.length`/`contas.length`, o resumo da Alessia
    // também só atualizava ao sair e voltar pro Painel.
  }, [podeEditar, membro?.familia_id, lancamentos.length, contas.length]);

  const saldoGeralPermitido = podeEditar || !!resumoRestrito?.permitido;
  const saldo = podeEditar ? saldoTotalCasal : Number(resumoRestrito?.saldo || 0);
  const primeiroNome = (membro?.nome || "").split(" ")[0];

  const assinaturasAtivas = (assinaturas || []).filter((a) => a.ativo);
  const totalAssinaturas = assinaturasAtivas.reduce((s, a) => s + Number(a.valor), 0);
  const proximaAssinatura = assinaturasAtivas.slice().sort((a, b) => a.dia_cobranca - b.dia_cobranca)[0];

  const totalAportadoInv = (investimentos || []).reduce((s, i) => s + Number(i.valor_aportado), 0);
  const totalAtualInv = (investimentos || []).reduce((s, i) => s + Number(i.valor_atual), 0);
  const ganhoInv = totalAtualInv - totalAportadoInv;

  // Quais widgets aparecem e em que ordem — vem de membro.preferencias_painel
  // (salvo pelo painel de "Personalizar"), ou do padrão de sempre enquanto
  // ninguém mexeu nisso ainda.
  const preferenciasWidgets = membro?.preferencias_painel?.length ? membro.preferencias_painel : PADRAO_WIDGETS;

  async function salvarPreferenciasWidgets(novaLista) {
    // `.select()` + checar `data.length` é de propósito: um "update" que não
    // bate em nenhuma linha (id errado, RLS bloqueando) não é reportado como
    // erro pelo Supabase — sem essa checagem, dava pra "salvar" e a tela
    // continuar exatamente igual, sem nenhum aviso do motivo.
    const { data, error } = await supabase.from("membros").update({ preferencias_painel: novaLista }).eq("id", membro.id).select();
    if (error) { alert(error.message); return; }
    if (!data || data.length === 0) { alert("Não consegui salvar — o banco não confirmou nenhuma alteração."); return; }
    onMembroAtualizado && onMembroAtualizado();
  }

  // Insight simples e honesto: compara os últimos 7 dias com os 7 dias
  // anteriores na frente "dia_a_dia". Não é IA de verdade — é um cálculo na
  // hora — mas já dá o efeito de "o COSMO percebeu algo" sem precisar de
  // nenhuma chave de API pra funcionar.
  const insight = useMemo(() => {
    const hoje = new Date();
    const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1); // limite exclusivo, pra incluir o dia de hoje
    const seteDiasAtras = new Date(hoje); seteDiasAtras.setDate(hoje.getDate() - 7);
    const quatorzeDiasAtras = new Date(hoje); quatorzeDiasAtras.setDate(hoje.getDate() - 14);
    const soma = (de, ate) => lancamentos
      .filter((l) => l.tipo === "gasto" && !l.cartao_id && l.categoria === "dia_a_dia" && l.data >= de.toISOString().slice(0, 10) && l.data < ate.toISOString().slice(0, 10))
      .reduce((s, l) => s + Number(l.valor), 0);
    const ultimos = soma(seteDiasAtras, amanha);
    const anteriores = soma(quatorzeDiasAtras, seteDiasAtras);
    if (anteriores <= 0 || ultimos <= 0) return null;
    const variacao = Math.round(((ultimos - anteriores) / anteriores) * 100);
    if (Math.abs(variacao) < 15) return null;
    return variacao > 0
      ? `Vocês gastaram ${variacao}% a mais em "dia a dia" essa semana. Quer rever o orçamento?`
      : `Boa! Gastos em "dia a dia" caíram ${Math.abs(variacao)}% essa semana.`;
  }, [lancamentos]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {primeiroNome && (
        <div style={{ fontSize: 13, color: C.inkMute, fontWeight: 600, marginTop: -8 }}>
          {saudacao()}, {primeiroNome} — aqui está o resumo do casal.
        </div>
      )}

      <div style={{ position: "relative", overflow: "hidden", background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navyDeep} 100%)`, borderRadius: 22, padding: 24, color: "#fff" }}>
        <div style={{ position: "absolute", width: 160, height: 160, borderRadius: "50%", background: C.gold, opacity: 0.16, filter: "blur(38px)", top: -50, right: -30 }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.65)" }}>Saldo total do casal</div>
          {saldoGeralPermitido ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.5px", marginTop: 4 }}>{moeda(saldo)}</div>
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <LegendaSaldo cor="#4CE0AB" texto={`Receitas ${moeda(totalReceitas)}`} />
                <LegendaSaldo cor="#FF9A9E" texto={`Gastos ${moeda(totalGastos)}`} />
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)", marginTop: 6 }}>Você ainda não tem permissão pra ver o saldo geral — peça pro administrador liberar em "Mais → Membros e permissões".</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button onClick={() => setLancamentoAberto(true)} style={{ ...botaoPrincipal(C.accent, "#fff"), display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <IconPlus size={20} color="#fff" strokeWidth={2.3} />
          Novo lançamento
        </button>
        <button onClick={() => onNavegar("chat")} style={{ ...botaoPrincipal("#fff", C.ink, C.lineStrong), display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ width: 20, height: 20, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent} 0%, ${C.navyDeep} 100%)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconCosmo size={11} color="#fff" strokeWidth={2.1} />
          </div>
          Falar com o COSMO
        </button>
      </div>

      {lancamentoAberto && (
        <NovoLancamento
          membroLogado={membro} membros={membros} contas={contas} cartoes={cartoes} frentesGasto={frentesGasto} fontesReceita={fontesReceita}
          categorizacaoAutomatica={categorizacaoAutomatica}
          aberto={true} onFechar={() => setLancamentoAberto(false)} onSalvo={onSalvo}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {shortcuts.map((s) => (
          <button key={s.chave} onClick={() => onNavegar(s.chave)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer" }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: s.corSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <s.Icone size={20} color={s.cor} strokeWidth={1.8} />
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: C.ink }}>{s.label}</span>
          </button>
        ))}
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>Seus widgets</div>
          {/* "Personalizar" grava em membros.preferencias_painel, e a política
              de RLS de UPDATE em "membros" só deixa o DONO editar qualquer
              linha (inclusive a própria) — pra quem tem acesso restrito,
              clicar em "Salvar" aqui sempre daria um erro de "0 linhas
              afetadas". Até existir uma política própria pra isso, o botão
              fica escondido pra ela em vez de levar a um beco sem saída. */}
          {podeEditar && (
            <button onClick={() => setPersonalizando((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: C.inkFaint, cursor: "pointer", padding: 2 }}>
              <IconSettings size={14} color={C.inkFaint} strokeWidth={1.9} />
              <span style={{ fontSize: 10.5, fontWeight: 700 }}>{personalizando ? "fechar" : "personalizar"}</span>
            </button>
          )}
        </div>

        {personalizando ? (
          <PersonalizarWidgets
            preferencias={preferenciasWidgets}
            cartoes={cartoes}
            onSalvar={async (nova) => { await salvarPreferenciasWidgets(nova); setPersonalizando(false); }}
            onFechar={() => setPersonalizando(false)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {preferenciasWidgets.map((w, i) => {
              if (w.tipo === "cartao") {
                const cartao = (w.cartao_id && cartoes.find((c) => c.id === w.cartao_id)) || cartoes[0];
                if (!cartao) return null;
                return <WidgetCartao key={i} cartao={cartao} lancamentos={lancamentos} onNavegar={onNavegar} />;
              }
              if (w.tipo === "assinaturas") {
                // Antes, sem nenhuma assinatura ativa cadastrada, o widget
                // simplesmente sumia — a pessoa ligava em "Personalizar", salvava,
                // voltava e não via nada, parecia que a opção não tinha "pegado".
                // Agora mostra um estado vazio explicando o que falta.
                if (assinaturasAtivas.length === 0) return <WidgetVazio key={i} label="Assinaturas" texto="Nenhuma assinatura cadastrada ainda." onNavegar={() => onNavegar("assinaturas")} />;
                return <WidgetAssinaturas key={i} ativas={assinaturasAtivas} total={totalAssinaturas} proxima={proximaAssinatura} onNavegar={onNavegar} />;
              }
              if (w.tipo === "investimentos") {
                if (!investimentos || investimentos.length === 0) return <WidgetVazio key={i} label="Investimentos" texto="Nenhum investimento cadastrado ainda." onNavegar={() => onNavegar("investimentos")} />;
                return <WidgetInvestimentos key={i} totalAtual={totalAtualInv} ganho={ganhoInv} onNavegar={onNavegar} />;
              }
              if (w.tipo === "insight") {
                // Este widget é o único legitimamente "às vezes não tem nada a
                // dizer" (só aparece quando há uma variação real de gastos pra
                // comentar) — por isso continua desaparecendo em silêncio, sem
                // virar um estado vazio permanente.
                if (!insight) return null;
                return <WidgetInsight key={i} insight={insight} />;
              }
              return null;
            })}
            {preferenciasWidgets.length === 0 && (
              <div style={{ fontSize: 12.5, color: C.inkFaint }}>Nenhum widget escolhido — toque em "personalizar" pra adicionar.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WidgetCartao({ cartao, lancamentos, onNavegar }) {
  const abertosDoCartao = useMemo(
    () => lancamentos.filter((l) => l.cartao_id === cartao.id && !l.fatura_paga && l.tipo === "gasto"),
    [lancamentos, cartao]
  );
  // fatura_inicial (migração 6) é a dívida que já existia no cartão antes de
  // começar a lançar tudo pelo app. faturaAtual é só o ciclo de agora (mesmo
  // recorte que a tela do cartão usa); usado soma TUDO em aberto (presente e
  // futuro) + limite_comprometido_extra (migração 7, parcelas em andamento
  // que o app ainda não conhece uma por uma) — é isso que dá o disponível
  // real, que costuma ser menor do que "limite − fatura atual" quando há
  // parcelamento em curso.
  const { faturaAtual, usado } = useMemo(() => {
    const hojeMes = new Date().toISOString().slice(0, 7);
    const buckets = abertosDoCartao.map((l) => mesDaFatura(l.data, cartao.dia_fechamento));
    const mesAtual = buckets.filter((m) => m >= hojeMes).sort()[0] || hojeMes;
    const faturaInicial = Number(cartao.fatura_inicial || 0);
    const doCicloAtual = abertosDoCartao.filter((_, i) => buckets[i] === mesAtual).reduce((s, l) => s + Number(l.valor), 0);
    const total = abertosDoCartao.reduce((s, l) => s + Number(l.valor), 0);
    return {
      faturaAtual: doCicloAtual + faturaInicial,
      usado: total + faturaInicial + Number(cartao.limite_comprometido_extra || 0),
    };
  }, [abertosDoCartao, cartao]);
  const inst = instituicaoDe(cartao.bandeira || cartao.nome);
  const disponivel = cartao.limite != null ? Math.max(0, cartao.limite - usado) : null;
  return (
    <button onClick={() => onNavegar(`cartao:${cartao.id}`)} style={{ ...widgetBase, position: "relative", overflow: "hidden", background: `linear-gradient(135deg, ${inst.cor} 0%, ${inst.corEscura} 100%)`, color: "#fff", border: "none", textAlign: "left", cursor: "pointer" }}>
      <div style={{ position: "absolute", width: 100, height: 100, borderRadius: "50%", background: "#fff", opacity: 0.08, filter: "blur(24px)", top: -30, right: -20 }} />
      <div style={{ position: "relative", flex: 1 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{cartao.nome}</div>
        {/* Disponível é o número em destaque (o que importa no dia a dia é
            quanto ainda dá pra gastar) — a fatura do mês vira a linha
            pequena abaixo. */}
        <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{disponivel != null ? moeda(disponivel) : moeda(faturaAtual)}</div>
        {disponivel != null && (
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
            Fatura atual {moeda(faturaAtual)}{cartao.dia_fechamento ? ` · fecha dia ${cartao.dia_fechamento}` : ""}
          </div>
        )}
      </div>
      <LogoInstituicao nome={cartao.bandeira || cartao.nome} size={26} claro />
      <IconChevronRight size={15} color="rgba(255,255,255,0.7)" strokeWidth={2.3} style={{ position: "relative", flexShrink: 0 }} />
    </button>
  );
}

function WidgetAssinaturas({ ativas, total, proxima, onNavegar }) {
  return (
    <button onClick={() => onNavegar("assinaturas")} style={{ ...widgetBase, background: "#fff", border: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: C.purpleSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconRefresh size={18} color={C.purple} strokeWidth={1.9} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Assinaturas</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.inkFaint }}>{ativas.length} ativas{proxima ? ` · próxima dia ${proxima.dia_cobranca}` : ""}</div>
        </div>
      </div>
      <span style={{ fontSize: 14, fontWeight: 800, color: C.purple }}>{moeda(total)}/mês</span>
    </button>
  );
}

function WidgetInvestimentos({ totalAtual, ganho, onNavegar }) {
  return (
    <button onClick={() => onNavegar("investimentos")} style={{ ...widgetBase, background: "#fff", border: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: C.greenSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconTrendingUp size={18} color={C.green} strokeWidth={1.9} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Investimentos</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: ganho >= 0 ? C.accent : C.danger }}>{ganho >= 0 ? "+" : ""}{moeda(ganho)}</div>
        </div>
      </div>
      <span style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{moeda(totalAtual)}</span>
    </button>
  );
}

function WidgetVazio({ label, texto, onNavegar }) {
  return (
    <button onClick={onNavegar} style={{ ...widgetBase, background: "#fff", border: `1px dashed ${C.lineStrong}`, cursor: "pointer", textAlign: "left" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.inkMute }}>{label}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.inkFaint, marginTop: 2 }}>{texto}</div>
      </div>
      <IconChevronRight size={15} color={C.inkFaint} strokeWidth={2.2} />
    </button>
  );
}

function WidgetInsight({ insight }) {
  return (
    <div style={{ display: "flex", gap: 11, background: C.navy, borderRadius: 16, padding: "14px 16px", alignItems: "flex-start" }}>
      <IconCosmo size={18} color={C.gold} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gold, marginBottom: 2 }}>Percebido pelo COSMO</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>{insight}</div>
      </div>
    </div>
  );
}

// Painel de "personalizar": lista todo o catálogo (ativos primeiro, na ordem
// salva, depois o resto), com checkbox pra ligar/desligar e setas pra
// reordenar só entre os ativos. Salva como uma lista só com os ativos, na
// ordem final — é exatamente isso que Painel usa pra renderizar.
function PersonalizarWidgets({ preferencias, cartoes, onSalvar, onFechar }) {
  const [lista, setLista] = useState(() => {
    const ativos = CATALOGO_WIDGETS.filter((cat) => preferencias.some((p) => p.tipo === cat.tipo))
      .sort((a, b) => preferencias.findIndex((p) => p.tipo === a.tipo) - preferencias.findIndex((p) => p.tipo === b.tipo));
    const inativos = CATALOGO_WIDGETS.filter((cat) => !preferencias.some((p) => p.tipo === cat.tipo));
    return [...ativos, ...inativos].map((cat) => {
      const existente = preferencias.find((p) => p.tipo === cat.tipo);
      return { tipo: cat.tipo, label: cat.label, ativo: !!existente, cartao_id: existente?.cartao_id || "" };
    });
  });
  const [salvando, setSalvando] = useState(false);

  function alternar(tipo) {
    setLista((l) => l.map((w) => (w.tipo === tipo ? { ...w, ativo: !w.ativo } : w)));
  }
  function escolherCartao(tipo, id) {
    setLista((l) => l.map((w) => (w.tipo === tipo ? { ...w, cartao_id: id } : w)));
  }
  function mover(tipo, direcao) {
    setLista((l) => {
      const idx = l.findIndex((w) => w.tipo === tipo);
      let alvo = idx + direcao;
      while (alvo >= 0 && alvo < l.length && !l[alvo].ativo) alvo += direcao;
      if (alvo < 0 || alvo >= l.length) return l;
      const nova = l.slice();
      [nova[idx], nova[alvo]] = [nova[alvo], nova[idx]];
      return nova;
    });
  }

  async function salvar() {
    setSalvando(true);
    const ativos = lista.filter((w) => w.ativo).map((w) => (w.tipo === "cartao" && w.cartao_id ? { tipo: w.tipo, cartao_id: w.cartao_id } : { tipo: w.tipo }));
    await onSalvar(ativos);
    setSalvando(false);
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 11.5, color: C.inkFaint, marginBottom: 12 }}>Marque o que aparece no seu painel. As setas mudam a ordem.</div>
      {lista.map((w) => (
        <div key={w.tipo} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
          <input type="checkbox" checked={w.ativo} onChange={() => alternar(w.tipo)} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{w.label}</div>
            {w.tipo === "cartao" && w.ativo && cartoes.length > 1 && (
              <select value={w.cartao_id || ""} onChange={(e) => escolherCartao("cartao", e.target.value)} style={{ marginTop: 4, fontSize: 12.5, padding: "5px 8px", borderRadius: 8, border: `1px solid ${C.line}` }}>
                <option value="">Cartão principal (o primeiro)</option>
                {cartoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            )}
          </div>
          {w.ativo && (
            <div style={{ display: "flex", gap: 2 }}>
              <button type="button" onClick={() => mover(w.tipo, -1)} style={setaBtn}><IconChevronUp size={14} color={C.inkMute} strokeWidth={2.2} /></button>
              <button type="button" onClick={() => mover(w.tipo, 1)} style={setaBtn}><IconChevronDown size={14} color={C.inkMute} strokeWidth={2.2} /></button>
            </div>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={salvar} disabled={salvando} style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{salvando ? "Salvando…" : "Salvar"}</button>
        <button onClick={onFechar} style={{ padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.inkMute, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

function LegendaSaldo({ cor, texto }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: cor }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>{texto}</span>
    </div>
  );
}

function botaoPrincipal(bg, cor, borda) {
  return { padding: "16px 14px", borderRadius: 16, border: borda ? `1.5px solid ${borda}` : "none", background: bg, color: cor, fontWeight: 800, fontSize: 13, cursor: "pointer" };
}

const widgetBase = { borderRadius: 16, padding: "15px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" };
const setaBtn = { width: 26, height: 26, borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
