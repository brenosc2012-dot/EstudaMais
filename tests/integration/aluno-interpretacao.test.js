// Aluno: lição de Interpretação de Texto (leitura com TTS por parágrafo → questões com "Ver o texto").
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

const TEXTO = "Numa tarde quente, uma raposa faminta viu uvas maduras.\n\nEla pulou muitas vezes, mas não alcançou.\n\nFoi embora dizendo que estavam verdes.";
function licaoInterp(extra) {
  return F.licao(Object.assign({
    disciplina: "por", titulo: "A Raposa e as Uvas", tipo: "interpretacao_texto", conteudo: TEXTO, textoGerado: TEXTO,
    tituloTexto: "A Raposa e as Uvas", generoTextual: "Fábula",
    exercicios: [F.mc(1, { enunciado: "O que a raposa faminta queria?", opcoes: ["Uvas", "Queijo", "Água", "Pão"], correta: 0 }), F.mc(2)],
  }, extra));
}
/** jsdom não tem layout: simula um texto com rolagem (conteúdo 1000px, janela 400px). */
function simularRolagem(h) {
  const P = h.window.HTMLElement.prototype;
  Object.defineProperty(P, "scrollHeight", { configurable: true, get() { return this.id === "interpContent" ? 1000 : 0; } });
  Object.defineProperty(P, "clientHeight", { configurable: true, get() { return this.id === "interpContent" ? 400 : 0; } });
}
async function abrirInterp(extra, prep) {
  const h = await A.entrarAluno(Object.assign({ seed: { licoes: { L1: licaoInterp() } } }, extra || {}));
  if (prep) prep(h);
  await h.clicar(/Português/);
  await h.clicar(/A Raposa e as Uvas/);
  return h;
}

test("abre direto na tela de leitura (sem resumo por IA): título, gênero e parágrafos", async () => {
  const h = await abrirInterp({}, simularRolagem);
  const t = h.texto();
  assert.match(t, /📖 Fábula/);
  assert.match(t, /📖 A Raposa e as Uvas/);
  assert.equal(h.document.querySelectorAll(".interp-par").length, 3);
  assert.equal(A.chamadasResumo(h.ia), 0);
  h.fechar();
});

test("'Já li' bloqueado por 30s quando há rolagem; libera aos 30s", async () => {
  const h = await abrirInterp({}, simularRolagem);
  const btn = () => h.document.getElementById("btnLido");
  assert.equal(btn().disabled, true);
  await h.avancar(29000);
  assert.equal(btn().disabled, true);
  assert.match(btn().textContent, /1s/);
  await h.avancar(1000);
  assert.equal(btn().disabled, false);
  assert.match(btn().textContent, /Já li! Partir para as questões/);
  h.fechar();
});

test("'Já li' libera ao rolar até o fim (antes dos 30s)", async () => {
  const h = await abrirInterp({}, simularRolagem);
  const cont = h.document.getElementById("interpContent");
  Object.defineProperty(cont, "scrollTop", { configurable: true, value: 600 });
  cont.dispatchEvent(new h.window.Event("scroll"));
  await h.estabilizar();
  assert.equal(h.document.getElementById("btnLido").disabled, false);
  h.fechar();
});

test("texto curto (sem rolagem) libera o 'Já li' na hora", async () => {
  const h = await abrirInterp({});
  assert.equal(h.document.getElementById("btnLido").disabled, false);
  h.fechar();
});

test("leitura em voz alta por parágrafo: intro, destaque, pausa/continuar/parar", async () => {
  const h = await abrirInterp({}, simularRolagem);
  await h.clicar(/Ouvir o texto/);
  assert.match(h.fala.textos().pop(), /^Olá! Vamos começar nossa aula\./, "intro do estilo Professora");
  assert.match(h.texto(), /Introdução\.\.\./);
  h.fala.synth.terminar();
  await h.avancar(300);
  assert.match(h.fala.textos().pop(), /raposa faminta/);
  assert.ok(h.document.getElementById("ipar-0").classList.contains("lendo"));
  assert.match(h.texto(), /Lendo parágrafo 1 de 3/);
  const u = h.fala.faladas[h.fala.faladas.length - 1];
  assert.equal(u.rate, 0.8); assert.equal(u.pitch, 1.2); assert.equal(u.lang, "pt-BR");
  await h.clicar(/Pausar/);
  assert.equal(h.fala.synth.paused, true);
  await h.clicar(/Continuar/);
  assert.equal(h.fala.synth.paused, false);
  h.fala.synth.terminar();
  await h.avancar(500); // pausa de 0,5s entre parágrafos
  assert.ok(h.document.getElementById("ipar-1").classList.contains("lendo"));
  await h.clicar(/Parar/);
  assert.equal(h.document.querySelectorAll(".interp-par.lendo").length, 0);
  assert.ok(h.tem(/Ouvir o texto/));
  h.fechar();
});

test("questões com 'Ver o texto' (modal com destaque das palavras da questão) e conclusão com 'Você sabia?'", async () => {
  const h = await abrirInterp({});
  await h.clicar(/Já li/);
  assert.match(h.texto(), /Questão 1 de 2/);
  await h.clicar(/Ver o texto/);
  const modal = h.document.getElementById("interpModal");
  assert.ok(modal);
  assert.ok([...modal.querySelectorAll("mark")].some(m => /raposa|faminta/i.test(m.textContent)));
  await h.clicar(/^Fechar$/); // botão ✕ do modal (aria-label "Fechar")
  assert.equal(h.document.getElementById("interpModal"), null);
  for (let i = 0; i < 2; i++) { await A.acertar(h); await h.clicar("Continuar"); }
  assert.match(h.texto(), /💡 Você sabia\?.*fábulas são histórias antigas/);
  h.fechar();
});

test("sair da leitura volta para a lista e para a voz", async () => {
  const h = await abrirInterp({}, simularRolagem);
  await h.clicar(/Ouvir o texto/);
  await h.clicar("←");
  assert.match(h.texto(), /A Raposa e as Uvas 2 exercícios/);
  assert.equal(h.fala.synth.speaking, false);
  h.fechar();
});

test("texto do aluno com HTML é escapado na leitura", async () => {
  const h = await abrirInterp({ seed: { licoes: { L1: licaoInterp({ textoGerado: "<img src=x onerror=alert(1)> parágrafo" }) } } });
  assert.equal(h.document.querySelector("#app img"), null);
  h.fechar();
});
