// Aluno: perfil (dados, som, zerar progresso, dados escolares), premiações recebidas e sair.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

async function abrirPerfil(o) {
  const h = await A.entrarAluno(o || {});
  await h.clicar(/Meu Perfil/);
  return h;
}

test("perfil: dados do aluno, estatísticas, conquistas e progresso por disciplina", async () => {
  const aluno = F.aluno({ xpTotal: 70, medalhas: ["first"] });
  aluno.disciplinas.mat = { xp: 70, nivel: 2, licoesConcluidas: ["L1"] };
  const h = await abrirPerfil({ seed: { alunos: { a1: aluno } } });
  const t = h.texto();
  assert.match(t, /Ana Souza/);
  assert.match(t, /8 anos • 3º ano • Ensino Fundamental I • Turma A/);
  assert.match(t, /⭐ 70XP Total/);
  assert.match(t, /Minhas conquistas \(1\/13\)/);
  assert.match(t, /Matemática\s*Nível 2 • 1\/1 lições • 70 XP/);
  assert.equal(h.document.querySelectorAll(".medal.locked").length, 12);
  h.fechar();
});

test("som: liga/desliga e persiste no doc do aluno", async () => {
  const h = await abrirPerfil();
  await h.clicar(/Som: Ligado/);
  assert.ok(h.tem(/Som: Desligado/));
  assert.equal(h.store.dados.alunos.a1.som, false);
  await h.clicar(/Som: Desligado/);
  assert.equal(h.store.dados.alunos.a1.som, true);
  h.fechar();
});

test("zerar progresso: cancelar não muda nada; confirmar zera a gamificação e preserva a identidade", async () => {
  const aluno = F.aluno({ xpTotal: 120, streak: 5, medalhas: ["first", "xp100"], ultimoDia: new Date(2026, 2, 10, 12).toDateString() });
  aluno.disciplinas.mat = { xp: 120, nivel: 3, licoesConcluidas: ["L1"] };
  const h = await abrirPerfil({ seed: { alunos: { a1: aluno } } });
  h.respostaConfirm(false);
  await h.clicar(/Zerar meu progresso/);
  assert.match(h.confirmacoes.pop(), /zerar TODO o seu progresso/);
  assert.equal(h.store.dados.alunos.a1.xpTotal, 120);
  h.respostaConfirm(true);
  await h.clicar(/Zerar meu progresso/);
  const a = h.store.dados.alunos.a1;
  assert.equal(a.xpTotal, 0);
  assert.equal(JSON.stringify(a.medalhas), "[]");
  assert.equal(a.disciplinas.mat.xp, 0);
  assert.equal(JSON.stringify(a.disciplinas.mat.licoesConcluidas), "[]");
  assert.equal(a.nome, "Ana Souza"); assert.equal(a.turma, "A"); assert.equal(a.senha, F.hash("senha123"));
  assert.match(h.toasts.join("|"), /Progresso zerado/);
  assert.match(h.texto(), /Olá, Ana Souza/);
  h.fechar();
});

test("dados escolares: trocar a turma muda as lições visíveis; validações de ano e turma", async () => {
  const h = await abrirPerfil({ seed: { licoes: { L2: F.licao({ titulo: "Da turma B", turma: "B" }) } } });
  await h.preencher("pfTurma", "B");
  await h.clicar(/Salvar dados escolares/);
  assert.match(h.toasts.join("|"), /Dados escolares atualizados/);
  assert.equal(h.store.dados.alunos.a1.turma, "B");
  await h.clicar("←");
  await h.clicar(/Matemática/);
  assert.match(h.texto(), /Da turma B/);
  assert.doesNotMatch(h.texto(), /Somas simples/);
  // trocar o nível limpa o ano → salvar exige o ano
  await h.clicar("←"); await h.clicar(/Meu Perfil/);
  const sel = h.campo("pfNivel"); sel.value = "fund2"; sel.dispatchEvent(new h.window.Event("change", { bubbles: true }));
  await h.estabilizar();
  await h.clicar(/Salvar dados escolares/);
  assert.match(h.toasts.pop(), /Selecione o ano/);
  assert.equal(h.store.dados.alunos.a1.nivel, "fund1", "nada salvo sem ano");
  h.fechar();
});

test("premiação do professor atingida ao entrar: toast, troféu no perfil e registro em premiacoes_alunos", async () => {
  const h = await abrirPerfil({ seed: {
    alunos: { a1: F.aluno({ xpTotal: 100 }) },
    premiacoes: {
      pr1: { nome: "Estrela <b>", icone: "⭐", descricao: "100 XP", criterio: "pontuacao", valorMinimo: 100, turma: "A" },
      pr2: { nome: "Outra turma", criterio: "pontuacao", valorMinimo: 0, turma: "B" },
      pr3: { nome: "Expirada", criterio: "pontuacao", valorMinimo: 0, expiracaoEm: { __ts: 1000 } },
      pr4: { nome: "Muito XP", criterio: "pontuacao", valorMinimo: 5000 },
    },
  } });
  assert.match(h.toasts.join("|"), /🏆 Estrela <b>!/);
  assert.match(h.texto(), /Meus troféus \(1\)/);
  assert.ok(h.html().includes("Estrela &lt;b&gt;"));
  const pa = h.store.dados.premiacoes_alunos;
  assert.deepEqual(Object.keys(pa), ["a1_pr1"]);
  assert.equal(pa.a1_pr1.alunoId, "a1");
  h.fechar();
});

test("sair da conta: volta ao início e limpa sessão e cache local", async () => {
  const h = await abrirPerfil();
  await h.clicar(/Sair da conta/);
  assert.match(h.texto(), /Sou Aluno/);
  assert.equal(h.window.localStorage.getItem("estudamais_sessao_v2"), null);
  assert.equal(h.window.localStorage.getItem("estudamais_aluno_cache_v2"), null);
  const h2 = await h.recarregar();
  assert.match(h2.texto(), /Sou Aluno/, "após recarregar continua deslogado");
  h2.fechar();
});
