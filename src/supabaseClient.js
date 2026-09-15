// Cliente do Supabase do Cash App — banco PRÓPRIO, separado do banco do COSMO.
// As chaves vêm das variáveis de ambiente da Vercel deste projeto
// (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY). A "anon key" é pública por
// design — a segurança real vem das regras de acesso (RLS) configuradas no
// banco pelo script supabase-schema.sql.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(url && anonKey);

export const supabase = supabaseReady ? createClient(url, anonKey) : null;
