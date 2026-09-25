// Jornadas E2E de PERMISSÃO e de FALHA DA IA (navegador real; Firebase/OpenAI falsos).
"use strict";
const { test, expect } = require("./base");
const F = require("../support/fixtures");
const { iaRoteada, abrirEditorL1, PROMPT } = require("./helpers");

const PROF = { tipo: "professor", id: "p1" };
const ALUNO = { tipo: "aluno", id: "a1" };
const RESUMO_ANTIGO = "## Resumo antigo\nSomar é juntar.";
const bancoComResumo = () => F.banco({ licoes_geradas: { L1: { licaoId: "L1", resumo: RESUMO_ANTIGO } } });
const ADMIN = ["licoes", "licoes_geradas", "historias_geradas", "config", "professores"];

async function escritasAdministrativas(app) {
  const todas = await app.escritas();
  return todas.filter(e => ADMIN.includes(e.caminho.split("/")[0]));
}

test.describe("usuário sem permissão", () => {
  test("senha de administrador errada não libera a configuração da IA", async ({ app, page }) => {
    await app.abrir({ seed: F.banco() });
    await page.getByRole("button", { name: /Administrador/ }).click();
    await page.locator("#admSenha").fill("chute-errado");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByText("Senha de administrador incorreta.")).toBeVisible();
    await expect(page.getByText("Configuração da IA")).toHaveCount(0);
    await expect(page.locator("#admKey")).toHaveCount(0);
    expect(await escritasAdministrativas(app)).toEqual([]);
  });

  test("aluno logado não vê ações de professor nem a chave da IA", async ({ app, page }) => {
    await app.abrir({ seed: F.banco(), sessao: ALUNO });
    await expect(page.getByText("Olá, Ana Souza")).toBeVisible();
    for (const nome of [/Regenerar/, /Salvar lição/, /Criar nova lição/, /Lições$/, /Rendi/, /Corretor/]) {
      await expect(page.getByRole("button", { name: nome })).toHaveCount(0);
    }
    const html = await page.content();
    expect(html).not.toContain("sk-teste-NAO-REAL");
    await page.getByText("Matemática", { exact: true }).click();
    await expect(page.getByTitle("Editar")).toHaveCount(0);
    await expect(page.getByTitle("Excluir")).toHaveCount(0);
  });

  test("aluno chamando App.regenerarExerciciosIA / regenerarConteudoIA / saveLesson direto não altera o banco", async ({ app, page }) => {
    const ia = await iaRoteada(page, [], F.json(F.questoesIA(3)));
    await app.abrir({ seed: bancoComResumo(), sessao: ALUNO });
    await expect(page.getByText("Olá, Ana Souza")).toBeVisible();
    page.on("dialog", d => d.accept());
    const licaoAntes = await app.doc("licoes", "L1");

    await page.evaluate(async () => {
      for (const fn of ["regenerarExerciciosIA", "regenerarConteudoIA", "saveLesson"]) {
        try { await window.App[fn](); } catch (_) { /* a recusa pode ser por exceção */ }
      }
    });

    expect(ia.de(PROMPT.regenerarExercicios)).toHaveLength(0);
    expect(await escritasAdministrativas(app)).toEqual([]);
    expect(await app.doc("licoes", "L1")).toEqual(licaoAntes);
  });

  test("aluno chamando App.deleteLesson direto não exclui a lição", async ({ app, page }) => {
    await app.abrir({ seed: F.banco(), sessao: ALUNO });
    await expect(page.getByText("Olá, Ana Souza")).toBeVisible();
    page.on("dialog", d => d.accept());

    await page.evaluate(async () => { try { await window.App.deleteLesson("L1"); } catch (_) { /* recusa */ } });

    expect(await app.doc("licoes", "L1")).toBeDefined();
    expect(await escritasAdministrativas(app)).toEqual([]);
  });

  test("aluno chamando App.editLesson + App.saveLesson direto não sobrescreve a lição", async ({ app, page }) => {
    await app.abrir({ seed: F.banco(), sessao: ALUNO });
    await expect(page.getByText("Olá, Ana Souza")).toBeVisible();
    page.on("dialog", d => d.accept());
    const licaoAntes = await app.doc("licoes", "L1");

    await page.evaluate(async () => {
      try { window.App.editLesson("L1"); await window.App.saveLesson(); } catch (_) { /* recusa */ }
    });

    expect(await escritasAdministrativas(app)).toEqual([]);
    expect(await app.doc("licoes", "L1")).toEqual(licaoAntes);
  });
});

test.describe("falha da IA sem perda de conteúdo nem de exercícios", () => {
  test.beforeEach(async ({ page }) => { await page.clock.install(); });

  test("limite de uso (429) ao regenerar o conteúdo: erro visível e resumo anterior preservado", async ({ app, page }) => {
    await iaRoteada(page, [{ se: PROMPT.resumo, resposta: { status: 429 } }]);
    await app.abrir({ seed: bancoComResumo(), sessao: PROF });
    await abrirEditorL1(page);
    page.once("dialog", d => d.accept());
    await page.getByRole("button", { name: /Regenerar conteúdo com IA/ }).click();

    await expect(page.getByText(/Erro 429 — Limite de uso atingido/)).toBeVisible();
    expect((await app.doc("licoes_geradas", "L1")).resumo).toBe(RESUMO_ANTIGO);
    expect((await app.doc("licoes", "L1")).exercicios).toHaveLength(3);
    await expect(page.getByPlaceholder("Escreva a pergunta").first()).toHaveValue("Quanto é 1 + 1?");
  });

  test("falha de rede ao regenerar os exercícios: erro visível e exercícios preservados", async ({ app, page }) => {
    await iaRoteada(page, [{ se: PROMPT.regenerarExercicios, resposta: { rede: true } }]);
    await app.abrir({ seed: bancoComResumo(), sessao: PROF });
    await abrirEditorL1(page);
    const antes = await app.doc("licoes", "L1");
    page.once("dialog", d => d.accept());
    await page.getByRole("button", { name: /Regenerar exercícios com IA/ }).click();

    await expect(page.getByText(/Falha na chamada à OpenAI.*Os exercícios atuais foram mantidos\./)).toBeVisible();
    expect(await app.doc("licoes", "L1")).toEqual(antes);
    await expect(page.getByPlaceholder("Escreva a pergunta")).toHaveCount(3);
    await expect(page.getByPlaceholder("Escreva a pergunta").first()).toHaveValue("Quanto é 1 + 1?");
    await expect(page.getByRole("button", { name: /Regenerar exercícios com IA/ })).toBeEnabled(); // pode tentar de novo
  });

  test("timeout da IA ao regenerar exercícios e conteúdo: mensagens de erro e nada perdido", async ({ app, page }) => {
    await iaRoteada(page, [{ se: PROMPT.regenerarExercicios, resposta: { pendurar: true } }, { se: PROMPT.resumo, resposta: { pendurar: true } }]);
    await app.abrir({ seed: bancoComResumo(), sessao: PROF });
    await abrirEditorL1(page);
    const antes = await app.doc("licoes", "L1");

    page.once("dialog", d => d.accept());
    await page.getByRole("button", { name: /Regenerar exercícios com IA/ }).click();
    await expect(page.getByText(/Gerando e validando/)).toBeVisible();
    await page.clock.runFor(46000);
    await expect(page.getByText("⚠️ A IA demorou demais para responder. Tente novamente. Os exercícios atuais foram mantidos.")).toBeVisible();

    page.once("dialog", d => d.accept());
    await page.getByRole("button", { name: /Regenerar conteúdo com IA/ }).click();
    await expect(page.getByText(/Regenerando conteúdo com IA/)).toBeVisible();
    await page.clock.runFor(26000);
    await expect(page.getByText("⚠️ A IA demorou demais para responder. Tente novamente.")).toBeVisible();

    expect(await app.doc("licoes", "L1")).toEqual(antes);
    expect((await app.doc("licoes_geradas", "L1")).resumo).toBe(RESUMO_ANTIGO);
  });

  test("JSON malformado da IA (2 tentativas) ao regenerar exercícios: rejeitado e exercícios preservados", async ({ app, page }) => {
    const ia = await iaRoteada(page, [{ se: PROMPT.regenerarExercicios, resposta: "isto não é JSON {[" }]);
    await app.abrir({ seed: bancoComResumo(), sessao: PROF });
    await abrirEditorL1(page);
    const antes = await app.doc("licoes", "L1");
    page.once("dialog", d => d.accept());
    await page.getByRole("button", { name: /Regenerar exercícios com IA/ }).click();

    await expect(page.getByText(/A IA devolveu questões inválidas.*Os exercícios atuais foram mantidos\./)).toBeVisible();
    expect(ia.de(PROMPT.regenerarExercicios)).toHaveLength(2);
    expect(await app.doc("licoes", "L1")).toEqual(antes);
  });
});
