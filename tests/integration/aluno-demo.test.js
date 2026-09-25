// Aluno: Modo Demo (?demo=true) — perfis e lições locais, NENHUMA escrita no Firestore.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { abrirApp, criarIAFake } = require("../support/app");
const { F } = A;

async function abrirDemo(o) {
  o = o || {};
  const ia = criarIAFake();
  ia.padrao(A.roteadorIA(o.rotas));
  const seed = F.banco();
  if (o.semChave) delete seed.config;
  const h = await abrirApp({ url: "http://localhost/index.html?demo=true", seed, local: F.LOCAL_BASE, ia });
  return h;
}
const escritas = h => h.store.log.length;

test("demo: tela de boas-vindas com perfis de aluno e professor", async () => {
  const h = await abrirDemo();
  assert.match(h.texto(), /MODO DEMO/);
  assert.ok(h.tem(/Entrar como Aluno Demo/));
  assert.ok(h.tem(/Entrar como Professor Demo/));
  assert.equal(h.window.sessionStorage.getItem("modoDemo"), "true");
  h.fechar();
});

test("aluno demo: saudação de 3s, lições locais, banner e perfil sem dados escolares", async () => {
  const h = await abrirDemo();
  await h.clicar(/Entrar como Aluno Demo/);
  assert.match(h.texto(), /Olá, Aluno!\s*Pronto para aprender\?/);
  await h.avancar(3000);
  assert.match(h.texto(), /MODO DEMO — Explore à vontade!/);
  assert.match(h.texto(), /Matemática 0\/1 lição • 60 XP/);
  assert.match(h.texto(), /🔥 3Ofensiva/);
  await h.clicar(/Meu Perfil/);
  assert.match(h.texto(), /Perfil de demonstração/);
  assert.doesNotMatch(h.texto(), /Meus dados escolares/);
  assert.equal(escritas(h), 0);
  h.fechar();
});

test("demo sem IA: resumo pré-cadastrado (nunca erro de API)", async () => {
  const h = await abrirDemo({ semChave: true });
  await h.clicar(/Entrar como Aluno Demo/);
  await h.avancar(3000);
  await h.clicar(/Matemática/);
  await h.clicar(/Frações no dia a dia/);
  assert.match(h.texto(), /As frações mostram PARTES de um inteiro!/);
  assert.doesNotMatch(h.texto(), /indisponível/i);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

test("demo com IA: resumo gerado mas não salvo em licoes_geradas; sem pré-geração", async () => {
  const h = await abrirDemo();
  await h.clicar(/Entrar como Aluno Demo/);
  await h.avancar(3000);
  await h.clicar(/Matemática/);
  await h.clicar(/Frações no dia a dia/);
  assert.match(h.texto(), /O que é somar\?/);
  assert.equal(A.contar(h.ia, /pode errar/), 0);
  assert.equal(escritas(h), 0);
  h.fechar();
});

test("REGRESSÃO: concluir uma lição no demo não grava progresso no Firestore (só na sessão)", async () => {
  const h = await abrirDemo({ semChave: true });
  await h.clicar(/Entrar como Aluno Demo/);
  await h.avancar(3000);
  await h.clicar(/Ciências/);
  await h.clicar(/Sistema Solar/);
  await A.irParaClassico(h);
  for (let i = 0; i < 5; i++) {
    const enun = A.enunciado(h);
    // respostas certas das lições demo (seedDemo): índice 0, exceto as listadas
    const certas = { "Quantos planetas há no Sistema Solar?": 1, "O maior planeta do Sistema Solar é ____.": "júpiter" };
    const r = certas[enun] !== undefined ? certas[enun] : 0;
    if (typeof r === "string") await h.preencher("fillAns", r); else { h.document.querySelectorAll("#optWrap .opt")[r].click(); await h.estabilizar(); }
    await h.clicar("Verificar");
    await h.clicar("Continuar");
  }
  assert.match(h.texto(), /Lição Concluída!/);
  assert.equal(h.store.escritas("progresso").length, 0, "modo demo não pode gravar progresso no Firestore");
  assert.equal(escritas(h), 0);
  const prog = JSON.parse(h.window.sessionStorage.getItem("estudamais_demo_progresso"));
  assert.ok(prog.xpTotal > 150, "progresso fica só no sessionStorage");
  h.fechar();
});

test("demo: sair volta à escolha de perfil", async () => {
  const h = await abrirDemo();
  await h.clicar(/Entrar como Aluno Demo/);
  await h.avancar(3000);
  await h.clicar(/^🚪 Sair$/);
  assert.ok(h.tem(/Entrar como Aluno Demo/));
  h.fechar();
});
