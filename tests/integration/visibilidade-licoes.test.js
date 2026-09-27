// Visibilidade das lições para o aluno (regra estrita: mesmo ano E mesma turma; nível opcional)
// e o salvamento pelo professor que levou à lição de Inglês "sumida" (ver docs/TESTES.md §5).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const { abrirProfessor, ultimoToast, F } = require("../support/professor-helpers");

// cenário real: professor de Inglês que leciona só o 5º ano (turmas A–F); alunos do 5º A e do 1º A
const PROF_ING = F.professor({ anos: ["5º ano"], turmas: ["A", "B", "C", "D", "E", "F"], disciplinas: ["ing", "mat"] });
const ALUNO_5A = F.aluno({ nome: "Bia Cinco", ano: "5º ano", turma: "A", nivel: "fund1", idade: 10 });
const ALUNO_1A = F.aluno({ nome: "Caio Um", ano: "1º ano", turma: "A", nivel: "fund1", idade: 6 });
const ALUNO_5B = F.aluno({ nome: "Duda Cinco B", ano: "5º ano", turma: "B", nivel: "fund1", idade: 10 });
const seed = licoes => F.banco({ professores: { p1: PROF_ING }, alunos: { a5: ALUNO_5A, a1: ALUNO_1A, b5: ALUNO_5B }, licoes: licoes || {} });
const ing = extra => F.licao(Object.assign({ disciplina: "ing", titulo: "Prova de Inglês", ano: "5º ano", turma: "A", nivel: "fund1" }, extra));

async function aluno(h, id) {
  return abrirApp({ store: h.firebase, relogio: h.relogio, local: F.LOCAL_BASE, sessao: { tipo: "aluno", id } });
}
const licoesIngles = a => { a.App.openSubject("ing"); return a.estabilizar().then(() => a.texto()); };

async function novaLicaoIng(h, { nivel, ano, turma }) {
  h.App.teacherSelectSubj("ing"); await h.estabilizar();
  await h.clicar(/Criar nova lição/);
  await h.preencher("lTitulo", "Prova - Setembro 2026");
  await h.preencher("lTexto", "Present simple: rotina diária (daily routine).");
  if (nivel != null) { h.campo("lNivel").value = nivel; h.App.onLessonNivel(nivel); await h.estabilizar(); }
  if (ano != null) await h.preencher("lAno", ano);
  if (turma != null) await h.preencher("lTurma", turma);
}

// ------------------------------------------------------------------ reprodução do defeito
test("REGRESSÃO: professor do 5º ano salva lição de Inglês marcada (sem querer) p/ 1º ano → é avisado antes de salvar", async () => {
  const h = await abrirProfessor({ seed: seed() });
  try {
    await novaLicaoIng(h, { nivel: "fund1", ano: "1º ano", turma: "A" });
    h.respostaConfirm(false);
    await h.clicar(/Salvar lição/);
    assert.match(h.confirmacoes.pop(), /Você leciona para 5º ano.*esta lição está marcada para 1º ano • Turma A.*não vão vê-la/s);
    assert.equal(Object.keys(h.store.colecao("licoes")).length, 1, "cancelou: nada gravado"); // só a L1 do banco base
    assert.ok(h.document.getElementById("lAno"), "continua no editor para corrigir");
    // corrige para o 5º ano e salva
    await h.preencher("lAno", "5º ano");
    await h.clicar(/Salvar lição/);
    const nova = Object.values(h.store.colecao("licoes")).find(l => l.titulo === "Prova - Setembro 2026");
    assert.equal(nova.ano, "5º ano"); assert.equal(nova.turma, "A"); assert.equal(nova.disciplina, "ing");
    assert.match(h.texto(), /Prova - Setembro 2026/, "aparece na lista do próprio professor");
  } finally { h.fechar(); }
});

test("confirmar a série fora do escopo (ex.: professor que também dá aula no 1º ano) salva e informa para quem a lição ficou", async () => {
  const h = await abrirProfessor({ seed: seed() });
  try {
    await novaLicaoIng(h, { nivel: "fund1", ano: "1º ano", turma: "A" });
    h.respostaConfirm(true);
    await h.clicar(/Salvar lição/);
    const nova = Object.values(h.store.colecao("licoes")).find(l => l.titulo === "Prova - Setembro 2026");
    assert.equal(nova.ano, "1º ano");
    assert.match(ultimoToast(h), /Lição salva para 1º ano • Turma A.*fora das suas séries/);
    const a1 = await aluno(h, "a1");
    try { assert.match(await licoesIngles(a1), /Prova - Setembro 2026/, "aluno do 1º A vê"); } finally { a1.fechar(); }
    const a5 = await aluno(h, "a5");
    try { assert.doesNotMatch(await licoesIngles(a5), /Prova - Setembro 2026/, "aluno do 5º A não vê"); } finally { a5.fechar(); }
  } finally { h.fechar(); }
});

test("sem ano ou sem turma a lição não é salva: mensagem clara do que falta (nenhum aluno a veria)", async () => {
  const h = await abrirProfessor({ seed: seed() });
  try {
    await novaLicaoIng(h, { nivel: "fund1", ano: "", turma: "A" });
    await h.clicar(/Salvar lição/);
    assert.match(ultimoToast(h), /Escolha o ano e a turma da lição.*nenhum aluno a verá/);
    await h.preencher("lAno", "5º ano"); await h.preencher("lTurma", "");
    await h.clicar(/Salvar lição/);
    assert.match(ultimoToast(h), /Escolha o ano e a turma da lição/);
    assert.equal(Object.keys(h.store.colecao("licoes")).length, 1, "nada gravado");
    assert.match(h.texto(), /A lição só aparece para alunos do mesmo ano e da mesma turma/, "a dica do editor não promete mais 'liberar para todos'");
    assert.doesNotMatch(h.texto(), /Deixe "Todos\/Todas" para liberar/);
  } finally { h.fechar(); }
});

test("nova lição já vem com a série/turma do professor quando ele só tem uma (evita marcar o 1º ano por engano)", async () => {
  const h = await abrirProfessor({ seed: F.banco({ professores: { p1: F.professor({ anos: ["5º ano"], turmas: ["A"], disciplinas: ["ing"] }) } }) });
  try {
    h.App.teacherSelectSubj("ing"); await h.estabilizar();
    await h.clicar(/Criar nova lição/);
    assert.equal(h.campo("lNivel").value, "fund1");
    assert.equal(h.campo("lAno").value, "5º ano");
    assert.equal(h.campo("lTurma").value, "A");
  } finally { h.fechar(); }
});

// ------------------------------------------------------------------ regras de visibilidade (todas as disciplinas)
test("lição de Inglês publicada aparece para o aluno do mesmo ano/turma e para mais ninguém — igual às outras disciplinas", async () => {
  const licoes = { I1: ing({ titulo: "Inglês 5A" }), M1: F.licao({ disciplina: "mat", titulo: "Matemática 5A", ano: "5º ano", turma: "A" }),
    I2: ing({ titulo: "Inglês 5B", turma: "B" }), I3: ing({ titulo: "Inglês 1A", ano: "1º ano" }) };
  const h = await abrirProfessor({ seed: seed(licoes) });
  try {
    const casos = [["a5", ["Inglês 5A"], ["Inglês 5B", "Inglês 1A"]], ["b5", ["Inglês 5B"], ["Inglês 5A", "Inglês 1A"]], ["a1", ["Inglês 1A"], ["Inglês 5A", "Inglês 5B"]]];
    for (const [id, ve, naoVe] of casos) {
      const a = await aluno(h, id);
      try {
        const t = await licoesIngles(a);
        ve.forEach(x => assert.ok(t.includes(x), `${id} deveria ver ${x}`));
        naoVe.forEach(x => assert.ok(!t.includes(x), `${id} NÃO deveria ver ${x}`));
        if (id === "a5") { a.App.openSubject("mat"); await a.estabilizar(); assert.match(a.texto(), /Matemática 5A/, "mesma regra em Matemática"); }
      } finally { a.fechar(); }
    }
  } finally { h.fechar(); }
});

test("lição recém-salva pelo professor aparece para o aluno JÁ LOGADO, sem sair nem recarregar (tempo real)", async () => {
  const h = await abrirProfessor({ seed: seed() });
  const a5 = await aluno(h, "a5");
  try {
    assert.doesNotMatch(await licoesIngles(a5), /Prova - Setembro 2026/);
    await novaLicaoIng(h, { nivel: "fund1", ano: "5º ano", turma: "A" });
    await h.clicar(/Salvar lição/);
    await a5.estabilizar();
    assert.match(a5.texto(), /Prova - Setembro 2026/, "onSnapshot atualizou a lista aberta");
    // edição (ex.: professor troca a turma) também chega sem recarregar — e some para quem perdeu o acesso
    h.App.editLesson(Object.entries(h.store.colecao("licoes")).find(([, l]) => l.titulo === "Prova - Setembro 2026")[0]); await h.estabilizar();
    await h.preencher("lTurma", "B");
    await h.clicar(/Salvar lição/);
    await a5.estabilizar();
    assert.doesNotMatch(a5.texto(), /Prova - Setembro 2026/);
  } finally { a5.fechar(); h.fechar(); }
});

test("disciplina gravada com nome/variação (Inglês, ingles, English, ENGLISH) é normalizada para 'ing'", async () => {
  const licoes = {};
  ["Inglês", "ingles", "English", "ENGLISH", " ing "].forEach((d, i) => { licoes["V" + i] = ing({ disciplina: d, titulo: "Variação " + i }); });
  licoes.X = ing({ disciplina: "Klingon", titulo: "Disciplina desconhecida" });
  const h = await abrirProfessor({ seed: seed(licoes) });
  const a5 = await aluno(h, "a5");
  try {
    const t = await licoesIngles(a5);
    [0, 1, 2, 3, 4].forEach(i => assert.ok(t.includes("Variação " + i), "variação " + i));
    assert.ok(!t.includes("Disciplina desconhecida"), "valor desconhecido não vira Inglês");
    assert.equal(h.store.doc("licoes", "V2").disciplina, "English", "o dado no banco não é alterado");
  } finally { a5.fechar(); h.fechar(); }
});

test("escopo com maiúsculas/espaços/acentos é comparado normalizado; lição sem ano/turma (antiga) não aparece para ninguém", async () => {
  const licoes = { N1: ing({ titulo: "Normalizada", ano: " 5º Ano ", turma: " a " }), S1: ing({ titulo: "Sem escopo", ano: "", turma: "" }) };
  const h = await abrirProfessor({ seed: seed(licoes) });
  const a5 = await aluno(h, "a5");
  try {
    const t = await licoesIngles(a5);
    assert.ok(t.includes("Normalizada"));
    assert.ok(!t.includes("Sem escopo"), "regra estrita vigente: sem ano/turma ninguém vê");
  } finally { a5.fechar(); h.fechar(); }
});

test("REGRESSÃO: ano gravado com o 'º' corrompido (\"5  ano\") volta a valer como 5º ano — aluno vê, professor acha e o salvar grava limpo", async () => {
  const h = await abrirProfessor({ seed: seed({ C1: ing({ titulo: "Prova - Setembro 2026", ano: "5  ano" }) }) });
  const a5 = await aluno(h, "a5");
  try {
    assert.match(await licoesIngles(a5), /Prova - Setembro 2026/, "aluno do 5º A vê a lição");
    const a1 = await aluno(h, "a1");
    try { assert.doesNotMatch(await licoesIngles(a1), /Prova - Setembro 2026/, "não vira outra série"); } finally { a1.fechar(); }
    h.App.teacherSelectSubj("ing"); await h.estabilizar();
    assert.match(h.texto(), /Prova - Setembro 2026/, "aparece na lista do professor");
    h.App.editLesson("C1"); await h.estabilizar();
    assert.equal(h.campo("lAno").value, "5º ano", "editor já mostra a série certa");
    await h.clicar(/Salvar lição/);
    assert.equal(h.store.doc("licoes", "C1").ano, "5º ano", "re-salvar grava o valor limpo");
  } finally { a5.fechar(); h.fechar(); }
});
