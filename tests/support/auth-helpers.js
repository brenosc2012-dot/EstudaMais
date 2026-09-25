// Helpers da frente de autenticação/autorização/segurança.
"use strict";
const { abrirApp, criarFirebaseFake } = require("./app");
const F = require("./fixtures");

/** Abre o app (banco base + exemplos já semeados) e fecha ao final do teste. */
async function abrir(t, o) {
  o = o || {};
  const h = await abrirApp(Object.assign({ seed: o.store ? undefined : F.banco(o.extra), local: Object.assign({}, F.LOCAL_BASE, o.local || {}) }, o));
  t.after(() => h.fechar());
  return h;
}
/** Firebase fake criado antes do boot (para injetar falhas já no carregamento). */
function storePronto(seed) { return criarFirebaseFake({ seed: seed || F.banco() }); }

async function loginAluno(h, nome, senha) {
  await h.clicar(/Sou Aluno/);
  await h.preencher("laNome", nome);
  await h.preencher("laSenha", senha);
  await h.clicar(/^Entrar$/);
}
async function loginProf(h, email, senha) {
  await h.clicar(/Sou Professor/);
  await h.preencher("lpEmail", email);
  await h.preencher("lpSenha", senha);
  await h.clicar(/^Entrar$/);
}
/** Sessão salva no localStorage (ou null). */
function sessao(h) { const r = h.window.localStorage.getItem("estudamais_sessao_v2"); return r ? JSON.parse(r) : null; }
/** Nº de escritas no banco (log do fake). */
const escritas = h => h.store.log.length;
/** Elementos perigosos criados a partir de conteúdo injetado. */
function elementosPerigosos(h) {
  return [...h.document.querySelectorAll("script, iframe, object, embed, [onerror], [onload], [onclick*='xss'], [onmouseover], img[src='x']")]
    .map(e => e.outerHTML.slice(0, 120));
}

module.exports = { abrir, storePronto, loginAluno, loginProf, sessao, escritas, elementosPerigosos, F };
