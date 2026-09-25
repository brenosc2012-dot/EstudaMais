// Professor: REGENERAR CONTEÚDO (resumo de estudo) — separado de regenerar exercícios.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const { abrirProfessor, erroIA, ultimoToast, F } = require("../support/professor-helpers");

const CONFIRM = "Regenerar o resumo de estudo desta lição com IA? Isso substitui o resumo em cache para todos os dispositivos.";
const seedComCache = () => F.banco({
  licoes: { L1: F.licao({ exercicios: [F.mc(1), F.vf(2, 1), F.fill(3, "segredo-da-lacuna")], materialTexto: "[livro.pdf]\nTrecho do livro" }) },
  licoes_geradas: { L1: { licaoId: "L1", resumo: "RESUMO ANTIGO" } },
});
const semTempo = d => { const c = JSON.parse(JSON.stringify(d)); delete c.geradoEm; return c; };

test("regenerar conteúdo: botão existe só em lição salva e é distinto de regenerar exercícios", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  assert.ok(h.tem(/Regenerar conteúdo com IA/));
  assert.ok(h.tem(/Regenerar exercícios com IA/));
  await h.clicar(/^Cancelar$/);
  await h.clicar(/Criar nova lição/);
  assert.equal(h.tem(/Regenerar conteúdo com IA/), false);
  h.fechar();
});

test("regenerar conteúdo: cancelar a confirmação não chama a IA nem grava", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1", confirmar: false });
  await h.clicar(/Regenerar conteúdo com IA/);
  assert.deepEqual(h.confirmacoes, [CONFIRM]);
  assert.equal(h.ia.chamadas.length, 0);
  assert.equal(h.store.log.length, 0);
  assert.equal(h.store.doc("licoes_geradas", "L1").resumo, "RESUMO ANTIGO");
  h.fechar();
});

test("regenerar conteúdo: sucesso grava SÓ o resumo em licoes_geradas; exercícios e lição intactos", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
  const licaoAntes = semTempo(h.store.doc("licoes", "L1"));
  h.ia.fila(F.RESUMO_DIDATICO);
  await h.clicar(/Regenerar conteúdo com IA/);
  assert.equal(h.store.doc("licoes_geradas", "L1").resumo, F.RESUMO_DIDATICO);
  assert.deepEqual(semTempo(h.store.doc("licoes", "L1")), licaoAntes, "documento da lição não muda");
  assert.equal(h.store.escritas("licoes").length, 0);
  assert.deepEqual(h.store.escritas().map(e => e.caminho), ["licoes_geradas/L1"]);
  assert.equal(h.document.querySelectorAll(".ex-edit-card").length, 3, "editor mantém os exercícios");
  assert.equal(ultimoToast(h), "Resumo regenerado e salvo no cache! ✅");
  assert.equal(erroIA(h), "");
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

test("regenerar conteúdo: contexto enviado à IA (tema, disciplina, série, dificuldade, tipos, enunciados sem respostas, material, idioma, regras)", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
  h.ia.fila(F.RESUMO_DIDATICO);
  await h.clicar(/Regenerar conteúdo com IA/);
  const p = h.ia.ultimoPrompt();
  for (const re of [/Tema: Somas simples/, /Disciplina: Matemática/, /3º ano do Ensino Fundamental I, aproximadamente 8 anos/,
    /1 fáceis, 1 intermediárias e 1 difíceis \(de 3 questões\)/, /Múltipla escolha, Verdadeiro ou Falso, Complete a lacuna/,
    /Quanto é 1 \+ 1\?/, /Trecho do livro/, /português do Brasil/, /PELO MENOS 2 exemplos práticos/, /Cuidado!/,
    /NÃO resolva nem revele as respostas/, /no máximo 350 palavras/, /## /, /Somar é juntar quantidades/]) assert.match(p, re);
  assert.doesNotMatch(p, /segredo-da-lacuna/, "não envia a resposta da lacuna");
  h.fechar();
});

test("regenerar conteúdo: usa o texto digitado no editor (ainda não salvo)", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
  await h.preencher("lTexto", "Conteúdo revisado e não salvo");
  h.ia.fila(F.RESUMO_DIDATICO);
  await h.clicar(/Regenerar conteúdo com IA/);
  assert.match(h.ia.ultimoPrompt(), /Conteúdo revisado e não salvo/);
  h.fechar();
});

test("regenerar conteúdo: loading enquanto a IA responde e timeout mantém o resumo anterior", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
  h.ia.fila({ pendurar: true });
  h.App.regenerarConteudoIA(); await h.estabilizar();
  assert.match(h.texto(), /Regenerando conteúdo com IA/);
  assert.equal(h.tem(/Regenerar conteúdo com IA/), false, "sem botão durante o loading");
  await h.avancar(26000);
  assert.match(erroIA(h), /demorou demais/);
  assert.equal(h.store.doc("licoes_geradas", "L1").resumo, "RESUMO ANTIGO");
  h.fechar();
});

for (const [nome, item, re] of [
  ["429 limite de uso", { status: 429 }, /Limite de uso atingido/],
  ["503 indisponível", { status: 503, mensagem: "overloaded" }, /Erro 503 — overloaded/],
  ["rede", { rede: true }, /Falha na chamada à OpenAI/],
  ["resposta vazia (stream)", "   ", /respondeu vazio/],
  ["resposta vazia (JSON)", { json: true, texto: "" }, /fora do padrão \(resposta vazia\)/],
]) {
  test(`regenerar conteúdo: ${nome} → mensagem e resumo anterior mantido`, async () => {
    const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
    h.ia.fila(item, item); // resposta fora do padrão é pedida 2x
    await h.clicar(/Regenerar conteúdo com IA/);
    assert.match(erroIA(h), re);
    assert.equal(h.store.doc("licoes_geradas", "L1").resumo, "RESUMO ANTIGO");
    assert.equal(h.store.log.length, 0);
    h.fechar();
  });
}

test("regenerar conteúdo: sem chave → botão desabilitado e nenhuma chamada", async () => {
  const h = await abrirProfessor({ semChave: true, editar: "L1" });
  assert.equal(h.botao(/Regenerar conteúdo com IA/).disabled, true);
  h.App.regenerarConteudoIA(); await h.estabilizar();
  assert.match(erroIA(h), /IA não configurada/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

test("regenerar conteúdo: lição sem texto → aviso e nenhuma chamada", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L1: F.licao({ conteudo: "" }) } }, editar: "L1" });
  h.App.regenerarConteudoIA(); await h.estabilizar();
  assert.match(erroIA(h), /Escreva o conteúdo da lição/);
  assert.equal(h.confirmacoes.length, 0);
  h.fechar();
});

test("regenerar conteúdo: o aluno em outro aparelho recebe o novo resumo pronto (sem chamar a IA), com títulos e destaques", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
  h.ia.fila(F.RESUMO_DIDATICO);
  await h.clicar(/Regenerar conteúdo com IA/);
  const aluno = await abrirApp({ store: h.firebase, relogio: h.relogio, local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" }, ia: { padrao: "NÃO DEVERIA SER USADO NO RESUMO" } });
  aluno.App.openSubject("mat"); await aluno.estabilizar();
  aluno.App.openLesson("L1"); await aluno.estabilizar();
  assert.equal(aluno.document.querySelectorAll(".resumo-titulo").length, 5, "## viram títulos");
  assert.ok(aluno.document.querySelector(".resumo-box b"), "**destaque** vira negrito");
  assert.match(aluno.texto(), /Exemplo 1.*Exemplo 2/);
  assert.equal(aluno.ia.chamadas.filter(c => /TEXTO DE ESTUDO/.test(c.prompt)).length, 0);
  aluno.fechar(); h.fechar();
});

test("regenerar conteúdo: texto da IA com HTML é recusado; o aluno segue com o resumo anterior", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
  const malicioso = F.RESUMO_DIDATICO + '\n## Título <img src=x onerror="alert(1)">\nTexto <script>alert(2)</script> **forte**';
  h.ia.fila(malicioso, malicioso);
  await h.clicar(/Regenerar conteúdo com IA/);
  assert.equal(h.ia.chamadas.length, 2, "fora do padrão → uma nova tentativa");
  assert.match(erroIA(h), /fora do padrão \(veio com HTML ou bloco de código\).*resumo anterior foi mantido/);
  assert.equal(h.store.doc("licoes_geradas", "L1").resumo, "RESUMO ANTIGO");
  const aluno = await abrirApp({ store: h.firebase, relogio: h.relogio, local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" } });
  aluno.App.openSubject("mat"); aluno.App.openLesson("L1"); await aluno.estabilizar();
  assert.equal(aluno.document.querySelector(".resumo-box img"), null);
  assert.equal(aluno.document.querySelector(".resumo-box script"), null);
  assert.match(aluno.texto(), /RESUMO ANTIGO/);
  aluno.fechar(); h.fechar();
});

// DEFEITO (regressão): a gravação do resumo não era aguardada — com falha no Firestore o
// professor via "✅ salvo" e o erro virava uma rejeição não tratada (faixa vermelha).
test("regenerar conteúdo: falha ao gravar no Firestore NÃO mostra sucesso e avisa o erro", async () => {
  const h = await abrirProfessor({ seed: seedComCache(), editar: "L1" });
  h.store.falhar({ op: "set", colecao: "licoes_geradas", erro: new Error("permissão negada") });
  h.ia.fila(F.RESUMO_DIDATICO);
  await h.clicar(/Regenerar conteúdo com IA/);
  assert.equal(h.store.doc("licoes_geradas", "L1").resumo, "RESUMO ANTIGO");
  assert.notEqual(ultimoToast(h), "Resumo regenerado e salvo no cache! ✅", "não pode anunciar sucesso");
  assert.match(erroIA(h), /permissão negada/);
  assert.deepEqual(h.errosJs(), [], "sem rejeição não tratada");
  h.fechar();
});

test("regenerar conteúdo: aluno logado não consegue disparar (sem editor de professor)", async () => {
  const aluno = await abrirApp({ seed: seedComCache(), local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" } });
  aluno.App.regenerarConteudoIA(); await aluno.estabilizar();
  assert.equal(aluno.ia.chamadas.length, 0);
  assert.equal(aluno.confirmacoes.length, 0);
  assert.equal(aluno.store.escritas("licoes_geradas").length, 0);
  aluno.fechar();
});
