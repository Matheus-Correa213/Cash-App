# Correa Cash — Correa Tech

App de finanças do casal, separado do COSMO. Matheus administra tudo; a
pessoa com acesso restrito (ex: Alessia) só lança os próprios gastos e vê o
que for liberado para o papel dela.

## Stack

React + Vite, Supabase (Auth + Postgres com RLS), Vercel (hosting + funções
serverless em `api/`).

## Primeira configuração

1. Rode `supabase-schema.sql` inteiro no SQL Editor do seu projeto Supabase
   (se for um projeto novo) — ele já inclui a migração de robustez.
2. Se o projeto já existir de antes, rode também `supabase-migracao-3-redesign.sql`
   (contas reais com titular, parcelamento, assinaturas).
3. Copie `.env.example` para `.env` e preencha com a URL e a anon key desse
   mesmo projeto Supabase.
4. `npm install` e `npm run dev` para testar local, ou publique na Vercel.
5. Na Vercel, configure as variáveis de ambiente (Settings > Environment
   Variables) — ver `.env.example` para a lista completa, incluindo as novas
   `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (só pra `api/resumo.js`
   e `api/verificar-assinaturas.js`) e `SUPABASE_ANON_KEY` (pública, usada
   pelo chat e pela importação de arquivos).

## Estrutura

- `src/AuthGate.jsx` — login/cadastro, e a lógica de criar a família (primeiro
  acesso) ou reivindicar um convite por e-mail (segundo acesso em diante).
- `src/OwnerView.jsx` — casca do painel do administrador: navegação de baixo
  (Painel/Receitas/Gastos/Mais) e roteamento pras telas internas.
- `src/Painel.jsx` — painel principal simplificado (saldo, ações rápidas,
  atalhos, widgets).
- `src/Receitas.jsx` / `src/Gastos.jsx` — telas dedicadas de receita e gasto.
- `src/NovoLancamento.jsx` — formulário de lançamento por chips, com
  parcelamento no cartão (chama a função `criar_compra_parcelada` no banco).
- `src/ContasCartoes.jsx` / `src/CartaoDetalhe.jsx` — contas (corrente x
  poupança) e cartões reais, com visão de limite/fatura estilo app de banco.
- `src/Assinaturas.jsx` — assinaturas recorrentes, com a lógica de cartão
  (soma na fatura, sem confirmação) vs débito (o COSMO confere o saldo e
  confirma/avisa).
- `src/ChatCosmo.jsx` + `api/chat.js` — chat com o COSMO focado em finanças:
  propõe lançamentos e responde perguntas com dados reais, mas NUNCA lança
  nada sozinho — quem confirma é sempre a pessoa, na tela.
- `src/ImportarArquivo.jsx` + `api/extrair-arquivo.js` — lê PDF/Word/foto e
  propõe uma lista de lançamentos pra revisão (mesmo princípio: nunca lança
  sozinho).
- `src/MemberView.jsx` — painel restrito de quem tem acesso de membro.
- `api/resumo.js` — endpoint que devolve um resumo financeiro agregado do
  mês, protegido por um token secreto; é isso que o COSMO (o assistente
  principal, fora deste app) chama.
- `api/verificar-assinaturas.js` — endpoint pra um cron diário (cron-job.org,
  mesmo serviço já usado pelo COSMO e o JACKBOY): confere as assinaturas de
  débito automático do dia, olha o saldo da conta e lança sozinho se der —
  documentado com mais detalhes no topo do próprio arquivo.

## O que falta pra ficar 100% ao vivo

- Rodar a migração 3 no Supabase (passo 2 acima).
- Configurar `ANTHROPIC_API_KEY` na Vercel (console.anthropic.com) — sem ela,
  o chat e a importação de arquivo respondem com um aviso "ainda não
  configurado" em vez de dar erro feio.
- Criar, no cron-job.org, uma chamada diária para
  `https://SEU-DOMINIO/api/verificar-assinaturas` (mesmo padrão dos outros
  crons do ecossistema Correa Tech).
