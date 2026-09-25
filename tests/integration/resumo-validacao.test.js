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

// ---------------- professor (regenerarConteudoIA) ----------------
const comCache = () => F.banco({ licoes_geradas: { L1: { licaoId: "L1", resumo: "RESUMO ANTIGO" } } });

for (const [nome, resposta, motivo] of [
  ["curto demais", CURTO, /curto demais/],
  ["sem exemplos", SEM_EXEMPLOS, /menos de 2 exemplos/],
  ["em inglês", "## What\n## Exemplo 1\n## Exemplo 2\n" + "Adding means putting quantities together to find the total. ".repeat(12), /não parece estar em português/],
  ["longo demais", F.RESUMO_DIDATICO + "\n" + "Somar de novo é juntar mais uma vez. ".repeat(80), /longo demais/],
]) {
  test(`professor: resposta ${nome} (2x) → erro claro, resumo anterior mantido, nada gravado`, async () => {
    const h = await abrirProfessor({ seed: comCache(), editar: "L1" });
    try {
      h.ia.fila(resposta, resposta);
      await h.clicar(/Regenerar conteúdo com IA/);
      assert.equal(h.ia.chamadas.length, 2);
      assert.match(erroIA(h), motivo);
      assert.match(erroIA(h), /resumo anterior foi mantido/);
      assert.equal(h.store.doc("licoes_geradas", "L1").resumo, "RESUMO ANTIGO");
      assert.equal(h.store.log.length, 0);
      assert.notEqual(ultimoToast(h), "Resumo regenerado e salvo no cache! ✅");
    } finally { h.fechar(); }
  });
}

test("professor: 1ª resposta fora do padrão, 2ª válida → grava a válida e anuncia sucesso", async () => {
  const h = await abrirProfessor({ seed: comCache(), editar: "L1" });
  try {
    h.ia.fila(CURTO, F.RESUMO_DIDATICO);
    await h.clicar(/Regenerar conteúdo com IA/);
    assert.equal(h.ia.chamadas.length, 2);
    assert.equal(h.store.doc("licoes_geradas", "L1").resumo, F.RESUMO_DIDATICO.trim());
    assert.equal(ultimoToast(h), "Resumo regenerado e salvo no cache! ✅");
    assert.equal(h.store.doc("licoes", "L1").exercicios.length, 3, "exercícios intactos");
  } finally { h.fechar(); }
});
