// Aluno: seleção de modo e Modo Clássico (mc / vf / lacuna, ordem por dificuldade, XP, contadores).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

test("seleção de modo: Clássico e História (+50% XP); História desativada some", async () => {
  let h = await A.entrarAluno({});
  await A.abrirLicao(h);
  await h.avancar(10000);
  await h.clicar(/Já estudei/);
  assert.ok(h.tem(/Modo Clássico/));
  assert.ok(h.tem(/Modo História.*\+50% XP/));
  h.fechar();
  h = await A.entrarAluno({ seed: { licoes: { L1: F.licao({ historiaHabilitada: false }) } } });
  await A.abrirLicao(h);
  await h.avancar(10000);
  await h.clicar(/Já estudei/);
  assert.ok(!h.tem(/Modo História/));
  assert.match(h.texto(), /O Modo História está desativado para esta lição/);
  h.fechar();
});

test("múltipla escolha: Verificar desabilitado até escolher; acerto mostra 'Muito bem!' e soma acerto", async () => {
  const h = await A.iniciarClassico({});
  assert.equal(h.botao("Verificar").disabled, true);
  h.document.querySelectorAll("#optWrap .opt")[0].click();
  await h.estabilizar();
  assert.equal(h.botao("Verificar").disabled, false);
  assert.equal(h.document.querySelectorAll("#optWrap .opt.selected").length, 1);
  await h.clicar("Verificar");
  assert.match(h.texto(), /🎉 Muito bem!/);
  assert.match(h.texto(), /✅ 1 acerto\b/);
  assert.equal(h.document.querySelectorAll("#optWrap .opt.correct").length, 1);
  // depois de respondida, trocar a opção não tem efeito
  h.App.selectOpt(2);
  await h.estabilizar();
  assert.equal(h.document.querySelectorAll("#optWrap .opt.selected").length, 0);
  await h.clicar("Continuar");
  assert.match(h.texto(), /Questão 2 de 3/);
  assert.ok(Math.abs(parseFloat(h.document.querySelector(".progress-fill").style.width) - 100 / 3) < 1e-6);
  h.fechar();
});

test("erro em múltipla escolha: marca a errada e a certa, perde 1 vida e mostra a resposta", async () => {
  const h = await A.iniciarClassico({});
  await A.errar(h);
  assert.equal(h.document.querySelectorAll("#optWrap .opt.wrong").length, 1);
  assert.equal(h.document.querySelectorAll("#optWrap .opt.correct").length, 1);
  assert.equal(h.document.querySelector(".hearts").textContent, "❤️❤️🤍");
  assert.match(h.texto(), /Ops! Resposta certa: 2/);
  assert.ok(h.sons.length > 0, "som de erro tocado");
  h.fechar();
});

test("verdadeiro/falso e lacuna: correção por conteúdo; lacuna ignora acento/maiúscula/espaço", async () => {
  const exs = [F.vf(1, 1, { nivel: "facil" }), F.fill(2, "Coração", { nivel: "facil" }), F.fill(3, "sol", { nivel: "facil" })];
  const h = await A.iniciarClassico({ seed: { licoes: { L1: F.licao({ exercicios: exs }) } } });
  assert.match(h.texto(), /Verdadeiro ou Falso/);
  assert.match(h.texto(), /V ?Verdadeiro/);
  await A.responder(h, 1); // Falso = correta
  assert.match(h.texto(), /Muito bem!/);
  await h.clicar("Continuar");
  assert.match(h.texto(), /Complete a lacuna/);
  // em branco: não verifica
  await h.clicar("Verificar");
  assert.doesNotMatch(h.texto(), /Muito bem!|Ops!/);
  await A.responder(h, "  CORACAO ");
  assert.match(h.texto(), /Muito bem!/);
  assert.equal(h.document.getElementById("fillAns").disabled, true);
  await h.clicar("Continuar");
  await A.responder(h, "lua");
  assert.match(h.texto(), /Ops! Resposta certa: sol/);
  h.fechar();
});

test("ordem por dificuldade (fácil → intermediário/sem nível → difícil) e XP por nível 10/20/30", async () => {
  const exs = [F.fill(1, "x", { nivel: "dificil" }), F.vf(2, 0, { nivel: "intermediario" }), F.mc(3, { nivel: "facil" }), F.mc(4, { nivel: "" })];
  const h = await A.iniciarClassico({ seed: { licoes: { L1: F.licao({ exercicios: exs }) } } });
  const vistos = [], xps = [];
  for (let i = 0; i < 4; i++) {
    const ex = A.exercicioAtual(h);
    vistos.push(ex.id);
    const pill = h.texto().match(/\+(\d+) XP/);
    xps.push(pill ? +pill[1] : null);
    await A.acertar(h); await h.clicar("Continuar");
  }
  assert.deepEqual(vistos, ["ex3", "ex2", "ex4", "ex1"]);
  assert.deepEqual(xps, [10, 20, null, 30], "questão sem nível não mostra pill de XP");
  assert.equal(h.store.dados.progresso.a1_L1.xpGanho, 10 + 20 + 10 + 30);
  h.fechar();
});

test("sair pelo ✕ com confirmação volta para a lista sem gravar nada", async () => {
  const h = await A.iniciarClassico({});
  await A.acertar(h);
  await h.clicar("✕");
  assert.match(h.texto(), /Somas simples 3 exercícios/);
  assert.equal(h.store.escritas("progresso").length, 0);
  assert.equal(h.store.dados.alunos.a1.xpTotal, 0);
  h.fechar();
});

test("REGRESSÃO: Verificar disparado 2x na mesma questão não conta o acerto em dobro", async () => {
  const h = await A.iniciarClassico({});
  const ex = A.exercicioAtual(h);
  h.document.querySelectorAll("#optWrap .opt")[ex.correta].click();
  await h.estabilizar();
  h.App.checkAnswer(); h.App.checkAnswer(); // 2º disparo do mesmo evento (ex.: toque duplo)
  await h.estabilizar();
  assert.match(h.texto(), /✅ 1 acerto\b/, "um acerto por questão");
  for (let i = 0; i < 2; i++) { await h.clicar("Continuar"); await A.acertar(h); }
  await h.clicar("Continuar");
  const p = h.store.dados.progresso.a1_L1;
  assert.equal(p.acertos, 3);
  assert.equal(p.percentualAcertos, 100);
  assert.equal(p.xpGanho, 30);
  h.fechar();
});

test("REGRESSÃO: erro disparado 2x na mesma questão não tira duas vidas", async () => {
  const h = await A.iniciarClassico({});
  const ex = A.exercicioAtual(h);
  h.document.querySelectorAll("#optWrap .opt")[(ex.correta + 1) % 4].click();
  await h.estabilizar();
  h.App.checkAnswer(); h.App.checkAnswer();
  await h.estabilizar();
  assert.equal(h.document.querySelector(".hearts").textContent, "❤️❤️🤍");
  h.fechar();
});
