// Helpers das jornadas E2E.
// iaRoteada: OpenAI falsa que responde conforme o CONTEÚDO do prompt (e não pela ordem
// de chegada) — o app faz chamadas em segundo plano (pré-geração de explicações) que
// tornariam uma fila FIFO imprevisível. Registrada depois das rotas da base, tem precedência.
"use strict";
const { expect } = require("./base");

const PROMPT = {
  resumo: /TEXTO DE ESTUDO/,
  explicacaoErro: /errou a seguinte questão/,
  pregeracao: /pode errar a seguinte questão/,
  regenerarExercicios: /serão SUBSTITUÍDOS/,
};

/**
 * regras: [{ se: RegExp, resposta: item | (chamada) => item | Promise<item> }]
 * item: "texto" | { status, mensagem } | { rede: true } | { pendurar: true }
 */
async function iaRoteada(page, regras, padrao) {
  const chamadas = [];
  await page.route(/api\.openai\.com|workers\.dev/, async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || "{}"); } catch (_) { /* corpo inválido */ }
    const prompt = (body.messages || []).map(m => (typeof m.content === "string" ? m.content : "")).join("\n");
    const chamada = { body, prompt };
    chamadas.push(chamada);
    const regra = (regras || []).find(r => r.se.test(prompt));
    let item = regra ? regra.resposta : (padrao === undefined ? "Resposta padrão da IA." : padrao);
    if (typeof item === "function") item = await item(chamada);
    if (typeof item === "string") item = { texto: item };
    if (item.rede) return route.abort("failed");
    if (item.pendurar) return; // nunca responde: o app aborta por timeout
    const cabecalhos = { "access-control-allow-origin": "*" };
    if (item.status) return route.fulfill({ status: item.status, contentType: "application/json", headers: cabecalhos, body: JSON.stringify({ error: { message: item.mensagem || "" } }) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: cabecalhos, body: JSON.stringify({ choices: [{ message: { content: item.texto } }] }) });
  });
  return {
    chamadas,
    de: re => chamadas.filter(c => re.test(c.prompt)),
  };
}

/** Promessa controlável (segura a resposta da IA para observar o loading). */
function adiado() {
  let liberar;
  const p = new Promise(r => { liberar = r; });
  return { p, liberar };
}

async function loginAluno(page, nome, senha) {
  await page.getByRole("button", { name: /Sou Aluno/ }).click();
  await page.locator("#laNome").fill(nome);
  await page.locator("#laSenha").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText(`Olá, ${nome}`)).toBeVisible();
}
async function loginProfessor(page, email, senha) {
  await page.getByRole("button", { name: /Sou Professor/ }).click();
  await page.locator("#lpEmail").fill(email);
  await page.locator("#lpSenha").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("button", { name: /Lições/ })).toBeVisible();
}

/** Da home do aluno até a 1ª questão (Modo Clássico). Requer page.clock instalado. */
async function abrirLicaoEComecar(page, titulo) {
  await page.getByText("Matemática", { exact: true }).click();
  await page.getByText(titulo, { exact: true }).click();
  const estudei = page.locator("#btnEstudei");
  await expect(estudei).toBeDisabled();
  await page.clock.runFor(10500); // contagem regressiva de 10s da tela de estudo
  await expect(estudei).toBeEnabled();
  await estudei.click();
  await page.getByRole("button", { name: /Modo Clássico/ }).click();
  await expect(page.getByText(/Questão 1 de \d+/)).toBeVisible();
}

const RE_ENUNCIADO = /^Quanto é (\d+) \+ \d+\?$/;
/** Responde a questão atual (fixtures.mc: resposta certa = 2·i, errada = 2·i+1). Devolve o enunciado. */
async function responder(page, { certo }) {
  const enunciado = (await page.getByText(RE_ENUNCIADO).textContent()).trim();
  const i = Number(enunciado.match(RE_ENUNCIADO)[1]);
  await page.locator("#optWrap").getByText(String(certo ? 2 * i : 2 * i + 1), { exact: true }).click();
  await page.getByRole("button", { name: "Verificar" }).click();
  return enunciado;
}

/** Sessão do professor aberta no editor da lição L1. */
async function abrirEditorL1(page) {
  await expect(page.getByText("Somas simples")).toBeVisible();
  await page.getByTitle("Editar").click();
  await expect(page.locator("#lTitulo")).toHaveValue("Somas simples");
}

module.exports = { iaRoteada, adiado, loginAluno, loginProfessor, abrirLicaoEComecar, responder, abrirEditorL1, PROMPT, RE_ENUNCIADO };
