// Leitor de arquivos OFX (extrato/fatura exportado pelo banco). Roda no
// navegador, sem IA e sem rede: é um arquivo de texto com formato fixo, então
// a leitura é exata — nada de "interpretar".
//
// Dois dialetos existem e os bancos brasileiros usam os dois:
//   • OFX 1.x (SGML): cabeçalho de texto + tags que NÃO fecham
//       <TRNAMT>-12.50<FITID>abc   (o valor termina onde começa a próxima tag)
//   • OFX 2.x (XML): tudo fechado  <TRNAMT>-12.50</TRNAMT>
// O leitor abaixo serve pros dois: percorre as tags uma a uma e trata como
// "valor" o texto que vem logo depois de cada tag de abertura.
//
// O que sai (lerOFX):
//   { tipoConta: "cartao" | "conta" | null, acctId, moeda,
//     inicio, fim,            // período do extrato, "YYYY-MM-DD" (ou null)
//     saldo: { valor, data } | null,   // LEDGERBAL (o saldo que o banco informa)
//     transacoes: [{ fitid, tipo, data, valor, memo, nome }] }
// `valor` mantém o SINAL do arquivo — quem interpreta (compra x pagamento) é
// conciliacaoFatura.js, porque cada banco usa uma convenção de sinal.

// OFX costuma vir em Windows-1252 (CHARSET:1252) — ler como UTF-8 estraga
// "Açaí" e "Farmácia". Aceita ArrayBuffer/Uint8Array e escolhe a codificação
// pelo cabeçalho; se mesmo assim sobrar caractere inválido, tenta Windows-1252.
export function decodificarOFX(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const cabecalho = new TextDecoder("latin1").decode(bytes.slice(0, 600));
  const charset = (cabecalho.match(/CHARSET:\s*(\S+)/i) || [])[1] || "";
  const pedeLatin = /1252|latin|iso-?8859/i.test(charset);
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (pedeLatin || utf8.includes("�")) {
    try { return new TextDecoder("windows-1252").decode(bytes); } catch { return new TextDecoder("latin1").decode(bytes); }
  }
  return utf8;
}

function dataOFX(s) {
  // "20260915", "20260915120000", "20260915120000[-3:BRT]" → "2026-09-15"
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(s || "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function numeroOFX(s) {
  // "-1234.56", "-1234,56", "1.234,56" → número
  let t = String(s || "").trim().replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else if (t.includes(",")) t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function limparTexto(s) {
  return String(s || "")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

export function lerOFX(texto) {
  const inicio = texto.search(/<OFX[\s>]/i);
  if (inicio === -1) throw new Error("Isso não parece um arquivo OFX (não achei o bloco <OFX>).");
  const corpo = texto.slice(inicio);

  const r = { tipoConta: null, acctId: null, moeda: null, inicio: null, fim: null, saldo: null, transacoes: [] };
  if (/<CREDITCARDMSGSRSV1|<CCSTMTRS|<CCACCTFROM/i.test(corpo)) r.tipoConta = "cartao";
  else if (/<BANKMSGSRSV1|<STMTRS|<BANKACCTFROM/i.test(corpo)) r.tipoConta = "conta";

  const pilha = [];
  let tx = null;
  const re = /<(\/?)([A-Za-z0-9._]+)\s*>([^<]*)/g;
  let m;
  while ((m = re.exec(corpo))) {
    const fecha = m[1] === "/";
    const tag = m[2].toUpperCase();
    const valor = limparTexto(m[3]);
    if (fecha) {
      if (tag === "STMTTRN" && tx) { r.transacoes.push(tx); tx = null; }
      const i = pilha.lastIndexOf(tag);
      if (i !== -1) pilha.length = i;
      continue;
    }
    if (valor === "") {
      // Tag de abertura de um bloco (STMTTRN, LEDGERBAL, BANKTRANLIST…).
      pilha.push(tag);
      if (tag === "STMTTRN") tx = {};
      continue;
    }
    // Folha com valor. No SGML ela não fecha, então não entra na pilha.
    if (tx) {
      if (tag === "FITID") tx.fitid = valor;
      else if (tag === "TRNTYPE") tx.tipo = valor.toUpperCase();
      else if (tag === "DTPOSTED") tx.data = dataOFX(valor);
      else if (tag === "TRNAMT") tx.valor = numeroOFX(valor);
      else if (tag === "MEMO") tx.memo = valor;
      else if (tag === "NAME" || tag === "PAYEE") tx.nome = valor;
      continue;
    }
    if (tag === "ACCTID" && !r.acctId) r.acctId = valor;
    else if (tag === "CURDEF") r.moeda = valor;
    else if (tag === "DTSTART") r.inicio = dataOFX(valor);
    else if (tag === "DTEND") r.fim = dataOFX(valor);
    else if (tag === "BALAMT" && pilha.includes("LEDGERBAL")) r.saldo = { ...(r.saldo || {}), valor: numeroOFX(valor) };
    else if (tag === "DTASOF" && pilha.includes("LEDGERBAL")) r.saldo = { ...(r.saldo || {}), data: dataOFX(valor) };
  }
  // SGML mal fechado: se o arquivo acabou no meio de uma transação, guarda o que deu.
  if (tx && Object.keys(tx).length) r.transacoes.push(tx);

  // Sem valor ou sem data a linha não serve (não dá pra lançar) — descarta e conta.
  const validas = r.transacoes.filter((t) => t.valor != null && t.data);
  r.descartadas = r.transacoes.length - validas.length;
  r.transacoes = validas.map((t, i) => ({
    // Sem FITID (raro) cria um estável pelo conteúdo, só pra não duplicar dentro do mesmo arquivo.
    fitid: t.fitid || `sem-fitid:${t.data}:${t.valor}:${(t.memo || t.nome || "").slice(0, 30)}:${i}`,
    tipo: t.tipo || null,
    data: t.data,
    valor: t.valor,
    memo: t.memo || t.nome || "",
    nome: t.nome || "",
  }));
  return r;
}
