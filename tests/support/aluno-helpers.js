// Helpers dos testes de fluxo do ALUNO (frente B). Não altera o harness compartilhado.
"use strict";
const { abrirApp, criarIAFake } = require("./app");
const F = require("./fixtures");

/**
 * Roteia as chamadas da IA falsa pelo TIPO de prompt (a ordem das chamadas concorrentes
 * — pré-geração de explicações × resumo — não é garantida, então roteamos pelo conteúdo).
 * Cada rota: string | item do fake-ia | função(chamada) => item. Padrões seguros:
 *  - preExplic (pregerarExplicacoes): erro 500 (não grava nada, não interfere)
 */
function roteadorIA(rotas) {
  rotas = Object.assign({ resumo: F.RESUMO_DIDATICO, preExplic: { status: 500 }, explic: "Tudo bem errar! Explicação da IA.", historia: null, outro: "ok" }, rotas);
  const tipo = p => {
    if (/TEXTO DE ESTUDO/.test(p)) return "resumo";
    if (/pode errar a seguinte quest/.test(p)) return "preExplic";
    if (/errou a seguinte quest/.test(p)) return "explic";
    if (/hist[oó]ria interativa/.test(p)) return "historia";
    return "outro";
  };
  return ch => {
    const r = rotas[tipo(ch.prompt)];
    return typeof r === "function" ? r(ch) : r;
  };
}
function contar(ia, re) { return ia.chamadas.filter(c => re.test(c.prompt)).length; }
const chamadasExplic = ia => contar(ia, /errou a seguinte quest/);
const chamadasResumo = ia => contar(ia, /TEXTO DE ESTUDO/);

/** Abre o app já logado como o aluno a1 (home). */
async function entrarAluno(o) {
  o = o || {};
  const ia = o.ia || criarIAFake();
  if (o.rotas !== false && !o.ia) ia.padrao(roteadorIA(o.rotas));
  const seed = o.seedCompleto || F.banco(o.seed);
  if (o.semChave) delete seed.config;
  const h = await abrirApp(Object.assign({ seed, local: Object.assign({}, F.LOCAL_BASE, o.local || {}), sessao: { tipo: "aluno", id: "a1" }, ia }, o.abrir || {}));
  return h;
}

/** Home → disciplina → lição (tela de estudo). */
async function abrirLicao(h, nomeDisc, tituloLicao) {
  await h.clicar(nomeDisc || /Matemática/);
  await h.clicar(tituloLicao || /Somas simples/);
}
/** Espera os 10s da tela de estudo e escolhe o Modo Clássico. */
async function irParaClassico(h) {
  await h.avancar(10000);
  await h.clicar(/Já estudei/);
  await h.clicar(/Modo Clássico/);
}
/** Faz tudo: entra, abre a lição e inicia o Modo Clássico. */
async function iniciarClassico(o) {
  const h = await entrarAluno(o);
  await abrirLicao(h, o && o.disc, o && o.licao);
  await irParaClassico(h);
  return h;
}

const enunciado = h => { const q = h.document.querySelector(".q-prompt"); return q ? q.textContent.trim() : null; };
/** Exercício da lição (no banco) cujo enunciado está na tela. */
function exercicioAtual(h, lid) {
  const exs = h.store.dados.licoes[lid || "L1"].exercicios;
  return exs.find(e => e.enunciado === enunciado(h));
}
/** Seleciona a opção i (ou digita, se lacuna) e clica Verificar. */
async function responder(h, i) {
  const ex = exercicioAtual(h);
  if (ex && ex.tipo === "fill") await h.preencher("fillAns", String(i));
  else { h.document.querySelectorAll("#optWrap .opt")[i].click(); await h.estabilizar(); }
  await h.clicar("Verificar");
}
async function acertar(h, lid) {
  const ex = exercicioAtual(h, lid);
  await responder(h, ex.tipo === "fill" ? ex.resposta : ex.correta);
}
async function errar(h, lid) {
  const ex = exercicioAtual(h, lid);
  await responder(h, ex.tipo === "fill" ? "resposta-errada-xyz" : (ex.correta + 1) % ex.opcoes.length);
}
/** Após errar: espera o feedback (950ms) e a explicação aparecer. */
async function esperarExplicacao(h) {
  await h.aguardar(() => /Veja a explicação/.test(h.texto()), { max: 20000, msg: "tela de explicação" });
}
const ordemTela = h => h.texto().match(/Questão (\d+) de (\d+)/);

module.exports = { roteadorIA, entrarAluno, abrirLicao, irParaClassico, iniciarClassico, enunciado, exercicioAtual, responder, acertar, errar, esperarExplicacao, chamadasExplic, chamadasResumo, contar, ordemTela, F };
