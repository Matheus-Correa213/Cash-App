import React, { useEffect, useState } from "react";
import { supabase, supabaseReady } from "./supabaseClient.js";
import App from "./App.jsx";
import { C } from "./theme.js";

// Tela de início colorida: fundo em gradiente com as cores de verdade da
// marca (azul-marinho -> azul da carteira), igual à logo. O card por cima
// continua branco pra manter o texto legível — só o fundo ganhou cor.
const wrap = { minHeight: "100vh", background: `linear-gradient(160deg, ${C.navy} 0%, ${C.accent} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui, -apple-system, sans-serif" };
const card = { background: C.card, borderRadius: 16, padding: 28, width: "100%", maxWidth: 380, boxShadow: "0 12px 32px rgba(3,15,49,0.35)", border: `1px solid ${C.line}` };
const logoWrap = { display: "flex", justifyContent: "center", marginBottom: 18 };
const logoImg = { width: 88, height: 88, borderRadius: 20, boxShadow: "0 4px 14px rgba(3,15,49,0.25)" };

// Logo oficial do Correa Cash (o mesmo arquivo usado como ícone do app/PWA,
// já publicado em /public) — aparece em toda tela anterior ao login.
function Logo() {
  return (
    <div style={logoWrap}>
      <img src="/icon-512-maskable.png" alt="Correa Cash" style={logoImg} />
    </div>
  );
}
const input = { width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 15, marginBottom: 12, background: "#fff", color: C.ink };
const button = { width: "100%", padding: "13px 14px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: C.accent, fontSize: 13.5, cursor: "pointer", padding: 0, marginTop: 14, display: "block", textAlign: "center", width: "100%" };
const title = { fontSize: 22, fontWeight: 700, color: C.ink, marginBottom: 4, textAlign: "center" };
const subtitle = { fontSize: 13.5, color: C.inkMute, marginBottom: 22, textAlign: "center", lineHeight: 1.5 };
const errBox = { background: "#FBEAE5", color: C.danger, fontSize: 13, padding: "10px 12px", borderRadius: 8, marginBottom: 14 };

export default function AuthGate() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabaseReady) { setChecking(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseReady) {
    return (
      <div style={wrap}>
        <div style={card}>
          <Logo />
          <div style={title}>Correa Cash</div>
          <div style={subtitle}>
            Este app ainda não está conectado a um banco de dados. Configure
            VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas variáveis de
            ambiente da Vercel (ou no arquivo .env local) e publique de novo.
          </div>
        </div>
      </div>
    );
  }

  if (checking) return <div style={wrap}><div style={{ textAlign: "center" }}><Logo /><div style={{ color: "#fff" }}>Carregando…</div></div></div>;

  if (!session) return <LoginForm />;

  return <MembroGate session={session} />;
}

function LoginForm() {
  const [modo, setModo] = useState("entrar"); // "entrar" | "cadastrar"
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function submeter(e) {
    e.preventDefault();
    setErro(""); setAviso(""); setCarregando(true);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password: senha });
        if (error) throw error;
        setAviso("Conta criada. Se o Supabase pedir confirmação por e-mail, confira sua caixa de entrada antes de entrar.");
      }
    } catch (e) {
      setErro(traduzErro(e.message));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div style={wrap}>
      <form style={card} onSubmit={submeter}>
        <Logo />
        <div style={title}>Correa Cash</div>
        <div style={subtitle}>Finanças do casal — Correa Tech</div>
        {erro && <div style={errBox}>{erro}</div>}
        {aviso && <div style={{ ...errBox, background: C.accentSoft, color: C.accent }}>{aviso}</div>}
        <input style={input} type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input style={input} type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} autoComplete={modo === "entrar" ? "current-password" : "new-password"} />
        <button style={button} type="submit" disabled={carregando}>
          {carregando ? "Um instante…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>
        <button type="button" style={linkBtn} onClick={() => { setModo(modo === "entrar" ? "cadastrar" : "entrar"); setErro(""); setAviso(""); }}>
          {modo === "entrar" ? "Ainda não tem conta? Criar uma" : "Já tem conta? Entrar"}
        </button>
      </form>
    </div>
  );
}

function traduzErro(msg) {
  if (!msg) return "Algo deu errado. Tente de novo.";
  if (msg.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("User already registered")) return "Já existe uma conta com este e-mail — tente entrar.";
  if (msg.includes("Password should be")) return "A senha precisa ter pelo menos 6 caracteres.";
  return msg;
}

// As mensagens de erro das funções criar_minha_familia()/reivindicar_convite() (ver
// supabase-schema.sql) já vêm em português, direto do "raise exception" no banco — só
// precisamos limpar o prefixo técnico que o Postgres/PostgREST gruda na frente.
function traduzErroServidor(msg) {
  if (!msg) return "";
  return msg.replace(/^.*?:\s*/, "");
}

// Depois do login, decide o que mostrar: o app de verdade (se já existe um
// registro em "membros" ligado a este login), a tela de reivindicar um
// convite (se o dono já cadastrou este e-mail antes), ou a tela de criar a
// família (só acontece uma vez — a primeira pessoa a usar o Cash App).
function MembroGate({ session }) {
  const [estado, setEstado] = useState("carregando"); // carregando | app | convite | criar-familia | erro
  const [membro, setMembro] = useState(null);
  const [erro, setErro] = useState("");

  async function carregar() {
    setEstado("carregando");
    try {
      const { data: meu, error: e1 } = await supabase.from("membros").select("*").eq("user_id", session.user.id).maybeSingle();
      if (e1) throw e1;
      if (meu) { setMembro(meu); setEstado("app"); return; }

      const email = session.user.email;
      const { data: convite, error: e2 } = await supabase
        .from("membros").select("*").is("user_id", null).ilike("email", email).maybeSingle();
      if (e2) throw e2;
      if (convite) { setEstado("convite"); return; }

      setEstado("criar-familia");
    } catch (e) {
      setErro(e.message || "Erro ao carregar sua conta.");
      setEstado("erro");
    }
  }

  useEffect(() => { carregar(); }, [session.user.id]);

  async function reivindicarConvite() {
    setEstado("carregando");
    try {
      // Correção 15/09/2026: chamar a função reivindicar_convite() no banco, em vez de
      // fazer o update direto pela tabela — ver o comentário em criar() logo abaixo, é o
      // mesmo motivo (evita depender do RLS bater exatamente no primeiro request depois
      // do login/confirmação de e-mail).
      const { error } = await supabase.rpc("reivindicar_convite");
      if (error) throw error;
      await carregar();
    } catch (e) {
      setErro(traduzErroServidor(e.message) || "Não consegui vincular seu convite.");
      setEstado("erro");
    }
  }

  async function sair() {
    await supabase.auth.signOut();
  }

  if (estado === "carregando") return <div style={wrap}><div style={{ textAlign: "center" }}><Logo /><div style={{ color: "#fff" }}>Carregando…</div></div></div>;

  if (estado === "erro") {
    return (
      <div style={wrap}>
        <div style={card}>
          <Logo />
          <div style={title}>Algo deu errado</div>
          <div style={subtitle}>{erro}</div>
          <button style={button} onClick={carregar}>Tentar de novo</button>
          <button type="button" style={linkBtn} onClick={sair}>Sair</button>
        </div>
      </div>
    );
  }

  if (estado === "convite") {
    return (
      <div style={wrap}>
        <div style={card}>
          <Logo />
          <div style={title}>Convite encontrado</div>
          <div style={subtitle}>Encontramos um convite para {session.user.email}. Toque abaixo para entrar na sua família no Correa Cash.</div>
          <button style={button} onClick={reivindicarConvite}>Entrar na família</button>
          <button type="button" style={linkBtn} onClick={sair}>Sair</button>
        </div>
      </div>
    );
  }

  if (estado === "criar-familia") {
    return <CriarFamilia session={session} onCriada={carregar} onSair={sair} />;
  }

  return <App session={session} membro={membro} onSignOut={sair} onMembroAtualizado={carregar} />;
}

function CriarFamilia({ session, onCriada, onSair }) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function criar(e) {
    e.preventDefault();
    setErro(""); setCarregando(true);
    try {
      // Correção 15/09/2026: antes eram DOIS inserts separados feitos pelo navegador
      // (familias, depois membros), cada um checado pela política de RLS contra
      // auth.uid(). Na prática, logo depois de confirmar o e-mail/entrar pela primeira
      // vez, isso deu "new row violates row-level security policy" — e mesmo corrigindo
      // o motivo exato, dois inserts separados sempre deixam uma brecha: se o primeiro
      // desse certo e o segundo falhasse, o Matheus ficaria com uma família órfã, sem
      // membro nenhum, e travado sem conseguir tentar de novo (nome já "usado").
      // A troca: uma função no próprio banco (criar_minha_familia), que roda os dois
      // inserts como UMA operação só, usando auth.uid() direto no servidor — nunca o
      // que o navegador manda — e nunca deixa a metade do trabalho feita.
      const { error } = await supabase.rpc("criar_minha_familia", { p_nome: nome.trim() });
      if (error) throw error;
      onCriada();
    } catch (e) {
      setErro(traduzErroServidor(e.message) || "Não consegui criar a família.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div style={wrap}>
      <form style={card} onSubmit={criar}>
        <Logo />
        <div style={title}>Bem-vindo ao Correa Cash</div>
        <div style={subtitle}>Você é a primeira pessoa a entrar — vamos criar sua família. Depois você convida a segunda pessoa dentro do app.</div>
        {erro && <div style={errBox}>{erro}</div>}
        <input style={input} placeholder="Seu nome (ex: Matheus)" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <button style={button} type="submit" disabled={carregando}>{carregando ? "Criando…" : "Criar minha família"}</button>
        <button type="button" style={linkBtn} onClick={onSair}>Sair</button>
      </form>
    </div>
  );
}
