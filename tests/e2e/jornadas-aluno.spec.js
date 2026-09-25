// Jornadas E2E do ALUNO (navegador real; Firebase/OpenAI falsos).
"use strict";
const { test, expect } = require("./base");
const F = require("../support/fixtures");
const { iaRoteada, loginAluno, abrirLicaoEComecar, responder, PROMPT, RE_ENUNCIADO } = require("./helpers");

const ALUNO = { tipo: "aluno", id: "a1" };


test.beforeEach(async ({ page }) => {
  await page.clock.install(); // controla a contagem de 10s e os timers do app
});

test("aluno faz login, abre a lição e estuda o resumo gerado pela IA", async ({ app, page }) => {
  const ia = await iaRoteada(page, [{ se: PROMPT.resumo, resposta: F.RESUMO_DIDATICO }]);
  await app.abrir({ seed: F.banco() });
  await loginAluno(page, "Ana Souza", "senha123");

  await page.getByText("Matemática", { exact: true }).click();
  await page.getByText("Somas simples", { exact: true }).click();

  await expect(page.getByText("O que é somar?")).toBeVisible();
  await expect(page.getByText("✨ Gerado por IA")).toBeVisible();
  await expect(page.getByText("Cuidado!")).toBeVisible();
  // o prompt levou o contexto da lição
  const prompt = ia.de(PROMPT.resumo)[0].prompt;
  expect(prompt).toContain("Tema: Somas simples");
  expect(prompt).toContain("Disciplina: Matemática");
  expect(prompt).toContain("3º ano");

  const estudei = page.locator("#btnEstudei");
  await expect(estudei).toBeDisabled();
  await page.clock.runFor(5000);
  await expect(estudei).toBeDisabled();
  await page.clock.runFor(5500);
  await expect(estudei).toBeEnabled();
  await expect(estudei).toHaveText(/Já estudei, quero responder/);

  // resumo salvo no cache compartilhado (outros aparelhos não chamam a IA de novo)
  await expect.poll(async () => (await app.doc("licoes_geradas", "L1") || {}).resumo).toBe(F.RESUMO_DIDATICO);
  expect(app.errosPagina).toEqual([]);
});

test("aluno responde tudo certo e conclui: XP na tela e progresso gravado", async ({ app, page }) => {
  await iaRoteada(page, [{ se: PROMPT.resumo, resposta: F.RESUMO_DIDATICO }]);
  await app.abrir({ seed: F.banco(), sessao: ALUNO });
  await abrirLicaoEComecar(page, "Somas simples");

  for (let q = 1; q <= 3; q++) {
    await expect(page.getByText(`Questão ${q} de 3`)).toBeVisible();
    await responder(page, { certo: true });
    await expect(page.getByText("🎉 Muito bem!")).toBeVisible();
    await page.getByRole("button", { name: "Continuar" }).click();
  }

  await expect(page.getByRole("heading", { name: "Lição Concluída!" })).toBeVisible();
  await expect(page.getByText(/Você acertou 3 de 3 exercícios/)).toBeVisible();
  await expect(page.getByText("🎯 Gabarito perfeito!")).toBeVisible();
  await expect(page.getByText(/^\+\d+$/)).toBeVisible(); // XP ganho

  await expect.poll(async () => app.doc("progresso", "a1_L1")).toMatchObject({
    alunoId: "a1", licaoId: "L1", acertos: 3, erros: 0, total: 3, percentualAcertos: 100, concluido: true, modo: "classico",
  });
  await expect.poll(async () => (await app.doc("alunos", "a1")).xpTotal).toBeGreaterThan(0);
  const aluno = await app.doc("alunos", "a1");
  expect(aluno.licoesConcluidas).toContain("L1");
  expect(app.errosPagina).toEqual([]);
});

test("aluno erra, vê a explicação da IA e a atividade reinicia com as questões em outra ordem", async ({ app, page }) => {
  const ia = await iaRoteada(page, [
    { se: PROMPT.resumo, resposta: F.RESUMO_DIDATICO },
    { se: PROMPT.pregeracao, resposta: { status: 500 } }, // força a explicação "ao vivo" no erro
    { se: PROMPT.explicacaoErro, resposta: "Tudo bem errar! Somar é juntar: 2 + 2 são 4 bolinhas." },
  ]);
  await app.abrir({ seed: F.banco(), sessao: ALUNO });
  await abrirLicaoEComecar(page, "Somas simples");

  const ordemInicial = [await responder(page, { certo: true })];
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("✅ 1 acerto")).toBeVisible();
  ordemInicial.push(await responder(page, { certo: false }));
  await expect(page.getByText(/Ops! Resposta certa/)).toBeVisible();

  await page.clock.runFor(1000); // feedback vermelho → pede a explicação
  await expect(page.getByText("Quase lá! Veja a explicação 💡")).toBeVisible();
  await expect(page.getByText(/Somar é juntar: 2 \+ 2 são 4 bolinhas/)).toBeVisible();
  await expect(page.getByText("Revise a explicação e tente novamente. A atividade será reiniciada com uma nova ordem de questões.")).toBeVisible();
  expect(ia.de(PROMPT.explicacaoErro)).toHaveLength(1);

  // o reinício só acontece depois de confirmar
  await expect(page.getByText(/Questão \d de 3/)).toHaveCount(0);
  await page.getByRole("button", { name: /Entendi, recomeçar a atividade/ }).click();
  await expect(page.getByText("Questão 1 de 3")).toBeVisible();
  await expect(page.getByText("✅ 0 acertos")).toBeVisible();

  const novaOrdem = [];
  for (let q = 1; q <= 3; q++) {
    await expect(page.getByText(`Questão ${q} de 3`)).toBeVisible();
    novaOrdem.push(await responder(page, { certo: true }));
    await page.getByRole("button", { name: "Continuar" }).click();
  }
  await expect(page.getByRole("heading", { name: "Lição Concluída!" })).toBeVisible();

  const originais = ["Quanto é 1 + 1?", "Quanto é 2 + 2?", "Quanto é 3 + 3?"];
  expect([...novaOrdem].sort()).toEqual(originais);            // mesmas questões, sem perda/duplicação
  expect(novaOrdem).not.toEqual(originais);                     // em outra ordem (1ª tentativa = ordem original)
  expect(ordemInicial).toEqual(originais.slice(0, 2));
  const licao = await app.doc("licoes", "L1");
  expect(licao.exercicios.map(e => e.enunciado)).toEqual(originais); // ordem permanente intacta
  await expect.poll(async () => app.doc("progresso", "a1_L1")).toMatchObject({ acertos: 3, erros: 0, total: 3 });
});

test("aluno recarrega a página no meio da tentativa: estado válido, logado e sem progresso indevido", async ({ app, page }) => {
  await iaRoteada(page, [{ se: PROMPT.resumo, resposta: F.RESUMO_DIDATICO }]);
  await app.abrir({ seed: F.banco(), sessao: ALUNO });
  await abrirLicaoEComecar(page, "Somas simples");
  await responder(page, { certo: true });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Questão 2 de 3")).toBeVisible();
  const xpAntes = (await app.doc("alunos", "a1")).xpTotal;

  await page.reload();
  await expect(page.locator("#app")).not.toContainText("Carregando");
  await expect(page.getByText("Olá, Ana Souza")).toBeVisible();
  await expect(page.getByText(RE_ENUNCIADO)).toHaveCount(0);   // a tentativa não "vaza" para a nova carga
  expect(await app.escritas("progresso")).toEqual([]);          // nada concluído foi gravado
  expect((await app.doc("alunos", "a1")).xpTotal).toBe(xpAntes);
  expect((await app.doc("licoes", "L1")).exercicios).toHaveLength(3);

  // e dá para recomeçar normalmente depois do reload
  await abrirLicaoEComecar(page, "Somas simples");
  await expect(page.getByText("✅ 0 acertos")).toBeVisible();
  expect(app.errosPagina).toEqual([]);
});
