// Helpers da frente "professor": abre o app já logado como professor (p1) e,
// opcionalmente, já no editor de uma lição.
"use strict";
const { abrirApp } = require("./app");
const F = require("./fixtures");

/**
 * @param {object} o  seed (mesclado com F.banco), extraSeed, editar (id da lição), ia, confirmar, semChave
 */
async function abrirProfessor(o) {
  o = o || {};
  const seed = o.seed || F.banco(o.extraSeed);
  if (o.semChave) seed.config = { openai: { apiKey: "", proxyUrl: "" } };
  const h = await abrirApp(Object.assign({}, o, { seed, local: Object.assign({}, F.LOCAL_BASE, o.local || {}), sessao: { tipo: "professor", id: o.profId || "p1" } }));
  if (o.editar) { h.App.editLesson(o.editar); await h.estabilizar(); }
  return h;
}

/** Última mensagem de toast exibida. */
const ultimoToast = h => h.toasts[h.toasts.length - 1] || "";

/** Texto do alerta de erro do painel de IA (div.ia-erro), ou "". */
function erroIA(h) {
  const el = h.document.querySelector(".ia-erro");
  return el ? el.textContent.trim() : "";
}

module.exports = { abrirProfessor, ultimoToast, erroIA, F };
