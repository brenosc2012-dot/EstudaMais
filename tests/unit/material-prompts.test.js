// Unitários: material de apoio (divisão justa do orçamento de 60.000 caracteres e
// reconstrução dos blocos) e os prompts enviados à IA (texto de estudo e regeneração).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar-app");

const j = v => JSON.parse(JSON.stringify(v));
const mat = () => carregar({ funcoes: ["combinarMaterial", "dividirBlocosMaterial"], constantes: ["MATERIAL_TEXTO_MAX"] });

test("combinarMaterial: sem documentos → vazio; documentos pequenos entram inteiros com cabeçalho", () => {
  const c = mat();
  assert.deepEqual(j(c.combinarMaterial([], [])), { texto: "", cotas: [] });
  const r = j(c.combinarMaterial(["a.txt", "b.pdf"], ["  conteúdo A ", "conteúdo B"]));
  assert.equal(r.texto, "[a.txt]\nconteúdo A\n\n[b.pdf]\nconteúdo B");
  assert.deepEqual(r.cotas, [10, 10]);
});

test("combinarMaterial: respeita o teto de 60.000 e dá cota justa — o 13º documento continua presente", () => {
  const c = mat();
  const nomes = Array.from({ length: 13 }, (_, i) => `doc${i + 1}.txt`);
  const textos = nomes.map((_, i) => (i === 12 ? "Z" : "x").repeat(i === 3 ? 500 : 20000));
  const r = c.combinarMaterial(nomes, textos);
  assert.ok(r.texto.length <= 60000, "teto respeitado: " + r.texto.length);
  assert.match(r.texto, /\[doc13\.txt\]\nZ{100,}/, "último documento representado");
  assert.equal(r.cotas[3], 500, "pequeno entra inteiro");
  // sobra do pequeno redistribuída: os grandes recebem cotas iguais entre si
  const grandes = r.cotas.filter((_, i) => i !== 3);
  assert.ok(Math.max(...grandes) - Math.min(...grandes) <= 1, "cotas iguais: " + grandes.join(","));
});

test("combinarMaterial: documentos vazios não geram bloco; nome ausente vira 'documento N'", () => {
  const c = mat();
  const r = j(c.combinarMaterial([undefined, "b"], ["texto sem nome", "   "]));
  assert.equal(r.texto, "[documento 1]\ntexto sem nome");
  assert.deepEqual(r.cotas, [14, 0]);
});

test("dividirBlocosMaterial: reconstrói cada documento, inclusive nomes repetidos e ausentes", () => {
  const c = mat();
  const nomes = ["a.txt", "a.txt", "c.pdf"];
  const { texto } = c.combinarMaterial(nomes, ["um", "dois", "três"]);
  assert.deepEqual(j(c.dividirBlocosMaterial(texto, nomes)), ["um", "dois", "três"]);
  assert.deepEqual(j(c.dividirBlocosMaterial("[x]\nsó x", ["x", "sumiu"])), ["só x", ""]);
  assert.deepEqual(j(c.dividirBlocosMaterial(null, null)), []);
  assert.deepEqual(j(c.dividirBlocosMaterial("", ["a"])), [""]);
});

// ---------------- prompts ----------------
const SUBJ = { mat: { id: "mat", nome: "Matemática" }, ing: { id: "ing", nome: "Inglês" }, por: { id: "por", nome: "Português" } };
const prompts = () => carregar({
  funcoes: ["tipoLabel", "nivelDificuldadeLabel", "contarPorDificuldade", "ehLinguaEstrangeira", "blocoLinguaEstrangeira", "limitePalavrasResumo", "montarPromptResumo", "montarPromptRegenerarExercicios"],
  constantes: ["LINGUAS_ESTRANGEIRAS"],
  stubs: {
    subjById: id => SUBJ[id], nomeNivel: () => "Ensino Fundamental I",
    descreverPublicoLicao: () => ({ ano: "3º ano", nivelId: "fund1", idade: 8, frase: "Adapte para 8 anos." }),
  },
});

test("montarPromptResumo: limite de palavras por idade (350/450/550) e campos 'não informado' sem exercícios", () => {
  const c = prompts();
  const l = { titulo: "Frações", texto: "Base", exercicios: [] };
  assert.match(c.montarPromptResumo(l, { ano: "1º ano", nivelNome: "EF I", idade: 6, frase: "" }, "mat"), /no máximo 350 palavras/);
  assert.match(c.montarPromptResumo(l, { ano: "5º ano", nivelNome: "EF I", idade: 10, frase: "" }, "mat"), /no máximo 450 palavras/);
  const p = c.montarPromptResumo(l, { ano: "1º EM", nivelNome: "EM", idade: 15, frase: "" }, "mat");
  assert.match(p, /no máximo 550 palavras/);
  assert.match(p, /Dificuldade dos exercícios: não informado/);
  assert.doesNotMatch(p, /EXERCÍCIOS QUE O ALUNO VAI RESOLVER/);
  assert.doesNotMatch(p, /MATERIAL DE APOIO/);
});

test("montarPromptResumo: lição nula/sem disciplina não quebra; enunciados truncados em 220 chars; máx. 20 questões", () => {
  const c = prompts();
  const pub = { ano: "3º ano", nivelNome: "EF I", idade: 8, frase: "" };
  const p0 = c.montarPromptResumo(null, pub, "xx");
  assert.match(p0, /Tema: \(sem título\)/); assert.match(p0, /Disciplina: \(não informada\)/);
  const exs = Array.from({ length: 25 }, (_, i) => ({ tipo: "mc", enunciado: (i === 0 ? "Y".repeat(400) : "Pergunta " + i) }));
  const p = c.montarPromptResumo({ titulo: "T", texto: "", exercicios: exs }, pub, "mat");
  assert.match(p, new RegExp("Y{220}(?!Y)"));
  assert.match(p, /\n20\. \[/); assert.doesNotMatch(p, /\n21\. \[/);
});

test("montarPromptRegenerarExercicios: contexto completo, distribuição de dificuldade/tipos e questões atuais", () => {
  const c = prompts();
  const atuais = [
    { tipo: "mc", nivel: "facil", enunciado: "Quanto é 1+1?" }, { tipo: "vf", nivel: "", enunciado: "2 é par?" },
    { tipo: "fill", nivel: "dificil", enunciado: "3 x 3 = ___" },
  ];
  const L = { titulo: "Contas", texto: "Conteúdo base da lição", materialTexto: "Apostila" };
  const p = c.montarPromptRegenerarExercicios(L, atuais, 3, "## Resumo de estudo", "mat");
  for (const re of [/3º ano do Ensino Fundamental I/, /lição "Contas" \(Matemática\)/, /exatamente 3 exercícios NOVOS/,
    /1 fáceis, 1 intermediários e 1 difíceis/, /1 de múltipla escolha, 1 de verdadeiro\/falso e 1 de completar lacunas/,
    /Adapte para 8 anos\./, /1\. Quanto é 1\+1\?/, /3\. 3 x 3 = ___/, /TEXTO DE ESTUDO QUE O ALUNO LÊ ANTES/, /## Resumo de estudo/,
    /Conteúdo base da lição/, /MATERIAL DE APOIO ANEXADO[\s\S]*Apostila/, /"explicacao"/, /nunca a letra/])
    assert.match(p, re);
});

test("montarPromptRegenerarExercicios: sem resumo/material omite as seções; Inglês inclui bloco da língua com ressalva", () => {
  const c = prompts();
  const p = c.montarPromptRegenerarExercicios({ titulo: "T", texto: "x" }, [{ tipo: "mc", enunciado: "q" }], 1, "", "mat");
  assert.doesNotMatch(p, /TEXTO DE ESTUDO QUE O ALUNO/); assert.doesNotMatch(p, /MATERIAL DE APOIO/); assert.doesNotMatch(p, /língua inglesa/);
  assert.match(p, /0 fáceis, 1 intermediários e 0 difíceis/, "questão sem nível conta como intermediária");
  const pi = c.montarPromptRegenerarExercicios({ titulo: "Food", texto: "x" }, [{ tipo: "mc", enunciado: "q" }], 1, "", "ing");
  assert.match(pi, /língua inglesa/);
  assert.match(pi, /valem os 1 exercícios/);
  // resumo enorme é truncado em 5.000 caracteres
  const pr = c.montarPromptRegenerarExercicios({ titulo: "T", texto: "x" }, [{ tipo: "mc", enunciado: "q" }], 1, "R".repeat(9000), "mat");
  assert.match(pr, /R{5000}(?!R)/);
});
