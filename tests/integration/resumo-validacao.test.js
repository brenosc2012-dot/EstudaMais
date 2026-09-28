// Texto de estudo gerado pela IA só é gravado/mostrado depois de validado (aluno e professor).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { abrirProfessor, erroIA, ultimoToast } = require("../support/professor-helpers");
const F = A.F;

const CURTO = "## Resumo\n## Exemplo 1\n## Exemplo 2\nSomar é juntar."; // estrutura ok, só falta tamanho
const SEM_EXEMPLOS = F.RESUMO_DIDATICO.replace(/Exemplo \d/g, "Caso");

// ---------------- aluno (openLesson) ----------------
test("aluno: 1ª resposta fora do padrão, 2ª válida → mostra e grava só a válida", async () => {
  let n = 0;
  const h = await A.entrarAluno({ rotas: { resumo: () => (++n === 1 ? CURTO : F.RESUMO_DIDATICO) } });
  try {
    await A.abrirLicao(h);
    assert.equal(A.chamadasResumo(h.ia), 2);
    assert.match(h.texto(), /Gerado por IA/);
    assert.match(h.texto(), /O que é somar\?/);
    assert.equal(h.store.dados.licoes_geradas.L1.resumo, F.RESUMO_DIDATICO.trim());
  } finally { h.fechar(); }
});

test("aluno: fora do padrão 2x (sem exemplos) → conteúdo do professor, nada gravado", async () => {
  const h = await A.entrarAluno({ rotas: { resumo: SEM_EXEMPLOS } });
  try {
    await A.abrirLicao(h);
    assert.equal(A.chamadasResumo(h.ia), 2, "no máximo 2 tentativas");
    assert.doesNotMatch(h.texto(), /Gerado por IA/);
    assert.match(h.texto(), /Resumo automático indisponível/);
    assert.match(h.texto(), /Somar é juntar quantidades/);
    assert.equal((h.store.dados.licoes_geradas || {}).L1, undefined);
  } finally { h.fechar(); }
});

test("aluno: erro de rede não gera nova tentativa (só resposta fora do padrão é repetida)", async () => {
  const h = await A.entrarAluno({ rotas: { resumo: { rede: true } } });
  try {
    await A.abrirLicao(h);
    assert.equal(A.chamadasResumo(h.ia), 1);
    assert.match(h.texto(), /Resumo automático indisponível/);
  } finally { h.fechar(); }
});

test("aluno: resumo já em cache (formato antigo, sem títulos) continua sendo usado — compatibilidade", async () => {
  const h = await A.entrarAluno({ seedCompleto: F.banco({ licoes_geradas: { L1: { licaoId: "L1", resumo: "Resumo antigo de 2025 sem títulos." } } }) });
  try {
    await A.abrirLicao(h);
    assert.match(h.texto(), /Resumo antigo de 2025/);
    assert.equal(A.chamadasResumo(h.ia), 0);
  } finally { h.fechar(); }
});

// ---------------- professor (regenerarConteudoIA: validação do conteúdo em seções) ----------------
const { conteudoPadrao, VOCAB_TESTES } = require("../support/preparo-helpers");
const comCache = () => F.banco({ licoes_geradas: { L1: { licaoId: "L1", resumo: "RESUMO ANTIGO" } } });
// altera o texto de cada seção mantendo as palavras do tópico (a cobertura continua válida)
const variar = (f, semExtras) => ch => {
  const c = JSON.parse(conteudoPadrao(ch, VOCAB_TESTES));
  c.secoes.forEach(sec => { sec.texto = f(sec); });
  if (semExtras) { c.verificacao = []; c.resumo_final = []; }
  return JSON.stringify(c);
};
const primeiraLinha = sec => sec.texto.split("\n")[0].slice(0, 120);
const CASOS = [
  ["curto demais", variar(sec => primeiraLinha(sec) + " Exemplo 1. Exemplo 2."), /curto demais/], // títulos: seção + verificação + resumo
  ["sem exemplos", variar(sec => sec.texto.replace(/Exemplo/g, "Caso")), /menos de 2 exemplos/],
  ["em inglês", variar(sec => primeiraLinha(sec) + " Exemplo 1. Exemplo 2. " + "Adding means putting quantities together to find the total. ".repeat(14)), /não parece estar em português/],
  ["longo demais", variar(sec => sec.texto + " Somar de novo é juntar mais uma vez.".repeat(70)), /longo demais/],
];
for (const [nome, conteudo, motivo] of CASOS) {
  test(`professor: conteúdo ${nome} (2x) → erro claro, conteúdo anterior mantido, nada gravado`, async () => {
    const h = await abrirProfessor({ seed: comCache(), editar: "L1", preparo: { conteudo } });
    try {
      await h.clicar(/Regenerar conteúdo com IA/);
      assert.equal(h.preparo.de("conteudo").length, 2, "fora do padrão → pede de novo 1x");
      assert.match(erroIA(h), motivo);
      assert.match(erroIA(h), /fora do padrão .*Nada foi alterado/);
      assert.equal(h.store.doc("licoes_geradas", "L1").resumo, "RESUMO ANTIGO");
      assert.equal(h.store.log.length, 0);
      assert.notEqual(ultimoToast(h), "Resumo regenerado e salvo no cache! ✅");
    } finally { h.fechar(); }
  });
}

test("professor: 1º conteúdo fora do padrão, 2º válido → grava o válido e anuncia sucesso", async () => {
  const h = await abrirProfessor({ seed: comCache(), editar: "L1", preparo: { conteudo: [CASOS[0][1], ch => conteudoPadrao(ch, VOCAB_TESTES)] } });
  try {
    await h.clicar(/Regenerar conteúdo com IA/);
    assert.equal(h.preparo.de("conteudo").length, 2);
    assert.match(h.store.doc("licoes_geradas", "L1").resumo, /^## Tema da descrição/);
    assert.equal(ultimoToast(h), "Resumo regenerado e salvo no cache! ✅");
    assert.equal(h.store.doc("licoes", "L1").exercicios.length, 3, "exercícios intactos");
  } finally { h.fechar(); }
});
