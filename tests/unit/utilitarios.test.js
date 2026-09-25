// Unitários: utilitários, formatação de texto, faixa etária, escopo/visibilidade,
// hash de senha, migração de lições e embaralhamento determinístico.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { carregar } = require("./carregar-app");

// normaliza objetos vindos do contexto vm (outro "realm") para comparação profunda
const j = v => JSON.parse(JSON.stringify(v));

const BASE = ["norm", "esc", "uid", "fmtInline", "formatResumo", "formatResumoLeitor", "linhasTexto", "paragrafosTexto"];

test("norm: remove acentos, espaços das pontas e caixa; tolera null/undefined/número", () => {
  const c = carregar({ funcoes: ["norm"] });
  assert.equal(c.norm("  Ação É Ótima  "), "acao e otima");
  assert.equal(c.norm(null), "");
  assert.equal(c.norm(undefined), "");
  assert.equal(c.norm(0), ""); // 0 é falsy → string vazia (comportamento atual documentado)
  assert.equal(c.norm(12), "12");
  assert.equal(c.norm("ÇÃÕÜ"), "caou");
});

test("esc: escapa &, <, >, aspas; null/undefined viram vazio", () => {
  const c = carregar({ funcoes: ["esc"] });
  assert.equal(c.esc(`<img src=x onerror="alert(1)">&`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
  assert.equal(c.esc(null), "");
  assert.equal(c.esc(undefined), "");
  assert.equal(c.esc(5), "5");
});

test("uid: prefixo 'id', único em 1000 gerações", () => {
  const c = carregar({ funcoes: ["uid"] });
  const ids = new Set(Array.from({ length: 1000 }, () => c.uid()));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^id[a-z0-9]+$/);
});

test("formatResumo: títulos, tópicos, negrito, linhas vazias; HTML da IA sempre escapado", () => {
  const c = carregar({ funcoes: BASE });
  const html = c.formatResumo("## Título <b>x</b>\n\n- tópico **forte**\nParágrafo <script>alert(1)</script>");
  assert.match(html, /<div class="resumo-titulo">Título &lt;b&gt;x&lt;\/b&gt;<\/div>/);
  assert.match(html, /<div style="height:8px"><\/div>/);
  assert.match(html, /resumo-topico"><span class="rt-ic">⭐<\/span><span>tópico <b>forte<\/b><\/span>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(c.formatResumo(""), `<div style="height:8px"></div>`);
  assert.equal(c.formatResumo(null), `<div style="height:8px"></div>`);
});

test("fmtInline: negrito só com pares **; asteriscos soltos ficam como texto", () => {
  const c = carregar({ funcoes: BASE });
  assert.equal(c.fmtInline("a **b** c **d**"), "a <b>b</b> c <b>d</b>");
  assert.equal(c.fmtInline("2 * 3 = 6"), "2 * 3 = 6");
  assert.equal(c.fmtInline("**sem fechar"), "**sem fechar");
  assert.equal(c.fmtInline("**<i>**"), "<b>&lt;i&gt;</b>");
});

test("formatResumoLeitor: um bloco com id spar-i por linha (índices batem com a voz)", () => {
  const c = carregar({ funcoes: BASE });
  const txt = "## Tít\nLinha **um**\n- tópico\n\n\nFim";
  const html = c.formatResumoLeitor(txt);
  const ids = [...html.matchAll(/id="spar-(\d+)"/g)].map(m => +m[1]);
  assert.deepEqual(ids, [0, 1, 2, 3]);
  assert.equal(c.paragrafosTexto(txt).length, 4);
  assert.deepEqual(j(c.paragrafosTexto(txt)), ["Tít", "Linha um", "- tópico", "Fim"]);
  // texto vazio cai no formatResumo
  assert.equal(c.formatResumoLeitor(""), c.formatResumo(""));
});

test("linhasTexto/paragrafosTexto: descarta linhas vazias, preserva '##' sem espaço", () => {
  const c = carregar({ funcoes: BASE });
  assert.deepEqual(j(c.linhasTexto("  a \n\n b\r\n")), ["a", "b"]);
  assert.deepEqual(j(c.paragrafosTexto("##\n###### T")), ["##", "T"]);
  assert.deepEqual(j(c.paragrafosTexto(null)), []);
});

// ---------------- faixa etária ----------------
const PUB = { funcoes: ["nivelById", "nomeNivel", "idadeAproximada", "fraseAdaptacao", "descreverPublico", "descreverPublicoLicao"], constantes: ["NIVEIS_ENSINO"] };

test("idadeAproximada: base por nível + posição do ano; ano/nível desconhecido usa defaults", () => {
  const c = carregar(Object.assign({ stubs: { ALUNO: null } }, PUB));
  assert.equal(c.idadeAproximada("fund1", "1º ano"), 6);
  assert.equal(c.idadeAproximada("fund1", "5º ano"), 10);
  assert.equal(c.idadeAproximada("fund2", "6º ano"), 11);
  assert.equal(c.idadeAproximada("medio", "3º ano EM"), 17);
  assert.equal(c.idadeAproximada("fund2", "ano inexistente"), 11);
  assert.equal(c.idadeAproximada("xyz", "1º ano"), 6); // nível desconhecido → fund1
});

test("descreverPublico: usa idade informada do aluno; sem aluno cai no 1º ano do Fund. I", () => {
  const c = carregar(Object.assign({ stubs: { ALUNO: null } }, PUB));
  const p = c.descreverPublico({ nivel: "medio", ano: "2º ano EM", idade: 16 });
  assert.equal(p.idade, 16); assert.equal(p.nivel, "Ensino Médio"); assert.equal(p.ano, "2º ano EM");
  assert.match(p.frase, /2º ano EM do Ensino Médio, com aproximadamente 16 anos/);
  const d = c.descreverPublico(null);
  assert.equal(d.ano, "1º ano"); assert.equal(d.idade, 6); assert.equal(d.nivel, "Ensino Fundamental I");
});

test("descreverPublicoLicao: idade estimada pelo ano/nível da lição; lição vazia → fund1 1º ano", () => {
  const c = carregar(Object.assign({ stubs: { ALUNO: null } }, PUB));
  assert.deepEqual(j(c.descreverPublicoLicao({ nivel: "fund2", ano: "9º ano" })).idade, 14);
  const v = c.descreverPublicoLicao({});
  assert.equal(v.nivelId, "fund1"); assert.equal(v.ano, "1º ano"); assert.equal(v.idade, 6);
  assert.equal(c.descreverPublicoLicao(null).idade, 6);
});

// ---------------- escopo / visibilidade ----------------
const ESC = { funcoes: ["norm", "licaoVisivelPara", "licaoVisivel", "escopoProfessor", "escopoCompleto", "alunoNoEscopo", "licaoNoEscopoProfessor"] };

test("licaoVisivelPara: exige ano E turma iguais (normalizados); nível opcional; sem curinga", () => {
  const c = carregar(Object.assign({ stubs: { ALUNO: null, PROFESSOR: null } }, ESC));
  const aluno = { ano: "3º ano", turma: "A", nivel: "fund1" };
  assert.equal(c.licaoVisivelPara({ ano: "3º ANO ", turma: " a", nivel: "" }, aluno), true);
  assert.equal(c.licaoVisivelPara({ ano: "3º ano", turma: "B" }, aluno), false);
  assert.equal(c.licaoVisivelPara({ ano: "4º ano", turma: "A" }, aluno), false);
  assert.equal(c.licaoVisivelPara({ ano: "", turma: "A" }, aluno), false, "ano vazio não é curinga");
  assert.equal(c.licaoVisivelPara({ ano: "3º ano", turma: "" }, aluno), false, "turma vazia não é curinga");
  assert.equal(c.licaoVisivelPara({ ano: "3º ano", turma: "A", nivel: "fund2" }, aluno), false);
  assert.equal(c.licaoVisivelPara({ ano: "3º ano", turma: "A" }, undefined), false);
});

test("licaoVisivel: sem aluno logado tudo é visível (tela do professor/preview)", () => {
  const c = carregar(Object.assign({ stubs: { ALUNO: null, PROFESSOR: null } }, ESC));
  assert.equal(c.licaoVisivel({ ano: "", turma: "" }), true);
  c.ALUNO = { ano: "1º ano", turma: "A" };
  assert.equal(c.licaoVisivel({ ano: "", turma: "" }), false);
});

test("escopo do professor: completo só com turmas E anos; aluno precisa bater os dois", () => {
  const c = carregar(Object.assign({ stubs: { ALUNO: null, PROFESSOR: null } }, ESC));
  const prof = { turmas: ["A", "B"], anos: ["3º ano"] };
  assert.equal(c.escopoCompleto(prof), true);
  assert.equal(c.escopoCompleto({ turmas: ["A"], anos: [] }), false);
  assert.equal(c.escopoCompleto({ turmas: "A", anos: "x" }), false, "tipos inválidos viram listas vazias");
  assert.equal(c.alunoNoEscopo({ turma: "b", ano: "3º ANO" }, prof), true);
  assert.equal(c.alunoNoEscopo({ turma: "C", ano: "3º ano" }, prof), false);
  assert.equal(c.alunoNoEscopo({ turma: "A", ano: "4º ano" }, prof), false);
  assert.equal(c.alunoNoEscopo({ turma: "A", ano: "3º ano" }, { turmas: ["A"] }), false, "sem fallback");
  assert.equal(c.alunoNoEscopo({ turma: "A", ano: "3º ano" }, undefined), false);
});

test("licaoNoEscopoProfessor: campo vazio na lição é curinga do lado do professor", () => {
  const c = carregar(Object.assign({ stubs: { ALUNO: null, PROFESSOR: null } }, ESC));
  const prof = { turmas: ["A"], anos: ["3º ano"] };
  assert.equal(c.licaoNoEscopoProfessor({ ano: "", turma: "" }, prof), true);
  assert.equal(c.licaoNoEscopoProfessor({ ano: "3º ano", turma: "" }, prof), true);
  assert.equal(c.licaoNoEscopoProfessor({ ano: "1º ano", turma: "A" }, prof), false);
  assert.equal(c.licaoNoEscopoProfessor({ ano: "", turma: "B" }, prof), false);
  assert.equal(c.licaoNoEscopoProfessor({ ano: "", turma: "" }, { turmas: [], anos: ["3º ano"] }), false);
});

// ---------------- hash de senha ----------------
test("hashSenha: SHA-256 hex idêntico ao do Node; null vira string vazia", async () => {
  const { webcrypto } = crypto;
  const { TextEncoder } = require("util");
  const c = carregar({ funcoes: ["hashSenha"], stubs: { crypto: webcrypto, TextEncoder, Uint8Array } });
  const sha = s => crypto.createHash("sha256").update(s).digest("hex");
  assert.equal(await c.hashSenha("senha123"), sha("senha123"));
  assert.equal(await c.hashSenha(null), sha(""));
  assert.equal(await c.hashSenha("ç🙂"), sha("ç🙂"));
  assert.notEqual(await c.hashSenha("a"), await c.hashSenha("A"));
});

test("hashSenha: sem SubtleCrypto usa o fallback determinístico prefixado com 'f'", async () => {
  const { TextEncoder } = require("util");
  const c = carregar({ funcoes: ["hashSenha"], stubs: { crypto: {}, TextEncoder, Uint8Array } });
  const h1 = await c.hashSenha("senha"), h2 = await c.hashSenha("senha");
  assert.match(h1, /^f[0-9a-f]+$/);
  assert.equal(h1, h2);
  assert.notEqual(h1, await c.hashSenha("senhb"));
});

// ---------------- timeouts de IA ----------------
test("timeoutComMaterial: +15s a cada 20.000 chars, teto +45s", () => {
  const c = carregar({ funcoes: ["timeoutComMaterial"] });
  assert.equal(c.timeoutComMaterial(20000, ""), 20000);
  assert.equal(c.timeoutComMaterial(20000, null), 20000);
  assert.equal(c.timeoutComMaterial(20000, "x".repeat(19999)), 20000);
  assert.equal(c.timeoutComMaterial(20000, "x".repeat(20000)), 35000);
  assert.equal(c.timeoutComMaterial(20000, "x".repeat(59999)), 50000);
  assert.equal(c.timeoutComMaterial(20000, "x".repeat(500000)), 65000);
});

// ---------------- migração de lições ----------------
const MIG = { funcoes: ["norm", "acharIndiceCorreto", "migrarExercicioResposta", "migrarExerciciosLicao", "licaoDeDoc"] };

test("migrarExercicioResposta: 'correta' string (rótulo/texto) vira índice; fora de faixa → 0", () => {
  const c = carregar(MIG);
  const op = ["Azul", "Verde", "Roxo"];
  assert.equal(c.migrarExercicioResposta({ tipo: "mc", opcoes: op, correta: "Verde" }).correta, 1);
  assert.equal(c.migrarExercicioResposta({ tipo: "mc", opcoes: op, correta: "C" }).correta, 2);
  assert.equal(c.migrarExercicioResposta({ tipo: "mc", opcoes: op, correta: 7 }).correta, 0);
  assert.equal(c.migrarExercicioResposta({ tipo: "mc", opcoes: op, correta: -1 }).correta, 0);
  assert.equal(c.migrarExercicioResposta({ tipo: "mc", opcoes: op }).correta, 0);
  assert.equal(c.migrarExercicioResposta({ tipo: "mc", opcoes: op, correta: 2 }).correta, 2);
  const f = { tipo: "fill", resposta: "x" };
  assert.equal(c.migrarExercicioResposta(f), f);
  assert.equal(c.migrarExercicioResposta(null), null);
  assert.deepEqual(j(c.migrarExerciciosLicao("não-array")), []);
});

test("licaoDeDoc: mapeia conteudo→texto, defaults seguros e ignora campos legados/inválidos", () => {
  const c = carregar(MIG);
  const l = c.licaoDeDoc("L9", { titulo: "T", conteudo: "C", exercicios: [{ tipo: "mc", opcoes: ["a", "b"], correta: "b" }],
    explicacoes: "inválido", materialNomes: "x", materialUrls: ["http://antigo"], historiaHabilitada: false, exerciciosVersao: 3 });
  assert.equal(l.id, "L9"); assert.equal(l.texto, "C"); assert.equal(l.exercicios[0].correta, 1);
  assert.deepEqual(j(l.explicacoes), {}); assert.deepEqual(j(l.materialNomes), []);
  assert.equal(l.historiaHabilitada, false); assert.equal(l.exerciciosVersao, 3);
  assert.equal("materialUrls" in l, false);
  const v = c.licaoDeDoc("V", {});
  assert.equal(v.tipo, "padrao"); assert.equal(v.historiaHabilitada, true); assert.equal(v.exerciciosVersao, 0);
  assert.deepEqual(j(v.exercicios), []); assert.equal(v.resumoIA, "");
});

// ---------------- embaralhamento determinístico ----------------
function ctxEmbaralhar(seq) {
  const c = carregar({ funcoes: ["embaralharTentativa"] });
  let i = 0;
  c.Math = Object.create(Math); c.Math.random = () => seq[i++ % seq.length];
  return c;
}
const exs = n => Array.from({ length: n }, (_, i) => ({ id: "e" + i }));

test("embaralharTentativa: com aleatoriedade injetada gera exatamente a permutação esperada", () => {
  // Fisher–Yates: i=2 → j=floor(0.0*3)=0; i=1 → j=floor(0.0*2)=0  ⇒ [e1, e2, e0]
  const c = ctxEmbaralhar([0.0]);
  assert.deepEqual(c.embaralharTentativa(exs(3), null).map(e => e.id), ["e1", "e2", "e0"]);
});

test("embaralharTentativa: se o sorteio repetir a ordem anterior, sorteia de novo e por fim troca as duas primeiras", () => {
  // random 0.999 → j=i sempre → permutação identidade em todas as 10 tentativas
  const c = ctxEmbaralhar([0.999]);
  const ant = exs(4);
  assert.deepEqual(c.embaralharTentativa(ant, ant).map(e => e.id), ["e1", "e0", "e2", "e3"]);
  // sem tentativa anterior a identidade é aceita (não há com o que comparar)
  assert.deepEqual(c.embaralharTentativa(ant, null).map(e => e.id), ["e0", "e1", "e2", "e3"]);
});

test("embaralharTentativa: sem ids compara pela referência; lista vazia/nula ok", () => {
  const c = ctxEmbaralhar([0.999]);
  const a = [{}, {}];
  const r = c.embaralharTentativa(a, a);
  assert.equal(r[0], a[1]); assert.equal(r[1], a[0]);
  assert.deepEqual(j(c.embaralharTentativa([], null)), []);
  assert.deepEqual(j(c.embaralharTentativa(null, null)), []);
  // anterior com tamanho diferente (lição regenerada) → qualquer ordem vale
  assert.equal(c.embaralharTentativa(exs(3), exs(2)).length, 3);
});
