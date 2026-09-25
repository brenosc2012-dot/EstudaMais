// Validação objetiva do texto de estudo gerado pela IA (validarResumoIA) — antes de gravar.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar-app");
const F = require("../support/fixtures");

const ctx = () => carregar({
  funcoes: ["limitePalavrasResumo", "validarResumoIA"],
  constantes: ["RESUMO_MIN_PALAVRAS", "RESUMO_FOLGA_TAMANHO", "PALAVRAS_PT"],
});
const palavras = n => Array.from({ length: n }, (_, i) => (i % 4 === 0 ? "de" : "soma" + i)).join(" ");
const comEstrutura = corpo => `## O que é?\n${corpo}\n## Exemplo 1\nPasso 1.\n## Exemplo 2\nPasso 2.`;

test("validarResumoIA: o texto no formato pedido passa", () => {
  const c = ctx();
  assert.deepEqual({ ...c.validarResumoIA(F.RESUMO_DIDATICO, 8) }, { ok: true, erro: "" });
});

test("validarResumoIA: recusa vazio, sem títulos, com menos de 2 exemplos", () => {
  const c = ctx();
  assert.equal(c.validarResumoIA("   ", 8).erro, "resposta vazia");
  assert.equal(c.validarResumoIA(null, 8).erro, "resposta vazia");
  const semTitulo = F.RESUMO_DIDATICO.replace(/^## /gm, "");
  assert.equal(c.validarResumoIA(semTitulo, 8).erro, "sem títulos de seção");
  const umExemplo = F.RESUMO_DIDATICO.replace("## Exemplo 2", "## Outro caso");
  assert.equal(c.validarResumoIA(umExemplo, 8).erro, "menos de 2 exemplos");
});

test("validarResumoIA: tamanho — mínimo de 60 palavras e máximo = limite da idade × 1,5", () => {
  const c = ctx();
  assert.match(c.validarResumoIA(comEstrutura("Somar é juntar."), 8).erro, /^curto demais/);
  // 8 anos: limite 350 → máximo 525; 12 anos: 550 → 825
  assert.equal(c.validarResumoIA(comEstrutura(palavras(500)), 8).ok, true);
  assert.match(c.validarResumoIA(comEstrutura(palavras(540)), 8).erro, /^longo demais .*máximo 525/);
  assert.equal(c.validarResumoIA(comEstrutura(palavras(800)), 12).ok, true);
  assert.equal(c.limitePalavrasResumo(8), 350);
  assert.equal(c.limitePalavrasResumo(10), 450);
  assert.equal(c.limitePalavrasResumo(15), 550);
});

test("validarResumoIA: recusa HTML e bloco de código, mas aceita < e > de Matemática", () => {
  const c = ctx();
  for (const lixo of ["<script>x()</script>", '<img src=x onerror="a()">', "<b>forte</b>", "<div class='a'>", "```json\n{}\n```", "</p>"]) {
    assert.equal(c.validarResumoIA(F.RESUMO_DIDATICO + "\n" + lixo, 8).erro, "veio com HTML ou bloco de código", lixo);
  }
  for (const ok of ["3 < 5 e 7 > 2", "x<y e y>z", "a <= b", "use <> com cuidado"]) {
    assert.equal(c.validarResumoIA(F.RESUMO_DIDATICO + "\n" + ok, 8).ok, true, ok);
  }
});

test("validarResumoIA: recusa texto que não está em português", () => {
  const c = ctx();
  const ingles = comEstrutura(Array.from({ length: 30 }, () => "Adding means putting quantities together to find the total amount.").join(" "));
  assert.equal(c.validarResumoIA(ingles, 12).erro, "não parece estar em português");
});
