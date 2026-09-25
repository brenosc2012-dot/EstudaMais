// Regressões de defeitos corrigidos durante a criação da suíte (ver docs/TESTES.md › Bugs corrigidos).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { entrarAluno, iniciarClassico, errar, esperarExplicacao, F } = require("../support/aluno-helpers");

test("REGRESSÃO: zerar progresso também zera as aventuras do Modo História (historiasCompletas)", async () => {
  const aluno = F.aluno({ xpTotal: 300, medalhas: ["contador"], historiasCompletas: ["L1", "L2", "L3", "L4", "L5"] });
  const h = await entrarAluno({ seedCompleto: F.banco({ alunos: { a1: aluno } }) });
  try {
    h.App.openProfile(); await h.estabilizar();
    h.respostaConfirm(true);
    await h.clicar(/Zerar meu progresso/);
    const a = h.store.dados.alunos.a1;
    assert.equal(JSON.stringify(a.medalhas), "[]");
    // antes da correção ficava com 5 aventuras e a medalha "Contador de Histórias" voltava na próxima
    assert.equal(JSON.stringify(a.historiasCompletas), "[]");
    assert.equal(a.nome, "Ana Souza");
  } finally { h.fechar(); }
});

test("REGRESSÃO: falha ao salvar a explicação no Firestore não vira rejeição não tratada", async () => {
  const rejeicoes = [];
  const ouvir = e => rejeicoes.push(e);
  process.on("unhandledRejection", ouvir);
  const h = await iniciarClassico({ rotas: { explic: "Tudo bem errar! A soma junta as quantidades." } });
  try {
    h.store.falhar({ op: "update", colecao: "licoes", vezes: 5, erro: Object.assign(new Error("offline"), { code: "unavailable" }) });
    await errar(h);
    await esperarExplicacao(h);
    await h.estabilizar();
    assert.match(h.texto(), /soma junta as quantidades/, "a explicação continua aparecendo");
    assert.equal(rejeicoes.length, 0, "update sem .catch gerava unhandledRejection (faixa vermelha no navegador)");
    assert.equal(h.store.dados.licoes.L1.explicacoes, undefined, "nada foi gravado");
  } finally { process.off("unhandledRejection", ouvir); h.fechar(); }
});
