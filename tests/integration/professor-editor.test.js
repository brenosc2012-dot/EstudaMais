// Professor: mutações do editor de exercícios (tipo, opções, correta, nível, adicionar/remover).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, F } = require("../support/professor-helpers");

/** Lê os cartões do editor a partir do DOM (o estado do editor não é exposto). */
function cartoes(h) {
  return [...h.document.querySelectorAll(".ex-edit-card")].map(c => ({
    tipo: c.querySelector("select").value,
    nivel: c.querySelectorAll("select")[1].value,
    enunciado: c.querySelectorAll("input")[0].value,
    opcoes: [...c.querySelectorAll(".opt-row input")].map(i => i.value),
    correta: [...c.querySelectorAll(".opt-row .pick")].findIndex(b => /58cc02/.test(b.getAttribute("style"))),
    resposta: c.querySelector(".opt-row") ? null : c.querySelectorAll("input")[1] && c.querySelectorAll("input")[1].value,
    readonly: [...c.querySelectorAll(".opt-row input")].some(i => i.readOnly),
  }));
}

test("adicionar exercício cria um card de múltipla escolha com 2 opções vazias", async () => {
  const h = await abrirProfessor();
  await h.clicar(/Criar nova lição/);
  assert.match(h.texto(), /Nenhum exercício ainda/);
  await h.clicar(/Adicionar exercício/);
  const [c] = cartoes(h);
  assert.equal(c.tipo, "mc"); assert.equal(c.nivel, ""); assert.deepEqual(c.opcoes, ["", ""]); assert.equal(c.correta, 0);
  h.fechar();
});

test("trocar tipo: V/F fixa as opções (somente leitura); lacuna mostra campo de resposta; volta a MC", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.App.setExType(0, "vf"); await h.estabilizar();
  let c = cartoes(h)[0];
  assert.deepEqual(c.opcoes, ["Verdadeiro", "Falso"]); assert.equal(c.readonly, true); assert.equal(c.correta, 0);
  h.App.setExType(0, "fill"); await h.estabilizar();
  c = cartoes(h)[0];
  assert.equal(c.tipo, "fill"); assert.deepEqual(c.opcoes, []);
  assert.match(h.document.querySelector(".ex-edit-card").textContent, /Resposta correta/);
  h.App.setExType(0, "mc"); await h.estabilizar();
  assert.equal(cartoes(h)[0].tipo, "mc");
  h.fechar();
});

test("V/F com correta fora do intervalo volta para 0", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L1: F.licao({ exercicios: [F.mc(1, { correta: 3 })] }) } }, editar: "L1" });
  h.App.setExType(0, "vf"); await h.estabilizar();
  assert.equal(cartoes(h)[0].correta, 0);
  h.fechar();
});

test("opções: adicionar até 6 (botão some), remover ajusta a correta, mínimo de 2", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  assert.equal(cartoes(h)[0].opcoes.length, 4);
  h.App.addOpt(0); h.App.addOpt(0); await h.estabilizar();
  assert.equal(cartoes(h)[0].opcoes.length, 6);
  const card = h.document.querySelector(".ex-edit-card");
  assert.equal([...card.querySelectorAll("button")].some(b => /\+ opção/.test(b.textContent)), false, "sem botão acima de 6");
  h.App.setCorrect(0, 5); await h.estabilizar();
  assert.equal(cartoes(h)[0].correta, 5);
  h.App.removeOpt(0, 5); await h.estabilizar();
  assert.equal(cartoes(h)[0].opcoes.length, 5);
  assert.equal(cartoes(h)[0].correta, 0, "correta removida volta para a 1ª");
  for (let i = 0; i < 3; i++) h.App.removeOpt(0, 0);
  await h.estabilizar();
  assert.equal(cartoes(h)[0].opcoes.length, 2);
  assert.equal(h.document.querySelector(".ex-edit-card").querySelectorAll('[title="Remover opção"]').length, 0, "não permite menos de 2");
  h.fechar();
});

test("nível e enunciado editados vão para o banco ao salvar; remover exercício", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.App.setExNivel(1, "dificil");
  h.App.setExEnun(1, "Enunciado novo");
  h.App.setOpt(1, 0, "cinco");
  h.App.setCorrect(1, 2);
  h.App.removeExercise(0);
  await h.estabilizar();
  assert.equal(cartoes(h).length, 2);
  await h.clicar(/Salvar lição/);
  const exs = h.store.doc("licoes", "L1").exercicios;
  assert.equal(exs.length, 2);
  assert.equal(exs[0].id, "ex2");
  assert.equal(exs[0].nivel, "dificil"); assert.equal(exs[0].enunciado, "Enunciado novo");
  assert.equal(exs[0].opcoes[0], "cinco"); assert.equal(exs[0].correta, 2);
  h.fechar();
});

test("digitar título e trocar tipo de exercício não perde o texto digitado (syncTextInputs)", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await h.preencher("lTitulo", "Título digitado");
  await h.preencher("lTexto", "Texto digitado");
  h.App.setExType(0, "vf"); await h.estabilizar();
  assert.equal(h.campo("lTitulo").value, "Título digitado");
  assert.equal(h.campo("lTexto").value, "Texto digitado");
  h.fechar();
});

test("trocar nível de ensino reseta o ano e lista só os anos do nível", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.campo("lNivel").value = "medio"; h.App.onLessonNivel("medio"); await h.estabilizar();
  const anos = [...h.campo("lAno").options].map(o => o.value);
  assert.deepEqual(anos, ["", "1º ano EM", "2º ano EM", "3º ano EM"]);
  assert.equal(h.campo("lAno").value, "");
  h.fechar();
});
