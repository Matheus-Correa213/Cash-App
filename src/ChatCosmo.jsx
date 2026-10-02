import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { C, instituicaoDe, moeda, mesDaFatura } from "./theme.js";
import { IconCosmoFull, IconChevronLeft, IconSend, IconReceiptScan } from "./Icons.jsx";
import { PALETA_CORES, normalizarChave } from "./CategoriaCampos.jsx";
import { resumoPlanejamentoParaCosmo } from "./planejamentoCalculo.js";

// Chat com o COSMO, versão financeira. A IA só PROPÕE (ver api/chat.js) — o
// lançamento de verdade só acontece quando a pessoa aperta "Confirmar e
// lançar" aqui embaixo, que insere direto no Supabase como qualquer outro
// lançamento do app (sem passar pela IA de novo).
//
// Correção 16/09/2026: a conversa inteira (e o estado de cada proposta —
// pendente ou confirmada) agora é salva na tabela chat_mensagens (ver
// supabase-migracao-5-chat-persistente.sql) conforme acontece — antes ela
// só existia na memória deste componente, e sumia por completo ao sair da
// tela do chat e voltar (o COSMO "esquecia" tudo). Cada mensagem carrega um
// `dbId` (o id da linha no banco) que a gente usa depois pra atualizar
// `confirmadas` quando a pessoa confirma uma proposta.

const SUGESTOES = ["Adicionar gasto", "Anexar comprovante", "Como estão minhas finanças?", "Estratégia de pagamento"];

// Pedido do Matheus (02/10/2026): "uma opção de acesso ao COSMO, principalmente
// pra ter uma ideia de estratégia de pagamento, com base em datas de
// vencimento, valor na conta e por aí". O botão do Planejamento e a sugestão
// acima mandam esta mesma pergunta; quem responde com números reais é o
// /api/chat, pelas ferramentas planejamento_do_mes e situacao_financeira_agora.
export function textoEstrategiaPagamento(mes) {
  return `Monte a estratégia de pagamento${mes ? ` de ${nomeDoMesPorExtenso(mes)}` : " do mês"}: olhe o meu planejamento, os vencimentos e o saldo das minhas contas, e me diga em que ordem pagar, o que é mais urgente e se o saldo cobre.`;
}
function nomeDoMesPorExtenso(mes) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}
function dataLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const SAUDACAO = "Oi! Posso lançar gastos e receitas, ler comprovantes, ajudar a cadastrar/atualizar contas e cartões, e te dar um resumo rápido. É só me mandar uma mensagem ou uma foto.";

// `frentesGasto`/`fontesReceita` (migração 10, categorias personalizadas,
// 16/09/2026): mescladas (fixas + criadas pela família) de OwnerView.jsx —
// usadas aqui pra mostrar o rótulo certo no card de proposta E enviadas
// pro /api/chat como `categoriasResumo`, pra o COSMO poder propor
// lançamentos usando as categorias personalizadas também, não só as 6+4
// fixas da doutrina financeira.
export default function ChatCosmo({ membro, contas, cartoes, frentesGasto, fontesReceita, planejamento, mesFoco, mensagemInicial, onMensagemInicialConsumida, onVoltar, onSalvo }) {
  const [mensagens, setMensagens] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const inputArquivo = useRef(null);
  const areaTexto = useRef(null);
  const enviouInicial = useRef(false);

  useEffect(() => {
    let cancelado = false;
    async function carregarHistorico() {
      setCarregandoHistorico(true);
      try {
        const { data, error } = await supabase
          .from("chat_mensagens")
          .select("*")
          .eq("membro_id", membro.id)
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) throw error;
        if (!cancelado && data && data.length > 0) {
          setMensagens(data.map((m) => ({
            dbId: m.id,
            autor: m.autor,
            texto: m.texto,
            propostas: m.propostas || [],
            confirmadas: m.confirmadas || (m.propostas || []).map(() => false),
          })));
        }
      } catch (e) {
        // Uma tabela ainda não existente (antes da migração 5 ser rodada) ou
        // um problema de rede não deve travar o chat — só significa que a
        // conversa não vai ficar salva desta vez.
        console.error("Não consegui carregar o histórico do chat:", e.message);
      } finally {
        if (!cancelado) setCarregandoHistorico(false);
      }
    }
    carregarHistorico();
    return () => { cancelado = true; };
  }, [membro.id]);

  // Veio do botão "Estratégia de pagamento com o COSMO" do Planejamento: manda
  // a pergunta sozinho, uma vez, depois que o histórico carregou (assim a
  // pergunta cai no fim da conversa, não é engolida pelo carregamento).
  useEffect(() => {
    if (carregandoHistorico || !mensagemInicial || enviouInicial.current) return;
    enviouInicial.current = true;
    onMensagemInicialConsumida && onMensagemInicialConsumida();
    enviar(mensagemInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregandoHistorico, mensagemInicial]);

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

    // Salva sua mensagem no banco em paralelo, sem bloquear o envio pro
    // COSMO — se isso falhar (rede, migração 5 ainda não rodada), a
    // conversa desta sessão continua funcionando normalmente, só não fica
    // salva pra próxima vez que você abrir o chat.
    supabase.from("chat_mensagens").insert({
      familia_id: membro.familia_id, membro_id: membro.id, autor: "usuario",
      texto: mensagemTexto || (imagem ? "📎 Comprovante enviado" : null),
    }).then(({ error }) => { if (error) console.error("Não consegui salvar sua mensagem no histórico:", error.message); });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Manda um resumo das contas/cartões já cadastrados junto — é assim que
      // o COSMO sabe se uma conta que o usuário mencionou já existe (pra
      // ATUALIZAR) ou é nova (pra CRIAR), sem precisar de outra ida ao banco.
      const contasResumo = contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, instituicao: c.instituicao, titular: c.titular }));
      const cartoesResumo = cartoes.map((k) => ({ id: k.id, nome: k.nome, bandeira: k.bandeira, titular: k.titular }));
      const categoriasResumo = {
        gasto: frentesGasto.map((f) => ({ chave: f.chave, label: f.label })),
        receita: fontesReceita.map((f) => ({ chave: f.chave, label: f.label })),
      };
      // Planejamento (mês atual, o próximo e o que a pessoa estava olhando) —
      // calculado aqui com a MESMA função da tela, pra o COSMO enxergar os
      // mesmos números. Só é usado se ele chamar planejamento_do_mes.
      const agora = new Date();
      const mesDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const meses = [...new Set([mesFoco, mesDe(agora), mesDe(new Date(agora.getFullYear(), agora.getMonth() + 1, 1))].filter(Boolean))];
      const planejamentoResumo = planejamento
        ? resumoPlanejamentoParaCosmo({ itens: planejamento.itens, pagamentos: planejamento.pagamentos, valoresMes: planejamento.valoresMes, cartoes: planejamento.cartoes, lancamentosCartao: planejamento.lancamentosCartao, frentesGasto, meses })
        : undefined;
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ mensagem: mensagemTexto || undefined, imagemBase64: imagem?.base64, imagemMimeType: imagem?.mimeType, contasResumo, cartoesResumo, categoriasResumo, planejamentoResumo, hoje: dataLocalISO() }),
      });
      const dados = await resp.json();
      if (!resp.ok) throw new Error(dados.error || "Erro ao falar com o COSMO.");
      const propostas = dados.propostas || [];
      const confirmadas = propostas.map(() => false);

      // Salva a resposta do COSMO (com as propostas ainda pendentes) e
      // guarda o id da linha — é ele que a gente usa depois pra atualizar
      // `confirmadas` quando alguma proposta for confirmada.
      const { data: inserida, error: erroInsercao } = await supabase
        .from("chat_mensagens")
        .insert({ familia_id: membro.familia_id, membro_id: membro.id, autor: "cosmo", texto: dados.texto, propostas, confirmadas })
        .select()
        .single();
      if (erroInsercao) console.error("Não consegui salvar a resposta do COSMO no histórico:", erroInsercao.message);

      setMensagens((m) => [...m, { dbId: inserida?.id, autor: "cosmo", texto: dados.texto, propostas, confirmadas }]);
    } catch (e) {
      setErro(e.message || "Erro ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  // Atualiza o array `confirmadas` da mensagem salva no banco — se a
  // mensagem não tiver chegado a ser salva (erroInsercao acima), `dbId` vem
  // undefined e a gente não tenta nada (a confirmação continua valendo só
  // pra tela atual, sem quebrar nada).
  async function persistirConfirmadas(dbId, confirmadas) {
    if (!dbId) return;
    const { error } = await supabase.from("chat_mensagens").update({ confirmadas }).eq("id", dbId);
    if (error) console.error("Não consegui salvar a confirmação no histórico:", error.message);
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
    // Mesma correção aplicada antes em contas/cartões (encontrarAlvo): achar
    // por id primeiro (o jeito confiável), com o nome tolerante como reforço
    // — antes disso, um lançamento só achava a conta/cartão por
    // `.includes()` puro no nome (sem tirar acento/espaço), então bastava a
    // IA escrever o nome um pouco diferente pra o gasto ficar sem conta_id
    // NEM cartao_id nenhum — lançado, mas sem tirar de lugar nenhum, o mesmo
    // jeito silencioso de "não bateu em nada" que já resolvemos noutros
    // lugares.
    let achado = dados.pago_com_id ? opcoesPagamento.find((o) => o.id === dados.pago_com_id) : null;
    if (!achado && dados.pago_com_nome) {
      const alvo = normalizar(dados.pago_com_nome);
      achado = opcoesPagamento.find((o) => normalizar(o.nome) === alvo)
        || opcoesPagamento.find((o) => normalizar(o.nome).includes(alvo) || alvo.includes(normalizar(o.nome)));
    }
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
    const rotuloPagamento = achado ? ` (${achado.tipo === "conta" ? "de" : "no cartão"} ${achado.nome})` : "";
    return `${dados.tipo === "receita" ? "Receita lançada" : "Gasto lançado"}: ${moeda(Number(dados.valor))}${dados.descricao ? ` — ${dados.descricao}` : ""}${rotuloPagamento}`;
  }

  // Normaliza um nome pra comparação tolerante (sem acento, sem espaços
  // duplicados/nas pontas, minúsculo) — o nome que a IA reproduz de memória
  // raramente vem IDÊNTICO byte a byte ao que está no banco (um espaço a
  // mais, "Nubank" em vez de "Nubank Croma"), então um match por igualdade
  // estrita falhava silenciosamente na maior parte das vezes.
  function normalizar(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  // Acha o registro certo pra uma proposta de "atualizar_*": primeiro pelo id
  // exato (o jeito confiável — é o que o COSMO agora manda sempre que
  // encontra algo parecido), com um fallback por nome tolerante (igual, ou
  // um contém o outro) pra não quebrar se algum dia vier só o nome.
  function encontrarAlvo(lista, dados) {
    if (dados.id_existente) {
      const porId = lista.find((c) => c.id === dados.id_existente);
      if (porId) return porId;
    }
    const alvo = normalizar(dados.nome_existente || dados.nome);
    if (!alvo) return null;
    return (
      lista.find((c) => normalizar(c.nome) === alvo) ||
      lista.find((c) => normalizar(c.nome).includes(alvo) || alvo.includes(normalizar(c.nome)))
    );
  }

  // Busca os lançamentos em aberto de um cartão e separa quais caem no "mês
  // atual" da fatura (mesmo cálculo que CartaoDetalhe.jsx e a RPC
  // pagar_fatura_cartao usam) — reaproveitado tanto pra saber quais
  // lançamentos absorver quanto pra saber o valor real da fatura em aberto
  // agora (fatura_inicial + o que já foi lançado no ciclo atual), sem
  // precisar duplicar essa lógica em cada lugar que precisa dela.
  async function faturaAtualDoCartao(cartaoId, diaFechamento, faturaInicialAtual) {
    const { data: abertos, error } = await supabase
      .from("lancamentos").select("id, data, valor")
      .eq("cartao_id", cartaoId).eq("fatura_paga", false).eq("tipo", "gasto");
    const base = Number(faturaInicialAtual) || 0;
    if (error) {
      console.error("Não consegui ler os lançamentos em aberto deste cartão:", error.message);
      return { total: base, idsCicloAtual: [] };
    }
    if (!abertos || abertos.length === 0) return { total: base, idsCicloAtual: [] };
    const hojeMes = new Date().toISOString().slice(0, 7);
    const buckets = abertos.map((l) => mesDaFatura(l.data, diaFechamento));
    const mesAtual = buckets.filter((m) => m >= hojeMes).sort()[0] || hojeMes;
    const doCicloAtual = abertos.filter((_, i) => buckets[i] === mesAtual);
    const totalCicloAtual = doCicloAtual.reduce((s, l) => s + Number(l.valor), 0);
    return { total: base + totalCicloAtual, idsCicloAtual: doCicloAtual.map((l) => l.id) };
  }

  // Migração 10 ("editar tudo", 16/09/2026): antes só o dono gravava de fato
  // em contas/cartoes_credito (RLS "dono ve e mexe em tudo") — pra Alessia
  // essa proposta dava erro aqui de propósito. Isso mudou a pedido do
  // Matheus: hoje os dois papéis gravam, dentro do que cada um já enxerga
  // (RLS "familia pode editar/criar/excluir conforme visibilidade") — quem
  // tem acesso restrito só mexe no que já está marcado como visível pra
  // ela, igual em qualquer outro lugar do app.
  async function confirmarContaOuCartao(dados) {
    const acao = dados.acao;
    if (acao === "criar_conta") {
      // Rede de segurança contra duplicata: mesmo se o COSMO errar e propor
      // "criar" pra algo que já existe (foi exatamente o que causou "o
      // sistema não atualizou nada, só apareceu 1 item errado" nas rodadas
      // anteriores — a IA criava uma cópia nova em vez de atualizar a
      // conta/cartão real, e a tela de Contas continuava com os valores
      // antigos), a gente confere aqui, no navegador, se já existe algo com
      // nome parecido ANTES de inserir. Se existir, recusa com um aviso
      // claro em vez de duplicar silenciosamente.
      const parecida = encontrarAlvo(contas, { nome: dados.nome });
      if (parecida) throw new Error(`Já existe uma conta parecida com "${dados.nome}" cadastrada (chamada "${parecida.nome}") — pra não duplicar, não criei uma nova. Se era pra atualizar o saldo dela, tente de novo pedindo pro COSMO "atualizar" em vez de "cadastrar"; se são mesmo contas diferentes, use "+ Adicionar conta" direto em Contas e cartões.`);
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
      return `Conta criada: ${dados.nome} (saldo inicial ${moeda(Number(dados.saldo_inicial) || 0)})`;
    } else if (acao === "atualizar_conta") {
      const alvo = encontrarAlvo(contas, dados);
      if (!alvo) throw new Error(`Não encontrei a conta "${dados.nome_existente || dados.nome}" pra atualizar — confira em Contas e cartões se o nome bate.`);
      const patch = {};
      if (dados.nome) patch.nome = dados.nome;
      if (dados.tipo) patch.tipo = dados.tipo;
      if (dados.instituicao !== undefined) patch.instituicao = dados.instituicao || null;
      if (dados.titular !== undefined) patch.titular = dados.titular || null;
      if (dados.saldo_inicial !== undefined && dados.saldo_inicial !== null) patch.saldo_inicial = Number(dados.saldo_inicial);
      // IMPORTANTE: o Supabase/Postgrest NÃO avisa quando um "update" não
      // encontra nenhuma linha pra atualizar (isso não é um erro de RLS —
      // pra ele é só "zero linhas bateram no WHERE", e o `error` continua
      // null). Sem o `.select()` aqui, um id errado ou uma permissão que
      // barra silenciosamente a linha resultava num "salvo" mentiroso na
      // tela, com o banco intocado por baixo. Conferir `data.length` depois
      // do update é o que torna essa falha impossível de passar despercebida.
      const { data, error } = await supabase.from("contas").update(patch).eq("id", alvo.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(`A conta "${alvo.nome}" não foi atualizada — o banco não confirmou nenhuma alteração (0 linhas afetadas).`);
      return patch.saldo_inicial !== undefined
        ? `Conta atualizada: ${alvo.nome} — novo saldo ${moeda(patch.saldo_inicial)}`
        : `Conta atualizada: ${alvo.nome}`;
    } else if (acao === "criar_cartao") {
      // Mesma rede de segurança contra duplicata aplicada aos cartões — sem
      // isso, um cartão já cadastrado que a IA tentasse "criar" de novo (em
      // vez de "atualizar") virava uma cópia nova com fatura/limite errados,
      // e o cartão de verdade continuava com os valores antigos na tela.
      const parecido = encontrarAlvo(cartoes, { nome: dados.nome });
      if (parecido) throw new Error(`Já existe um cartão parecido com "${dados.nome}" cadastrado (chamado "${parecido.nome}") — pra não duplicar, não criei um novo. Se era pra atualizar o limite/fatura dele, tente de novo pedindo pro COSMO "atualizar" em vez de "cadastrar"; se são mesmo cartões diferentes, use "+ Adicionar cartão" direto em Contas e cartões.`);
      const limiteNovo = Number(dados.limite) || 0;
      const faturaNova = Number(dados.fatura_atual) || 0;
      // limite_comprometido_extra (migração 7): quando o "limite disponível"
      // informado é menor do que limite − fatura atual, a diferença é
      // compra parcelada em andamento que o app ainda não conhece (consome
      // limite mas só vira fatura mês a mês) — ver comentário completo em
      // supabase-migracao-7-limite-disponivel.sql.
      const limiteComprometidoExtra = dados.limite_disponivel != null
        ? Math.max(0, (limiteNovo - Number(dados.limite_disponivel)) - faturaNova)
        : 0;
      const { error } = await supabase.from("cartoes_credito").insert({
        familia_id: membro.familia_id,
        nome: dados.nome,
        bandeira: dados.bandeira || null,
        titular: dados.titular || null,
        limite: limiteNovo,
        dia_fechamento: dados.dia_fechamento != null ? Number(dados.dia_fechamento) : null,
        dia_vencimento: dados.dia_vencimento != null ? Number(dados.dia_vencimento) : null,
        // fatura_inicial (migração 6): a fatura que já está em aberto no
        // cartão de verdade, informada de uma vez em vez de lançar compra por
        // compra — sem isso, "fatura atual" que a pessoa manda no chat não
        // tinha campo nenhum pra ir e ficava sempre em R$ 0,00 na tela.
        fatura_inicial: faturaNova,
        limite_comprometido_extra: limiteComprometidoExtra,
        visivel_para_restrito: false,
      });
      if (error) throw error;
      const detalhesCriacao = [];
      if (dados.fatura_atual) detalhesCriacao.push(`fatura atual ${moeda(faturaNova)}`);
      if (dados.limite_disponivel != null) detalhesCriacao.push(`disponível ${moeda(Number(dados.limite_disponivel))}`);
      const detalheFatura = detalhesCriacao.length ? `, ${detalhesCriacao.join(", ")}` : "";
      return `Cartão criado: ${dados.nome} (limite ${moeda(limiteNovo)}${detalheFatura})`;
    } else if (acao === "atualizar_cartao") {
      const alvo = encontrarAlvo(cartoes, dados);
      if (!alvo) throw new Error(`Não encontrei o cartão "${dados.nome_existente || dados.nome}" pra atualizar — confira em Contas e cartões se o nome bate.`);
      const patch = {};
      if (dados.nome) patch.nome = dados.nome;
      if (dados.bandeira !== undefined) patch.bandeira = dados.bandeira || null;
      if (dados.titular !== undefined) patch.titular = dados.titular || null;
      if (dados.limite !== undefined && dados.limite !== null) patch.limite = Number(dados.limite);
      if (dados.dia_fechamento !== undefined && dados.dia_fechamento !== null) patch.dia_fechamento = Number(dados.dia_fechamento);
      if (dados.dia_vencimento !== undefined && dados.dia_vencimento !== null) patch.dia_vencimento = Number(dados.dia_vencimento);
      // fatura_atual é uma CORREÇÃO do valor em aberto (igual ao saldo_inicial
      // de uma conta), não uma soma — por isso, junto com ela, a gente marca
      // os lançamentos em aberto que já existiam nesse cartão como absorvidos
      // (fatura_paga = true), senão o valor novo informado seria somado por
      // cima dos gastos já lançados um por um, contando tudo em dobro.
      if (dados.fatura_atual !== undefined && dados.fatura_atual !== null) patch.fatura_inicial = Number(dados.fatura_atual);
      const diaFechamentoEfetivo = patch.dia_fechamento !== undefined ? patch.dia_fechamento : alvo.dia_fechamento;
      // limite_comprometido_extra (migração 7): se o usuário informou o
      // "limite disponível" real, a diferença entre isso e limite − fatura
      // atual é compra parcelada em andamento que o app ainda não conhece
      // (consome limite mas só vira fatura mês a mês) — ver comentário
      // completo em supabase-migracao-7-limite-disponivel.sql. Se fatura_atual
      // não veio nesta mensagem, busca a fatura real do ciclo atual em vez de
      // usar só o fatura_inicial antigo, pra não subestimar o comprometido.
      if (dados.limite_disponivel !== undefined && dados.limite_disponivel !== null) {
        const limiteEfetivo = patch.limite !== undefined ? patch.limite : Number(alvo.limite) || 0;
        const faturaEfetiva = patch.fatura_inicial !== undefined
          ? patch.fatura_inicial
          : (await faturaAtualDoCartao(alvo.id, diaFechamentoEfetivo, Number(alvo.fatura_inicial) || 0)).total;
        patch.limite_comprometido_extra = Math.max(0, (limiteEfetivo - Number(dados.limite_disponivel)) - faturaEfetiva);
      }
      const { data, error } = await supabase.from("cartoes_credito").update(patch).eq("id", alvo.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(`O cartão "${alvo.nome}" não foi atualizado — o banco não confirmou nenhuma alteração (0 linhas afetadas).`);
      if (patch.fatura_inicial !== undefined) {
        // Só absorve (marca como paga) a fatura do CICLO ATUAL — nunca as
        // parcelas futuras de uma compra parcelada. Cartão de crédito não é
        // uma conta de subtração simples: uma compra de R$6.000 em 10x
        // consome o limite inteiro na hora da compra, mas só a parcela do mês
        // (R$600) entra na fatura atual — as outras 9 continuam em aberto,
        // esperando o mês delas chegar. Sem esse filtro, corrigir a "fatura
        // atual" pelo chat apagaria o rastro de parcelas que ainda nem
        // venceram (o mesmo cuidado que pagar_fatura_cartao tem no banco).
        const { idsCicloAtual } = await faturaAtualDoCartao(alvo.id, diaFechamentoEfetivo, 0);
        if (idsCicloAtual.length > 0) {
          const { error: erroAbsorcao } = await supabase.from("lancamentos").update({ fatura_paga: true }).in("id", idsCicloAtual);
          if (erroAbsorcao) console.error("Não consegui absorver os lançamentos antigos da fatura deste cartão:", erroAbsorcao.message);
        }
      }
      const partes = [];
      if (patch.limite !== undefined) partes.push(`novo limite ${moeda(patch.limite)}`);
      if (patch.fatura_inicial !== undefined) partes.push(`fatura atual ${moeda(patch.fatura_inicial)}`);
      if (dados.limite_disponivel != null) partes.push(`disponível ${moeda(Number(dados.limite_disponivel))}`);
      return partes.length ? `Cartão atualizado: ${alvo.nome} — ${partes.join(", ")}` : `Cartão atualizado: ${alvo.nome}`;
    } else {
      throw new Error("Ação desconhecida na proposta.");
    }
  }

  // Acha a categoria certa numa lista (frentesGasto OU fontesReceita, já
  // mescladas por OwnerView.jsx) pra uma proposta de "atualizar/excluir": pelo
  // mesmo padrão de encontrarAlvo (chave exata primeiro, nome tolerante como
  // reforço) — a diferença é que aqui o campo se chama `chave` (não `id`) e o
  // rótulo é `label` (não `nome`), porque é assim que frentesGasto/
  // fontesReceita guardam cada item.
  function encontrarCategoria(pool, dados) {
    if (dados.chave_existente) {
      const porChave = pool.find((c) => c.chave === dados.chave_existente);
      if (porChave) return porChave;
    }
    const alvo = normalizar(dados.nome_existente || dados.nome);
    if (!alvo) return null;
    return (
      pool.find((c) => normalizar(c.label) === alvo) ||
      pool.find((c) => normalizar(c.label).includes(alvo) || alvo.includes(normalizar(c.label)))
    );
  }

  // Migração 13 ("poder total", 26/09/2026, pedido do Matheus: "Não existe
  // essa de fixas, elas devem ser editadas ou excluídas também. Poder total
  // para mim, e o COSMO."): o chat ganha o mesmo poder que a tela Categorias
  // já tem, sobre QUALQUER categoria — inclusive as 10 da doutrina financeira,
  // que deixaram de ser fixas (viraram linhas de verdade na tabela
  // `categorias`, seedadas pela migração 13). Se `alvo.id` vier vazio, é
  // porque essa família ainda não tem essa linha de verdade (a migração 13
  // ainda não rodou nela) — nesse caso a categoria continua só um fallback
  // visual, então avisa em vez de tentar um update/delete que não tem em quê
  // bater.
  async function confirmarCategoria(dados) {
    const pool = dados.tipo === "receita" ? fontesReceita : frentesGasto;
    if (dados.acao === "criar_categoria") {
      if (!dados.nome || !dados.nome.trim()) throw new Error("Preciso de um nome pra criar a categoria.");
      const parecida = encontrarCategoria(pool, { nome: dados.nome });
      if (parecida) throw new Error(`Já existe uma categoria parecida com "${dados.nome}" (chamada "${parecida.label}") — pra não duplicar, não criei uma nova. Se era pra editar ela, tente de novo pedindo pro COSMO "editar" em vez de "criar".`);
      const base = normalizarChave(dados.nome);
      const chavesExistentes = new Set(pool.map((c) => c.chave));
      let chave = base, n = 2;
      while (chavesExistentes.has(chave)) { chave = `${base}_${n}`; n++; }
      const parCor = PALETA_CORES.find((p) => p.cor.toLowerCase() === String(dados.cor || "").toLowerCase()) || PALETA_CORES[0];
      const emoji = dados.emoji || "⭐";
      const { data, error } = await supabase.from("categorias").insert({
        familia_id: membro.familia_id, tipo: dados.tipo, chave, label: dados.nome.trim(), cor: parCor.cor, cor_soft: parCor.corSoft, icone: emoji,
      }).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("A categoria não foi salva — o banco não confirmou a criação.");
      return `Categoria criada: ${dados.nome.trim()}`;
    } else if (dados.acao === "atualizar_categoria") {
      const alvo = encontrarCategoria(pool, dados);
      if (!alvo) throw new Error(`Não encontrei a categoria "${dados.nome_existente || dados.nome}" pra atualizar — confira na aba Categorias se o nome bate.`);
      if (!alvo.id) throw new Error(`A categoria "${alvo.label}" ainda não pode ser editada por aqui — falta rodar a migração 13 no banco desta família.`);
      const patch = {};
      if (dados.nome && dados.nome.trim()) patch.label = dados.nome.trim();
      if (dados.cor) {
        const parCor = PALETA_CORES.find((p) => p.cor.toLowerCase() === String(dados.cor).toLowerCase());
        patch.cor = parCor ? parCor.cor : dados.cor;
        patch.cor_soft = parCor ? parCor.corSoft : alvo.corSoft;
      }
      if (dados.emoji) patch.icone = dados.emoji;
      if (Object.keys(patch).length === 0) throw new Error(`Não veio nada pra mudar na categoria "${alvo.label}".`);
      const { data, error } = await supabase.from("categorias").update(patch).eq("id", alvo.id).select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(`A categoria "${alvo.label}" não foi atualizada — o banco não confirmou nenhuma alteração (0 linhas afetadas).`);
      return patch.label ? `Categoria atualizada: ${alvo.label} → ${patch.label}` : `Categoria atualizada: ${alvo.label}`;
    } else if (dados.acao === "excluir_categoria") {
      const alvo = encontrarCategoria(pool, dados);
      if (!alvo) throw new Error(`Não encontrei a categoria "${dados.nome_existente || dados.nome}" pra excluir — confira na aba Categorias se o nome bate.`);
      if (!alvo.id) throw new Error(`A categoria "${alvo.label}" ainda não pode ser excluída por aqui — falta rodar a migração 13 no banco desta família.`);
      const { error } = await supabase.from("categorias").delete().eq("id", alvo.id);
      if (error) throw error;
      return `Categoria excluída: ${alvo.label}`;
    } else {
      throw new Error("Ação desconhecida na proposta.");
    }
  }

  // Leva 15 (26/09/2026, pedido do Matheus: o COSMO no chat só via TOTAIS por
  // categoria — resumo_periodo — e não conseguia ajudar a reorganizar
  // lançamentos já feitos entre categorias porque não enxergava a descrição
  // de cada um. `api/chat.js` ganhou `listar_lancamentos` (ferramenta de
  // CONSULTA, executada no servidor, só chamada quando o modelo realmente
  // precisa ver o detalhe — não em toda pergunta) e esta função confirma a
  // proposta que nasce depois disso: mudar a categoria de um lançamento que
  // JÁ EXISTE (nunca cria nem apaga nada, só corrige `categoria`). O `id` vem
  // sempre de uma linha que o modelo realmente viu via listar_lancamentos —
  // o app não confia em nome/descrição pra achar o registro aqui, só no id
  // exato, exatamente como qualquer 'atualizar_*' de conta/cartão/categoria.
  async function confirmarEditarLancamento(dados) {
    if (!dados.id) throw new Error("Não veio o id do lançamento — não dá pra saber qual editar.");
    if (!dados.categoria_nova) throw new Error("Não veio a categoria nova pra esse lançamento.");
    // `.select()` de propósito, mesmo cuidado de sempre com "0 linhas
    // afetadas": um id que não existe mais, ou um membro restrito tentando
    // mudar um lançamento que não é dele (RLS: "dono edita tudo, membro edita
    // só o próprio"), retorna sucesso com 0 linhas em vez de erro.
    const { data, error } = await supabase.from("lancamentos").update({ categoria: dados.categoria_nova }).eq("id", dados.id).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Este lançamento não foi atualizado — o banco não confirmou nenhuma alteração (0 linhas afetadas; se não for seu, só o dono pode mover lançamentos de outra pessoa).");
    const pool = data[0].tipo === "receita" ? fontesReceita : frentesGasto;
    const infoNova = pool.find((c) => c.chave === dados.categoria_nova);
    const rotuloDescricao = dados.descricao ? `"${dados.descricao}"` : `lançamento de ${moeda(Number(data[0].valor))}`;
    return `${rotuloDescricao} movido pra ${infoNova?.label || dados.categoria_nova}`;
  }

  // Devolve um texto descrevendo exatamente o que aconteceu (criou ou
  // atualizou o quê, com qual valor) — é esse texto que fica gravado em
  // `confirmadas` no lugar de um `true` genérico, pra quem olha o chat depois
  // conseguir ver, item por item, se foi realmente uma ATUALIZAÇÃO da conta
  // que já existia ou uma CRIAÇÃO nova (a confusão entre as duas foi a causa
  // real do "confirmei e não mudou nada" — ver comentários acima).
  async function confirmarUma(proposta) {
    if (proposta.natureza === "lancamento") return await confirmarLancamento(proposta.dados);
    if (proposta.natureza === "categoria") return await confirmarCategoria(proposta.dados);
    if (proposta.natureza === "editar_lancamento") return await confirmarEditarLancamento(proposta.dados);
    return await confirmarContaOuCartao(proposta.dados);
  }

  // `dbId` e `confirmadasAtual` vêm de quem chama (o `.map` de `mensagens`
  // no render, sempre com o dado mais recente) em vez de ler `mensagens` de
  // dentro da função — assim não corre risco de trabalhar com um estado
  // desatualizado se a pessoa confirmar duas propostas rapidinho.
  async function confirmarItem(indiceMensagem, dbId, indiceProposta, proposta, confirmadasAtual) {
    try {
      const resultado = await confirmarUma(proposta);
      const novaConfirmadas = confirmadasAtual.slice();
      novaConfirmadas[indiceProposta] = { ok: true, texto: resultado };
      setMensagens((m) => m.map((msg, i) => (i === indiceMensagem ? { ...msg, confirmadas: novaConfirmadas } : msg)));
      persistirConfirmadas(dbId, novaConfirmadas);
      onSalvo && onSalvo();
    } catch (e) {
      alert(e.message);
    }
  }

  // Quando o COSMO devolve várias propostas de uma vez (ex: colou o saldo de
  // 9 contas numa mensagem só), clicar "Confirmar" uma por uma é cansativo e
  // fácil de esquecer alguma no meio — daí essa ação em lote, que tenta todas
  // e no final avisa exatamente quais falharam (em vez de um alert por vez
  // interrompendo o processo das que ainda iam ser confirmadas).
  async function confirmarTodas(indiceMensagem, dbId, propostas, confirmadasAtual) {
    const novaConfirmadas = confirmadasAtual.slice();
    const falhas = [];
    for (let i = 0; i < propostas.length; i++) {
      if (novaConfirmadas[i]) continue;
      try {
        const resultado = await confirmarUma(propostas[i]);
        novaConfirmadas[i] = { ok: true, texto: resultado };
        setMensagens((m) => m.map((msg, idx) => (idx === indiceMensagem ? { ...msg, confirmadas: novaConfirmadas.slice() } : msg)));
      } catch (e) {
        falhas.push(`${propostas[i].dados?.nome || propostas[i].dados?.descricao || `item ${i + 1}`}: ${e.message}`);
      }
    }
    persistirConfirmadas(dbId, novaConfirmadas);
    onSalvo && onSalvo();
    if (falhas.length > 0) {
      alert(`Algumas propostas não foram salvas:\n\n${falhas.join("\n")}`);
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
          <button key={s} onClick={() => s === "Anexar comprovante" ? inputArquivo.current?.click() : s === "Estratégia de pagamento" ? enviar(textoEstrategiaPagamento(mesFoco)) : enviar(s)} style={{ whiteSpace: "nowrap", padding: "7px 12px", borderRadius: 100, border: `1px solid ${C.lineStrong}`, background: "#fff", color: C.ink, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {carregandoHistorico && <div style={{ fontSize: 12, color: C.inkFaint }}>Carregando sua conversa com o COSMO…</div>}
        {!carregandoHistorico && mensagens.length === 0 && (
          <Bolha mensagem={{ autor: "cosmo", texto: SAUDACAO }} onConfirmar={() => {}} onConfirmarTodas={() => {}} />
        )}
        {mensagens.map((m, i) => (
          <Bolha
            key={m.dbId || i}
            mensagem={m}
            frentesGasto={frentesGasto} fontesReceita={fontesReceita}
            onConfirmar={(indiceProposta, proposta) => confirmarItem(i, m.dbId, indiceProposta, proposta, m.confirmadas)}
            onConfirmarTodas={() => confirmarTodas(i, m.dbId, m.propostas, m.confirmadas)}
          />
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

function Bolha({ mensagem, frentesGasto, fontesReceita, onConfirmar, onConfirmarTodas }) {
  const deUsuario = mensagem.autor === "usuario";
  const propostas = mensagem.propostas || [];
  const pendentes = propostas.filter((_, idx) => !mensagem.confirmadas?.[idx]).length;
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
        {propostas.length > 1 && pendentes > 1 && (
          <button onClick={onConfirmarTodas} style={{ alignSelf: "flex-start", background: C.ink, borderRadius: 10, border: "none", padding: "8px 14px", color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>
            Confirmar todas as {pendentes} propostas
          </button>
        )}
        {propostas.map((proposta, idx) => {
          const confirmada = mensagem.confirmadas?.[idx];
          if (confirmada) {
            // `confirmada` pode ser um objeto { ok, texto } (formato novo, com
            // a descrição exata do que foi feito) ou o booleano `true` de
            // confirmações salvas antes dessa mudança — nesse caso cai no
            // texto genérico de sempre, sem quebrar conversas antigas.
            const texto = (typeof confirmada === "object" && confirmada.texto) ? confirmada.texto : (proposta.natureza === "lancamento" ? "Lançado" : "Salvo");
            return <div key={idx} style={{ fontSize: 11.5, fontWeight: 700, color: C.greenTextAlt }}>✓ {texto}</div>;
          }
          if (proposta.natureza === "lancamento") return <CardProposta key={idx} dados={proposta.dados} frentesGasto={frentesGasto} fontesReceita={fontesReceita} onConfirmar={() => onConfirmar(idx, proposta)} />;
          if (proposta.natureza === "categoria") return <CardPropostaCategoria key={idx} dados={proposta.dados} onConfirmar={() => onConfirmar(idx, proposta)} />;
          if (proposta.natureza === "editar_lancamento") return <CardPropostaEditarLancamento key={idx} dados={proposta.dados} frentesGasto={frentesGasto} fontesReceita={fontesReceita} onConfirmar={() => onConfirmar(idx, proposta)} />;
          return <CardPropostaContaOuCartao key={idx} dados={proposta.dados} onConfirmar={() => onConfirmar(idx, proposta)} />;
        })}
        {propostas.length > 1 && pendentes === 0 && (
          <div style={{ fontSize: 11.5, fontWeight: 800, color: C.greenTextAlt, background: C.greenBg || "rgba(0,0,0,0.03)", borderRadius: 10, padding: "8px 12px" }}>
            ✅ Tudo aplicado — as {propostas.length} propostas desta mensagem já foram confirmadas.
          </div>
        )}
      </div>
    </div>
  );
}

function CardProposta({ dados, frentesGasto, fontesReceita, onConfirmar }) {
  const info = (dados.tipo === "receita" ? fontesReceita : frentesGasto).find((f) => f.chave === dados.categoria);
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
      {ehCartao && dados.fatura_atual != null && <Linha label="Fatura atual" valor={moeda(dados.fatura_atual)} />}
      {ehCartao && dados.limite_disponivel != null && <Linha label="Disponível" valor={moeda(dados.limite_disponivel)} />}
      {ehCartao && dados.dia_fechamento != null && <Linha label="Fechamento" valor={`dia ${dados.dia_fechamento}`} />}
      {ehCartao && dados.dia_vencimento != null && <Linha label="Vencimento" valor={`dia ${dados.dia_vencimento}`} />}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onConfirmar} style={{ flex: 1, background: C.accent, borderRadius: 10, border: "none", padding: "9px 0", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Confirmar e salvar</button>
      </div>
    </div>
  );
}

const ROTULO_ACAO_CATEGORIA = {
  criar_categoria: "Nova categoria",
  atualizar_categoria: "Editar categoria",
  excluir_categoria: "Excluir categoria",
};

function CardPropostaCategoria({ dados, onConfirmar }) {
  const excluindo = dados.acao === "excluir_categoria";
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${C.accentSoft}`, borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase" }}>{ROTULO_ACAO_CATEGORIA[dados.acao] || "Proposta"}</span>
        {dados.emoji && <span style={{ fontSize: 18 }}>{dados.emoji}</span>}
      </div>
      <div style={{ height: 1, background: C.line }} />
      <Linha label="Categoria" valor={dados.nome || dados.nome_existente || dados.chave_existente} />
      {dados.nome_existente && dados.nome && dados.nome_existente !== dados.nome && <Linha label="Nome atual" valor={dados.nome_existente} />}
      <Linha label="Tipo" valor={dados.tipo === "receita" ? "Receita (fonte)" : "Gasto (frente)"} />
      {dados.cor && <Linha label="Cor" valor={dados.cor} />}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onConfirmar} style={{ flex: 1, background: excluindo ? (C.danger || "#E24141") : C.accent, borderRadius: 10, border: "none", padding: "9px 0", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
          {excluindo ? "Confirmar exclusão" : "Confirmar e salvar"}
        </button>
      </div>
    </div>
  );
}

// Leva 15 — proposta de mover um lançamento JÁ EXISTENTE de categoria (nasce
// depois do COSMO usar listar_lancamentos pra ver o detalhe de cada um e
// decidir quais devem mudar). `frentesGasto`/`fontesReceita` resolvem o
// RÓTULO das chaves (o modelo manda a chave crua em `categoria_atual`/
// `categoria_nova`) — procura nas duas listas porque o card não sabe de
// antemão se é gasto ou receita antes de achar a categoria nova.
function CardPropostaEditarLancamento({ dados, frentesGasto, fontesReceita, onConfirmar }) {
  const todasCategorias = [...frentesGasto, ...fontesReceita];
  const rotulo = (chave) => todasCategorias.find((c) => c.chave === chave)?.label || chave || "?";
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${C.accentSoft}`, borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase" }}>Mover categoria</span>
        {dados.valor != null && <span style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{moeda(dados.valor)}</span>}
      </div>
      <div style={{ height: 1, background: C.line }} />
      {dados.descricao && <Linha label="Lançamento" valor={dados.descricao} />}
      <Linha label="De" valor={rotulo(dados.categoria_atual)} />
      <Linha label="Para" valor={rotulo(dados.categoria_nova)} />
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={onConfirmar} style={{ flex: 1, background: C.accent, borderRadius: 10, border: "none", padding: "9px 0", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Confirmar</button>
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
