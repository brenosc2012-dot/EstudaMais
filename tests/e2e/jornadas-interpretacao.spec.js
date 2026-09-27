// Jornada E2E: questão de interpretação (Inglês) com texto de apoio — ordem visual e
// legibilidade no celular e no desktop, texto visível durante a escolha e a correção.
"use strict";
const { test, expect } = require("./base");
const F = require("../support/fixtures");
const { iaRoteada, PROMPT } = require("./helpers");

const TEXTO = "Anna wakes up early every morning. She has breakfast with her family\nand then walks to school. Her favorite subject is Science.";
const seed = () => F.banco({ licoes: { L1: F.licao({
  disciplina: "ing", titulo: "Daily routine", conteudo: "Leitura de textos curtos sobre a rotina (daily routine).",
  exercicios: [
    { id: "t1", tipo: "mc", nivel: "facil", instrucao: "Read the text and answer the question.", textoApoio: TEXTO,
      enunciado: "How does Anna go to school?", opcoes: ["By bus", "By car", "On foot", "By bicycle"], correta: 2 },
    { id: "t2", tipo: "mc", nivel: "facil", instrucao: "Read the text and answer the question.", textoApoio: TEXTO,
      enunciado: "What is Anna's favorite subject?", opcoes: ["Math", "Science", "Art", "History"], correta: 1 },
  ],
}) } });

for (const [nome, viewport] of [["celular", { width: 360, height: 740 }], ["desktop", { width: 1280, height: 800 }]]) {
  test(`${nome}: instrução → texto → pergunta → alternativas; texto visível ao responder e na correção`, async ({ app, page }) => {
    await page.setViewportSize(viewport);
    await page.clock.install();
    await iaRoteada(page, [{ se: PROMPT.resumo, resposta: F.RESUMO_DIDATICO }]);
    await app.abrir({ seed: seed(), sessao: { tipo: "aluno", id: "a1" } });
    await page.getByText("Inglês", { exact: true }).click();
    await page.getByText("Daily routine", { exact: true }).click();
    await page.clock.runFor(10500);
    await page.locator("#btnEstudei").click();
    await page.getByRole("button", { name: /Modo Clássico/ }).click();

    const instrucao = page.getByText("Read the text and answer the question.");
    const texto = page.getByRole("region", { name: "Text" });
    const pergunta = page.getByText("How does Anna go to school?");
    const alternativa = page.locator("#optWrap").getByText("On foot", { exact: true });
    for (const el of [instrucao, texto, pergunta, alternativa]) await expect(el).toBeVisible();
    await expect(texto).toHaveAttribute("lang", "en");
    await expect(texto).toContainText("with her family\nand then walks", { useInnerText: true }); // quebra de linha preservada

    // ordem vertical na tela: instrução, texto, pergunta, alternativas
    const ys = [];
    for (const el of [instrucao, texto, pergunta, alternativa]) ys.push((await el.boundingBox()).y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));

    // sem rolagem horizontal e texto legível (≥ 16px) em qualquer tela
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const fonte = await texto.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(fonte).toBeGreaterThanOrEqual(16);

    await alternativa.click();
    await expect(texto).toBeVisible(); // durante a escolha
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByText("🎉 Muito bem!")).toBeVisible();
    await expect(texto).toBeVisible(); // na correção
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("What is Anna's favorite subject?")).toBeVisible();
    await expect(page.getByRole("region", { name: "Text" })).toContainText("favorite subject is Science"); // mesmo texto, 2ª pergunta
    expect(app.errosPagina).toEqual([]);
  });
}
