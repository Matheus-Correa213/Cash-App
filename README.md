# Correa Cash — Correa Tech

App de finanças do casal, separado do COSMO. Matheus administra tudo; a
pessoa com acesso restrito (ex: Alessia) só lança os próprios gastos e vê o
que for liberado para o papel dela.

## Stack

React + Vite, Supabase (Auth + Postgres com RLS), Vercel (hosting + função
serverless em `api/resumo.js`).

## Primeira configuração

1. Rode `supabase-schema.sql` inteiro no SQL Editor do seu projeto Supabase.
2. Copie `.env.example` para `.env` e preencha com a URL e a anon key desse
   mesmo projeto Supabase.
3. `npm install` e `npm run dev` para testar local, ou publique na Vercel.
4. O passo a passo completo (Supabase, GitHub, Vercel, variáveis de
   ambiente) está no documento que acompanha esta entrega.

## Estrutura

- `src/AuthGate.jsx` — login/cadastro, e a lógica de criar a família (primeiro
  acesso) ou reivindicar um convite por e-mail (segundo acesso em diante).
- `src/OwnerView.jsx` — painel completo do administrador.
- `src/MemberView.jsx` — painel restrito de quem tem acesso de membro.
- `api/resumo.js` — endpoint que devolve um resumo financeiro agregado do
  mês, protegido por um token secreto; é isso que o COSMO chama.
