// Jornadas E2E do PROFESSOR (navegador real; Firebase/OpenAI falsos).
"use strict";
const { test, expect } = require("./base");
const F = require("../support/fixtures");
const { iaRoteada, adiado, loginProfessor, abrirEditorL1, loginAluno, PROMPT } = require("./helpers");

const PROF = { tipo: "professor", id: "p1" };
const RESUMO_ANTIGO = "## Resumo antigo\nSomar é juntar.";
const bancoComResumo = () => F.banco({ licoes_geradas: { L1: { licaoId: "L1", resumo: RESUMO_ANTIGO } } });

test("professor faz login, abre uma lição existente e cria uma nova lição com exercício", async ({ app, page }) => {
  await app.abrir({ seed: F.banco() });
  await loginProfessor(page, "carlos@escola.com", "prof123");

  // abre a lição existente
  await abrirEditorL1(page);
  await expect(page.locator("#lTexto")).toHaveValue("Somar é juntar quantidades.");
  await expect(page.getByPlaceholder("Escreva a pergunta")).toHaveCount(3);
  await page.getByRole("button", { name: "Cancelar" }).click();

  // cria uma nova
  await page.getByRole("button", { name: /Criar nova lição/ }).click();
  await page.locator("#lTitulo").fill("Subtração");
  await page.locator("#lTexto").fill("Subtrair é tirar uma quantidade de outra.");
  await page.locator("#lNivel").selectOption("fund1");
  await page.locator("#lAno").selectOption("3º ano");
  await page.locator("#lTurma").selectOption("A");
  await expect(page.locator("#lTitulo")).toHaveValue("Subtração"); // o re-render do nível não perdeu o título
  await page.getByRole("button", { name: /Adicionar exercício/ }).click();
  await page.getByPlaceholder("Escreva a pergunta").fill("Quanto é 5 - 2?");
  await page.getByPlaceholder("Opção 1").fill("3");
  await page.getByPlaceholder("Opção 2").fill("7");
  await page.getByRole("button", { name: /Salvar lição/ }).click();

  await expect(page.getByText("✅ Lição salva com sucesso!")).toBeVisible();
  await expect(page.getByText("Subtração")).toBeVisible();
  const licoes = await app.colecao("licoes");
  const nova = Object.values(licoes).find(l => l.titulo === "Subtração");
  expect(nova).toMatchObject({ disciplina: "mat", conteudo: "Subtrair é tirar uma quantidade de outra.", nivel: "fund1", ano: "3º ano", turma: "A", tipo: "padrao" });
  expect(nova.exercicios).toHaveLength(1);
  expect(nova.exercicios[0]).toMatchObject({ tipo: "mc", enunciado: "Quanto é 5 - 2?", opcoes: ["3", "7"], correta: 0 });
  expect(licoes.L1.titulo).toBe("Somas simples"); // a outra lição não foi tocada
  expect(app.errosPagina).toEqual([]);
});

test("professor regenera o conteúdo explicativo e o aluno passa a ver o novo resumo", async ({ app, page }) => {
  const ia = await iaRoteada(page, [{ se: PROMPT.resumo, resposta: F.RESUMO_DIDATICO }]);
  await app.abrir({ seed: bancoComResumo(), sessao: PROF });
  await abrirEditorL1(page);
  const exerciciosAntes = (await app.doc("licoes", "L1")).exercicios;

  page.once("dialog", d => { expect(d.message()).toMatch(/Regenerar o resumo de estudo/); d.accept(); });
  await page.getByRole("button", { name: /Regenerar conteúdo com IA/ }).click();
  await expect(page.getByText("Resumo regenerado e salvo no cache! ✅")).toBeVisible();

  expect(ia.de(PROMPT.resumo)).toHaveLength(1);
  expect(ia.de(PROMPT.resumo)[0].prompt).toContain("Tema: Somas simples");
  await expect.poll(async () => (await app.doc("licoes_geradas", "L1")).resumo).toBe(F.RESUMO_DIDATICO);
  expect((await app.doc("licoes", "L1")).exercicios).toEqual(exerciciosAntes); // só o conteúdo mudou

  // o aluno vê o resumo novo (vindo do cache, sem nova chamada de resumo à IA)
  await page.getByTitle("Sair").click();
  await loginAluno(page, "Ana Souza", "senha123");
  await page.getByText("Matemática", { exact: true }).click();
  await page.getByText("Somas simples", { exact: true }).click();
  await expect(page.getByText("O que é somar?")).toBeVisible();
  await expect(page.getByText("Resumo antigo")).toHaveCount(0);
  expect(ia.de(PROMPT.resumo)).toHaveLength(1);
  expect(app.errosPagina).toEqual([]);
});

test("professor regenera os exercícios: loading, questões novas na tela e no banco, resumo intacto", async ({ app, page }) => {
  const segura = adiado();
  const ia = await iaRoteada(page, [{ se: PROMPT.regenerarExercicios, resposta: async () => { await segura.p; return F.json(F.questoesIA(3)); } }]);
  await app.abrir({ seed: bancoComResumo(), sessao: PROF });
  await abrirEditorL1(page);

  page.once("dialog", d => { expect(d.message()).toBe("A regeneração substituirá os exercícios atuais por novas questões. As tentativas e respostas relacionadas poderão ser afetadas. Deseja continuar?"); d.accept(); });
  await page.getByRole("button", { name: /Regenerar exercícios com IA \(3\)/ }).click();

  // carregando: os botões de IA somem (bloqueio de novo clique) e o salvar é recusado
  await expect(page.getByText(/Gerando e validando 3 exercícios novos com IA/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Regenerar exercícios/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Salvar lição/ }).click();
  await expect(page.getByText("Aguarde a regeneração dos exercícios terminar.")).toBeVisible();
  segura.liberar();

  await expect(page.getByText(/3 exercícios novos salvos/)).toBeVisible();
  const enunciados = page.getByPlaceholder("Escreva a pergunta");
  await expect(enunciados).toHaveCount(3);
  await expect(enunciados.first()).toHaveValue(/Maria tinha 10 figurinhas/);

  const licao = await app.doc("licoes", "L1");
  expect(licao.exercicios.map(e => e.enunciado)).toEqual(F.questoesIA(3).map(q => q.enunciado));
  expect(licao.exercicios.every(e => e.tipo === "mc" && e.correta === 0)).toBe(true);
  expect(Object.keys(licao.explicacoes).sort()).toEqual(licao.exercicios.map(e => e.id).sort());
  expect(licao.exerciciosVersao).toBe(1);
  expect(licao.titulo).toBe("Somas simples");
  expect(licao.conteudo).toBe("Somar é juntar quantidades.");
  const cache = await app.doc("licoes_geradas", "L1");
  expect(cache.resumo).toBe(RESUMO_ANTIGO); // o conteúdo explicativo não muda
  expect(cache.exercicios).toHaveLength(3);
  // a IA recebeu as questões atuais para não repetir e o texto de estudo
  const prompt = ia.de(PROMPT.regenerarExercicios)[0].prompt;
  expect(prompt).toContain("Quanto é 1 + 1?");
  expect(prompt).toContain("Resumo antigo");
  expect(prompt).toContain("exatamente 3 exercícios NOVOS");
  expect(ia.chamadas).toHaveLength(1);
  expect(app.errosPagina).toEqual([]);
});

test("professor cancela a regeneração: nenhuma chamada à IA e banco inalterado", async ({ app, page }) => {
  const ia = await iaRoteada(page, []);
  await app.abrir({ seed: bancoComResumo(), sessao: PROF });
  await abrirEditorL1(page);
  const licaoAntes = await app.doc("licoes", "L1");
  const cacheAntes = await app.doc("licoes_geradas", "L1");
  const escritasAntes = (await app.escritas()).length;

  page.once("dialog", d => d.dismiss());
  await page.getByRole("button", { name: /Regenerar exercícios com IA/ }).click();
  page.once("dialog", d => d.dismiss());
  await page.getByRole("button", { name: /Regenerar conteúdo com IA/ }).click();

  await expect(page.getByPlaceholder("Escreva a pergunta").first()).toHaveValue("Quanto é 1 + 1?");
  await expect(page.getByRole("button", { name: /Regenerar exercícios com IA/ })).toBeEnabled();
  expect(ia.chamadas).toHaveLength(0);
  expect(await app.doc("licoes", "L1")).toEqual(licaoAntes);
  expect(await app.doc("licoes_geradas", "L1")).toEqual(cacheAntes);
  expect((await app.escritas()).length).toBe(escritasAntes);
});
