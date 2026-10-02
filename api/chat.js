// Função serverless da Vercel — o "COSMO, versão financeira" que aparece no
// chat dentro do próprio Correa Cash. Importante por design: esta função
// NUNCA grava um lançamento no banco. Ela só CONVERSA e, quando entende que o
// usuário quer lançar algo (por texto ou por foto de comprovante), devolve
// uma PROPOSTA estruturada — quem confirma e realmente insere é o navegador,
// chamando o Supabase direto (mesmo caminho de sempre, protegido por RLS),
// só depois que a pessoa aperta "Confirmar e lançar". Isso está documentado
// assim de propósito: nada vindo de chat ou arquivo é lançado sozinho.
//
// Autenticação: o navegador manda o token de sessão do Supabase no header
// Authorization. Esta função cria um cliente Supabase COM ESSE TOKEN (não a
// service_role key), então toda consulta aqui dentro já respeita as mesmas
// políticas de RLS que o resto do app usa — um membro restrito não consegue
// pedir pro chat mostrar o que não teria permissão de ver na tela normal.
//
// Variáveis de ambiente necessárias na Vercel deste projeto (Cash App):
//   SUPABASE_URL          = a mesma Project URL do .env do front-end
//   SUPABASE_ANON_KEY      = a mesma anon key do .env do front-end (pública)
//   ANTHROPIC_API_KEY      = sua chave da API da Anthropic (console.anthropic.com)

import { createClient } from "@supabase/supabase-js";

const MODELO = "claude-sonnet-4-6";

// Migração 10 (categorias personalizadas, 16/09/2026): antes a descrição de
// "categoria" era um texto fixo com as 6 frentes de gasto e 4 fontes de
// receita da doutrina financeira do COSMO — agora ela é montada por família,
// incluindo também as categorias que a própria família criou na tela
// "Categorias" (ver categoriasResumo, mandado pelo ChatCosmo.jsx junto com
// contasResumo/cartoesResumo).
function montarFerramentas(categoriasResumo) {
  const chavesGasto = categoriasResumo?.gasto?.length
    ? categoriasResumo.gasto.map((c) => c.chave).join(", ")
    : "dia_a_dia, recorrentes, reserva, projetos, casa_familia, saude";
  const chavesReceita = categoriasResumo?.receita?.length
    ? categoriasResumo.receita.map((c) => c.chave).join(", ")
    : "trabalho, correa_books, freelas, outros";
  return [
  {
    name: "propor_lancamento",
    description: "Monta uma PROPOSTA de lançamento (gasto ou receita) a partir do que o usuário descreveu ou de uma foto de comprovante. Não grava nada — só propõe, pra pessoa confirmar na tela.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["gasto", "receita"] },
        categoria: { type: "string", description: `Para gasto, uma de: ${chavesGasto}. Para receita, uma de: ${chavesReceita}. Essas são as categorias já cadastradas nesta família (fixas + criadas por ela) — use a chave EXATA da lista. Se nada encaixar bem, use a mais próxima; não invente uma chave nova.` },
        valor: { type: "number" },
        descricao: { type: "string" },
        data: { type: "string", description: "Data no formato YYYY-MM-DD. Se não tiver certeza, use a data de hoje." },
        pago_com_nome: { type: "string", description: "Nome da conta ou cartão mencionado (ex: 'Nubank', 'Inter'), se souber. Deixe vazio se não souber." },
        pago_com_id: { type: "string", description: "O id EXATO (copie de [id: ...] na lista de contas/cartões que você já viu) da conta ou cartão usado — se você souber qual é, SEMPRE inclua isto junto com pago_com_nome, é assim que o app encontra o registro certo (o nome sozinho pode não bater)." },
      },
      required: ["tipo", "categoria", "valor"],
    },
  },
  {
    name: "propor_conta_ou_cartao",
    description: "Monta uma PROPOSTA pra criar ou atualizar uma conta bancária, carteira física, ou cartão de crédito — use quando o usuário informar saldos atuais, um cartão/conta novo, ou mudanças em limite/fatura/dados de uma conta ou cartão que já existe. Não grava nada — só propõe, a pessoa confirma na tela. Se o usuário mandar várias contas/cartões de uma vez (ex: uma lista de saldos), chame esta ferramenta VÁRIAS VEZES em paralelo, uma proposta por conta/cartão — não junte tudo numa só chamada.",
    input_schema: {
      type: "object",
      properties: {
        acao: { type: "string", enum: ["criar_conta", "atualizar_conta", "criar_cartao", "atualizar_cartao"], description: "atualizar_* é quando já existe uma conta/cartão parecido na lista que você viu; criar_* quando não existe ainda." },
        id_existente: { type: "string", description: "Só pra 'atualizar_*': o campo 'id' EXATO (copie-o exatamente, é um código, não um nome) da conta/cartão já existente, conforme a lista de contas/cartões que você já viu. Isso é o que o app usa pra achar o registro certo — sempre que for atualizar algo que já existe, inclua este campo." },
        nome_existente: { type: "string", description: "Só pra 'atualizar_*': o nome da conta/cartão já existente, como referência (o app usa id_existente pra achar o registro; isto é só pra exibição)." },
        nome: { type: "string", description: "Nome da conta/cartão (novo, ou o nome atualizado)." },
        tipo: { type: "string", enum: ["corrente", "poupanca", "carteira", "outro"], description: "Só pra contas. 'carteira' é dinheiro físico." },
        instituicao: { type: "string", description: "Só pra contas (ex: Nubank, Inter, Banco do Brasil, Mercado Pago, Revolut). Deixe vazio se for carteira física." },
        bandeira: { type: "string", description: "Só pra cartões (ex: Visa, Mastercard, Nubank)." },
        titular: { type: "string", description: "De quem é a conta/cartão (ex: Matheus, Alessia)." },
        saldo_inicial: { type: "number", description: "Só pra contas — o saldo de hoje, o ponto de partida a partir de agora." },
        limite: { type: "number", description: "Só pra cartões — limite total." },
        dia_fechamento: { type: "number", description: "Só pra cartões — dia do mês que a fatura fecha." },
        dia_vencimento: { type: "number", description: "Só pra cartões — dia do mês que a fatura vence." },
        fatura_atual: { type: "number", description: "Só pra cartões — o valor da fatura do CICLO ATUAL em aberto AGORA (o que vence agora/no próximo vencimento), se o usuário informar (ex: 'fatura atual: 2.784,54'). Isso SUBSTITUI o valor da fatura atual conhecida pelo app (é uma correção do estado real, igual ao saldo_inicial de uma conta) — não é somado a compras já lançadas uma por uma. IMPORTANTE: isto NÃO serve pra registrar uma compra parcelada (ex: 'comprei algo de 6000 em 10x') — uma compra parcelada consome o limite inteiro na hora mas só uma parcela aparece na fatura por mês, e isso só pode ser lançado pela tela 'Novo lançamento' no app (não existe essa ação pelo chat ainda); se o usuário mencionar parcelas, explique isso em vez de usar fatura_atual. Deixe vazio se o usuário não mencionar a fatura." },
        limite_disponivel: { type: "number", description: "Só pra cartões — o valor REAL do limite disponível AGORA, se o usuário informar (ex: 'limite disponível: 3.209,15'). SEMPRE inclua este campo quando o usuário mandar esse número, mesmo junto com limite e fatura_atual — NÃO é redundante: o disponível real do banco costuma ser menor que 'limite − fatura atual' quando existem compras parceladas em andamento que ainda não apareceram na fatura (elas já consomem o limite, mas só entram na fatura mês a mês). O app usa a diferença pra saber quanto do limite está preso nessas parcelas futuras que ele ainda não conhece uma por uma." },
      },
      required: ["acao"],
    },
  },
  {
    name: "propor_categoria",
    description: "Monta uma PROPOSTA pra criar, editar ou excluir uma categoria (frente de gasto ou fonte de receita) — use quando o usuário pedir pra criar uma categoria nova, renomear/trocar cor ou emoji de uma que já existe, ou excluir uma. Isso vale pra QUALQUER categoria, inclusive as da doutrina financeira do COSMO (dia_a_dia, recorrentes, reserva, projetos, casa_familia, saude, trabalho, correa_books, freelas, outros) — elas não são mais fixas, também podem ser editadas ou excluídas. Não grava nada — só propõe, a pessoa confirma na tela.",
    input_schema: {
      type: "object",
      properties: {
        acao: { type: "string", enum: ["criar_categoria", "atualizar_categoria", "excluir_categoria"] },
        tipo: { type: "string", enum: ["gasto", "receita"], description: "Obrigatório sempre — de qual lista (frentes de gasto ou fontes de receita) é essa categoria." },
        chave_existente: { type: "string", description: "Só pra 'atualizar_categoria'/'excluir_categoria': a chave EXATA da categoria já existente (ex: dia_a_dia, saude, ou a chave de uma personalizada), conforme a lista de categorias que você já viu. É o que o app usa pra achar o registro certo." },
        nome_existente: { type: "string", description: "Só pra 'atualizar_categoria'/'excluir_categoria': o rótulo da categoria já existente, como referência (o app usa chave_existente pra achar o registro; isto é só pra exibição)." },
        nome: { type: "string", description: "Nome/rótulo da categoria (novo, ou o nome atualizado). Obrigatório pra criar_categoria e atualizar_categoria." },
        cor: { type: "string", description: "Cor em hexadecimal (ex: #0469FB), se o usuário pedir uma cor específica. Deixe vazio para o app escolher uma cor padrão." },
        emoji: { type: "string", description: "Um emoji pra representar a categoria, se o usuário sugerir um ou for óbvio pelo nome (ex: 🛒 pra mercado). Deixe vazio para o app escolher um emoji padrão." },
      },
      required: ["acao", "tipo"],
    },
  },
  {
    name: "resumo_periodo",
    description: "Consulta os lançamentos reais da família num período pra responder perguntas analíticas (quanto gastei em X, como estão as finanças, etc). Use antes de responder qualquer pergunta sobre números reais — nunca invente valores. Devolve só TOTAIS agregados (não lançamento por lançamento) — pra ver o detalhe de cada lançamento individual (descrição, valor), use listar_lancamentos em vez desta.",
    input_schema: {
      type: "object",
      properties: {
        categoria: { type: "string", description: "Filtrar por categoria/frente específica. Deixe vazio para todas." },
        tipo: { type: "string", enum: ["gasto", "receita", "ambos"] },
        dias: { type: "number", description: "Quantos dias pra trás considerar, a partir de hoje. Padrão 30." },
      },
    },
  },
  {
    name: "listar_lancamentos",
    description: "Devolve a lista de lançamentos reais (id, descrição, valor, data, categoria) de um período — use quando precisar ver o DETALHE individual de cada lançamento, não só o total. Isso é o caso, por exemplo, quando o usuário quer reorganizar/mover lançamentos que estão numa categoria genérica pra categorias mais específicas (ex: separar 'mercado' e 'combustível' de dentro de 'Dia a dia'): chame isto filtrando pela categoria genérica, olhe a descrição de cada lançamento devolvido, decida qual categoria nova combina com cada um, e proponha a mudança com propor_editar_lancamento — um por lançamento que precisa mudar. NÃO chame isto pra perguntas simples de total (ex: 'quanto eu gastei em X') — aí use resumo_periodo, que é mais leve.",
    input_schema: {
      type: "object",
      properties: {
        categoria: { type: "string", description: "Filtrar por uma categoria/frente específica (chave exata). Deixe vazio pra trazer de todas as categorias." },
        tipo: { type: "string", enum: ["gasto", "receita", "ambos"] },
        dias: { type: "number", description: "Quantos dias pra trás considerar, a partir de hoje. Padrão 90 (mais generoso que resumo_periodo — reorganizar costuma envolver lançamentos de alguns meses atrás)." },
      },
    },
  },
  {
    name: "propor_editar_lancamento",
    description: "Monta uma PROPOSTA pra mudar a categoria de um lançamento JÁ EXISTENTE (não cria um novo) — use depois de ver o lançamento via listar_lancamentos (ou resumo_periodo/a conversa) e decidir que ele deveria estar em outra categoria. Se o usuário quiser reorganizar vários lançamentos de uma vez, chame esta ferramenta VÁRIAS VEZES em paralelo, uma por lançamento — não junte tudo numa proposta só. Só muda a categoria; não serve pra corrigir valor/descrição/data (isso ainda só é feito pela tela, em Gastos/Receitas → editar). Não grava nada — só propõe, a pessoa confirma na tela (ou confirma todas de uma vez, se vierem várias).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "O id EXATO do lançamento (copiado da lista devolvida por listar_lancamentos) — é isso que o app usa pra achar o registro certo, não a descrição." },
        categoria_nova: { type: "string", description: "A chave EXATA da categoria nova (de gasto ou de receita, conforme o tipo do lançamento) — use a lista de categorias desta família." },
        categoria_atual: { type: "string", description: "A chave da categoria atual dele, como referência (só pra mostrar 'de X pra Y' na tela de confirmação — o app usa 'id' pra achar o registro, não isto)." },
        descricao: { type: "string", description: "A descrição do lançamento, como referência (só pra exibição)." },
        valor: { type: "number", description: "O valor do lançamento, como referência (só pra exibição)." },
      },
      required: ["id", "categoria_nova"],
    },
  },
  {
    name: "planejamento_do_mes",
    description: "Devolve o Planejamento financeiro (lista de boletos/contas previstas) do mês atual, do próximo e do mês que a pessoa estava olhando: cada item com dia de vencimento, valor previsto, se o valor é aproximado e se já foi pago. Use pra qualquer pergunta sobre o que falta pagar, vencimentos ou estratégia de pagamento. Só consulta — não grava nada.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "situacao_financeira_agora",
    description: "Devolve o saldo REAL de cada conta/carteira agora e, de cada cartão de crédito, a fatura do ciclo atual, o total das faturas dos próximos meses (parcelas e compras já lançadas) e o dia de vencimento. Use junto com planejamento_do_mes pra montar estratégia de pagamento (o que o dinheiro disponível cobre e até quando). Só consulta — não grava nada.",
    input_schema: { type: "object", properties: {} },
  },
  ];
}

function montarSystemPrompt(contasResumo, cartoesResumo, categoriasResumo, hoje) {
  const listaContas = (contasResumo || []).length
    ? (contasResumo || []).map((c) => `- [id: ${c.id}] ${c.nome} (${c.tipo}${c.instituicao ? `, ${c.instituicao}` : ""}${c.titular ? `, de ${c.titular}` : ""})`).join("\n")
    : "(nenhuma conta cadastrada ainda)";
  const listaCartoes = (cartoesResumo || []).length
    ? (cartoesResumo || []).map((k) => `- [id: ${k.id}] ${k.nome} (${k.bandeira || "?"}${k.titular ? `, de ${k.titular}` : ""})`).join("\n")
    : "(nenhum cartão cadastrado ainda)";
  // categoriasResumo (migração 10, 16/09/2026) já vem mesclando as categorias
  // fixas da doutrina financeira com as que a própria família criou — só pra
  // deixar claro no prompt o RÓTULO de cada chave (a ferramenta já lista as
  // chaves aceitas; isto aqui ajuda o modelo a entender o que cada uma
  // significa, principalmente as personalizadas).
  const listaCategoriasGasto = (categoriasResumo?.gasto || []).map((c) => `${c.chave} (${c.label})`).join(", ") || "dia_a_dia, recorrentes, reserva, projetos, casa_familia, saude";
  const listaCategoriasReceita = (categoriasResumo?.receita || []).map((c) => `${c.chave} (${c.label})`).join(", ") || "trabalho, correa_books, freelas, outros";

  return `Você é o COSMO, na sua versão focada em finanças, dentro do app Correa Cash — o app financeiro de um casal (Matheus e Alessia). Hoje é ${hoje}. Seu papel: ajudar a lançar gastos/receitas, ajudar a configurar contas/carteiras/cartões, e responder perguntas sobre as finanças do casal usando dados reais (nunca invente números — use a ferramenta resumo_periodo). Você NUNCA grava nada sozinho — toda ação (lançamento, conta, cartão) é sempre uma PROPOSTA que a pessoa confirma na tela, sem exceção.

Contas/carteiras já cadastradas nesta família:
${listaContas}

Cartões de crédito já cadastrados nesta família:
${listaCartoes}

Categorias de gasto desta família (fixas + personalizadas): ${listaCategoriasGasto}
Categorias de receita desta família (fixas + personalizadas): ${listaCategoriasReceita}

Regras importantes:
- Se o usuário descrever uma compra, pagamento, PIX recebido, ou mandar uma foto de comprovante: chame propor_lancamento com os dados que conseguir extrair. Se ele mencionar com qual conta ou cartão pagou (ou for óbvio pelo contexto), inclua também o pago_com_id copiado da lista de contas/cartões acima — sem isso, o app pode não conseguir identificar a conta/cartão certo só pelo nome, e o lançamento fica sem tirar de lugar nenhum. Nunca diga que "já lançou" — apenas proponha.
- Se o usuário pedir pra criar, renomear, trocar cor/emoji, ou excluir uma categoria: chame propor_categoria. Isso vale pra QUALQUER categoria — as 10 da doutrina financeira listadas acima não são fixas, também podem ser editadas ou excluídas, por você ou pela pessoa direto na tela "Categorias". Pra editar/excluir uma que já existe, sempre inclua chave_existente copiada EXATAMENTE da lista de categorias acima (é assim que o app acha o registro certo — não é por nome).
- Se o usuário informar saldos de contas/carteiras, um cartão novo, ou mudanças em limite/fatura/dados de uma conta ou cartão (olhe a lista acima pra saber se já existe): chame propor_conta_ou_cartao. Se vier mais de uma conta/cartão na mesma mensagem, chame a ferramenta várias vezes em paralelo, uma por conta/cartão — nunca junte várias contas numa proposta só. NUNCA pule nenhum item da lista que o usuário mandou, mesmo que sejam 5, 10 ou mais — cada conta/cartão mencionado vira uma chamada de ferramenta própria.
- Ao decidir 'criar_conta/cartao' vs 'atualizar_conta/cartao', compare com a lista acima (por nome, mesmo que o usuário não escreva exatamente igual — "Nubank" no texto do usuário deve casar com "Nubank Croma" da lista, por exemplo) — se já existe algo parecido, use 'atualizar_*' e SEMPRE inclua id_existente copiado EXATAMENTE do campo [id: ...] correspondente da lista acima (é assim que o app encontra o registro certo — não é feito por nome). Só use 'criar_*' quando realmente não existir nada parecido na lista.
- Sobre cartão de crédito: se o usuário mandar "limite total", "limite disponível" e "fatura atual" juntos, use limite pro limite total, fatura_atual pro valor da fatura, e limite_disponivel pro valor disponível — os três são úteis e devem ser incluídos quando informados. NÃO assuma que "disponível" é sempre igual a "limite menos fatura atual": quando o usuário tem compras parceladas em andamento, o disponível real é menor do que essa conta simples, porque o limite já foi consumido pelas parcelas futuras mesmo elas ainda não aparecendo na fatura — é exatamente por isso que limite_disponivel existe como campo próprio, pra o app calcular essa diferença.
- Cartão de crédito não é uma conta de subtração simples: uma compra parcelada (ex: "comprei um item de 6000 em 10x") consome o LIMITE inteiro na hora da compra, mas só uma parcela entra na fatura de cada mês. Isso ainda não pode ser lançado pelo chat — só pela tela "Novo lançamento" no app, que já sabe dividir e espalhar as parcelas certas pelos meses. Se o usuário descrever uma compra parcelada, não use propor_lancamento nem fatura_atual pra isso — explique que esse tipo de lançamento precisa ser feito em "Novo lançamento" no app.
- Se o usuário perguntar algo sobre os próprios números (quanto gastou, como está o orçamento, etc): chame resumo_periodo primeiro, depois responda com base no resultado real.
- Se o usuário quiser reorganizar/revisar lançamentos que já foram feitos — por exemplo, separar compras de "mercado" e "combustível" que hoje estão misturadas dentro de "Dia a dia" — chame listar_lancamentos filtrando pela categoria genérica (não peça isso de cara em toda pergunta, só quando for realmente necessário ver a descrição individual de cada lançamento). Depois de ver a lista, decida a categoria nova de cada um pela descrição e chame propor_editar_lancamento uma vez pra CADA lançamento que deve mudar, em paralelo (mesma lógica de propor_conta_ou_cartao) — nunca invente ou edite um lançamento que você não viu na lista.
- Se o usuário pedir ESTRATÉGIA DE PAGAMENTO (em que ordem pagar, o que priorizar, se o saldo cobre, o que fazer se não cobrir): chame planejamento_do_mes E situacao_financeira_agora, as duas na mesma rodada, e raciocine só com os números que elas devolverem. Considere apenas itens NÃO pagos. Ordene por dia de vencimento; no mês atual, o que tem dia anterior a hoje já está ATRASADO e vem primeiro. Itens SEM dia_vencimento são coisas pessoais, sem data de verdade: trate como flexíveis — vão por último, só se sobrar saldo, e nunca como atrasados. Compare a soma acumulada do que vence com o saldo das contas e diga em que data o saldo deixa de cobrir e quanto falta. Valores marcados como aproximados são estimativa — avise. A fatura de cartão entra como compromisso no dia de vencimento dela, mas se um item do planejamento já representa a mesma fatura/parcela, não some duas vezes (diga a dúvida em vez de adivinhar). Você não sabe quando entra dinheiro novo (salário etc.): não invente, e se faltar saldo pergunte se há entrada prevista antes da data crítica. Formato: ordem sugerida em lista curta (data · item · valor), depois o ponto de atenção, e no máximo uma pergunta. Escreva em texto simples (o chat não formata markdown: nada de ** ou #; use traços e quebras de linha). Você não paga nem marca nada — só orienta.
- Seja direto, caloroso e breve — poucas frases, sem enrolação.
- Nunca dê conselho financeiro genérico não pedido; foque em ajudar com o que foi perguntado.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!apiKey || !supabaseUrl || !anonKey) {
    return res.status(503).json({ error: "Chat ainda não configurado (faltam variáveis de ambiente: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Não autenticado." });

  const { mensagem, imagemBase64, imagemMimeType, contasResumo, cartoesResumo, categoriasResumo, planejamentoResumo, hoje: hojeCliente } = req.body || {};
  // "Hoje" vem do navegador (fuso de quem usa); sem isso, a data do servidor.
  const hoje = /^\d{4}-\d{2}-\d{2}$/.test(hojeCliente || "") ? hojeCliente : new Date().toISOString().slice(0, 10);
  if (!mensagem && !imagemBase64) return res.status(400).json({ error: "Envie uma mensagem ou uma imagem." });

  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });

  async function executarFerramenta(nome, entrada) {
    if (nome === "propor_lancamento") {
      // Não grava nada — devolve a própria proposta pra virar a "resposta final".
      return { proposta: entrada };
    }
    if (nome === "resumo_periodo") {
      const dias = entrada.dias || 30;
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let query = supabase.from("lancamentos").select("tipo, categoria, valor, data").gte("data", desde);
      if (entrada.categoria) query = query.eq("categoria", entrada.categoria);
      if (entrada.tipo && entrada.tipo !== "ambos") query = query.eq("tipo", entrada.tipo);
      const { data, error } = await query;
      if (error) return { erro: error.message };
      const totalGasto = (data || []).filter((l) => l.tipo === "gasto").reduce((s, l) => s + Number(l.valor), 0);
      const totalReceita = (data || []).filter((l) => l.tipo === "receita").reduce((s, l) => s + Number(l.valor), 0);
      return { periodo_dias: dias, total_gasto: totalGasto, total_receita: totalReceita, quantidade_lancamentos: (data || []).length };
    }
    if (nome === "listar_lancamentos") {
      const LIMITE = 120;
      const dias = entrada.dias || 90;
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let query = supabase.from("lancamentos").select("id, tipo, categoria, descricao, valor, data").gte("data", desde).order("data", { ascending: false }).limit(LIMITE);
      if (entrada.categoria) query = query.eq("categoria", entrada.categoria);
      if (entrada.tipo && entrada.tipo !== "ambos") query = query.eq("tipo", entrada.tipo);
      const { data, error } = await query;
      if (error) return { erro: error.message };
      const lista = (data || []).map((l) => ({ id: l.id, tipo: l.tipo, categoria: l.categoria, descricao: l.descricao || "(sem descrição)", valor: Number(l.valor), data: l.data }));
      const resultado = { lancamentos: lista, quantidade: lista.length };
      // Aviso explícito se bateu no teto — pra o modelo não achar, por engano,
      // que viu TODOS os lançamentos do período quando na verdade só viu os
      // 120 mais recentes.
      if (lista.length >= LIMITE) resultado.aviso = `Lista limitada aos ${LIMITE} lançamentos mais recentes do período — pode haver mais além destes.`;
      return resultado;
    }
    if (nome === "planejamento_do_mes") {
      if (!Array.isArray(planejamentoResumo) || planejamentoResumo.length === 0) return { erro: "O app não enviou o planejamento nesta mensagem." };
      return {
        hoje,
        meses: planejamentoResumo,
        legenda: "dia_vencimento null = sem data (coisa pessoal, sem vencimento fixo). valor_previsto null = ainda sem valor definido. valor_aproximado true = estimativa, não o valor real do boleto. pago true = já quitado.",
      };
    }
    if (nome === "situacao_financeira_agora") {
      const [rSaldos, rContas, rCartoes, rAbertos] = await Promise.all([
        supabase.rpc("saldos_contas"),
        supabase.from("contas").select("id, nome, tipo, instituicao"),
        supabase.from("cartoes_credito").select("id, nome, limite, dia_fechamento, dia_vencimento, fatura_inicial"),
        supabase.from("lancamentos").select("cartao_id, valor, data").eq("fatura_paga", false).eq("tipo", "gasto").not("cartao_id", "is", null),
      ]);
      const erro = rSaldos.error || rContas.error || rCartoes.error || rAbertos.error;
      if (erro) return { erro: erro.message };
      const saldoPorConta = new Map((rSaldos.data || []).map((r) => [r.conta_id, Number(r.saldo)]));
      const contas = (rContas.data || []).filter((c) => saldoPorConta.has(c.id)).map((c) => ({ nome: c.nome, tipo: c.tipo, instituicao: c.instituicao || null, saldo: saldoPorConta.get(c.id) }));
      const saldoTotal = contas.reduce((s, c) => s + c.saldo, 0);
      const hojeMes = hoje.slice(0, 7);
      // Mesma regra de theme.js (mesDaFatura): compra depois do fechamento cai na fatura do mês seguinte.
      const mesDaFatura = (dataISO, diaFech) => {
        const [ano, mes, dia] = dataISO.split("-").map(Number);
        if (!diaFech || dia <= diaFech) return `${ano}-${String(mes).padStart(2, "0")}`;
        const d = new Date(Date.UTC(ano, mes, 1));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      };
      const cartoes = (rCartoes.data || []).map((k) => {
        const abertos = (rAbertos.data || []).filter((l) => l.cartao_id === k.id);
        const buckets = abertos.map((l) => mesDaFatura(l.data, k.dia_fechamento));
        const mesAtual = buckets.filter((m) => m >= hojeMes).sort()[0] || hojeMes;
        const fatura = abertos.filter((_, i) => buckets[i] === mesAtual).reduce((s, l) => s + Number(l.valor), 0) + Number(k.fatura_inicial || 0);
        // Todas as faturas em aberto, mês a mês (parcelas futuras e compras já lançadas/importadas por OFX).
        const porMes = {};
        abertos.forEach((l, i) => { porMes[buckets[i]] = (porMes[buckets[i]] || 0) + Number(l.valor); });
        porMes[mesAtual] = (porMes[mesAtual] || 0) + Number(k.fatura_inicial || 0);
        const faturas_por_mes = Object.entries(porMes).filter(([m]) => m >= hojeMes).sort(([a], [b]) => a.localeCompare(b)).map(([mes, total]) => ({ mes, total }));
        return { nome: k.nome, fatura_do_ciclo_atual: fatura, mes_da_fatura: mesAtual, faturas_por_mes, dia_vencimento: k.dia_vencimento ?? null, dia_fechamento: k.dia_fechamento ?? null };
      });
      return { hoje, saldo_total_em_contas: saldoTotal, contas, cartoes, observacao: "faturas_por_mes soma só o que já está lançado no app (compras e parcelas, inclusive as importadas por OFX). Compras futuras ainda não feitas não existem aqui." };
    }
    return { erro: "ferramenta desconhecida" };
  }

  const conteudoUsuario = [];
  if (mensagem) conteudoUsuario.push({ type: "text", text: mensagem });
  if (imagemBase64) {
    conteudoUsuario.push({ type: "image", source: { type: "base64", media_type: imagemMimeType || "image/jpeg", data: imagemBase64 } });
    if (!mensagem) conteudoUsuario.push({ type: "text", text: "Leia este comprovante e proponha o lançamento correspondente." });
  }

  const mensagens = [{ role: "user", content: conteudoUsuario }];

  const systemPrompt = montarSystemPrompt(contasResumo, cartoesResumo, categoriasResumo, hoje);
  const ferramentas = montarFerramentas(categoriasResumo);
  const NOMES_FERRAMENTAS_PROPOSTA = new Set(["propor_lancamento", "propor_conta_ou_cartao", "propor_categoria", "propor_editar_lancamento"]);
  const NATUREZA_POR_FERRAMENTA = { propor_lancamento: "lancamento", propor_conta_ou_cartao: "conta_ou_cartao", propor_categoria: "categoria", propor_editar_lancamento: "editar_lancamento" };

  try {
    let propostas = [];
    let textoFinal = "";

    for (let volta = 0; volta < 3; volta++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        // max_tokens generoso de propósito: quando o usuário manda uma lista
        // grande de contas/cartões de uma vez, o modelo precisa de espaço pra
        // devolver MUITAS chamadas de ferramenta em paralelo (uma por item) na
        // mesma resposta. Com um limite baixo, a resposta cortava no meio e
        // sobravam só 1 ou 2 propostas (ou uma incompleta) em vez de todas.
        body: JSON.stringify({ model: MODELO, max_tokens: 8192, system: systemPrompt, tools: ferramentas, messages: mensagens }),
      });
      if (!resp.ok) {
        const detalhe = await resp.text();
        return res.status(502).json({ error: "Erro ao falar com o modelo.", detalhe });
      }
      const dados = await resp.json();
      const blocosTexto = (dados.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const blocosFerramenta = (dados.content || []).filter((b) => b.type === "tool_use");

      if (blocosFerramenta.length === 0) {
        textoFinal = blocosTexto;
        break;
      }

      // Uma ou mais propostas na mesma rodada (ex: o usuário mandou o saldo de
      // 7 contas de uma vez) — pegamos TODAS, nunca só a primeira, e paramos
      // aqui: proposta é sempre o fim da conversa, quem decide é a pessoa.
      const blocosProposta = blocosFerramenta.filter((b) => NOMES_FERRAMENTAS_PROPOSTA.has(b.name));
      if (blocosProposta.length > 0) {
        propostas = blocosProposta.map((b) => ({
          natureza: NATUREZA_POR_FERRAMENTA[b.name] || "lancamento",
          dados: b.input,
        }));
        textoFinal = blocosTexto || (propostas.length > 1 ? `Preparei ${propostas.length} propostas — confere pra mim?` : "Confere pra mim?");
        break;
      }

      // Só ferramentas de consulta nessa rodada (ex: resumo_periodo) — executa
      // todas e devolve os resultados, a conversa continua.
      const resultados = await Promise.all(
        blocosFerramenta.map(async (b) => ({ id: b.id, resultado: await executarFerramenta(b.name, b.input) }))
      );
      mensagens.push({ role: "assistant", content: dados.content });
      mensagens.push({
        role: "user",
        content: resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.resultado) })),
      });
    }

    return res.status(200).json({ texto: textoFinal, propostas });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno", detalhe: String(e) });
  }
}
