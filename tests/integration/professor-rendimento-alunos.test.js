// Professor: rendimento (escopo turma+ano estrito, filtros), gestão de alunos
// (redefinir senha, remover, zerar progresso), premiações e conta do professor.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const { abrirProfessor, ultimoToast, F } = require("../support/professor-helpers");

const copia = v => JSON.parse(JSON.stringify(v));
const ANTIGO = { __ts: new Date(2026, 0, 1).getTime() }; // > 30 dias antes de 10/03/2026
const RECENTE = { __ts: new Date(2026, 2, 9).getTime() };
function seed() {
  return F.banco({
    alunos: {
      a1: F.aluno({ nome: "Ana Souza", xpTotal: 120 }),
      a2: F.aluno({ nome: "Bruno Turma B", turma: "B" }),
      a3: F.aluno({ nome: "Caio Quarto Ano", ano: "4º ano" }),
      a4: F.aluno({ nome: "Duda Lima", xpTotal: 300 }),
    },
    licoes: { L1: F.licao(), LP: F.licao({ disciplina: "por", titulo: "Leitura" }) },
    progresso: {
      a1_L1: { alunoId: "a1", licaoId: "L1", disciplina: "mat", acertos: 3, total: 3, percentualAcertos: 100, concluido: true, concluidoEm: RECENTE },
      a4_L1: { alunoId: "a4", licaoId: "L1", disciplina: "mat", acertos: 1, total: 3, percentualAcertos: 33, concluido: true, concluidoEm: ANTIGO },
      a4_LP: { alunoId: "a4", licaoId: "LP", disciplina: "por", acertos: 2, total: 2, concluido: true, concluidoEm: RECENTE },
      a2_L1: { alunoId: "a2", licaoId: "L1", disciplina: "mat", acertos: 0, total: 3, percentualAcertos: 0, concluido: true, concluidoEm: RECENTE },
    },
    premiacoes: { P1: { nome: "Primeira lição", criterio: "atividades", valorMinimo: 1, turma: "A", icone: "🏅" }, PB: { nome: "Só turma B", criterio: "atividades", valorMinimo: 1, turma: "B" } },
    premiacoes_alunos: { a1_P1: { alunoId: "a1", premiacaoId: "P1" }, a4_P1: { alunoId: "a4", premiacaoId: "P1" } },
  });
}
async function abrirRendimento(o) {
  const h = await abrirProfessor(Object.assign({ seed: seed() }, o || {}));
  await h.clicar(/Rendi\./);
  await h.estabilizar();
  return h;
}
const botaoDoAluno = (h, id, acao) => h.document.querySelector(`[onclick="App.${acao}('${id}')"]`);

// ---------------- rendimento ----------------
test("rendimento: só alunos com turma E ano do professor; métricas e ranking", async () => {
  const h = await abrirRendimento();
  const t = h.texto();
  assert.match(t, /Alunos \(2\)/);
  assert.match(t, /Ana Souza/); assert.match(t, /Duda Lima/);
  assert.doesNotMatch(t, /Bruno Turma B/, "turma diferente fica fora");
  assert.doesNotMatch(t, /Caio Quarto Ano/, "ano diferente fica fora");
  assert.match(t, /3\s*Lições feitas/, "progresso só dos alunos do escopo (a2 fora)");
  assert.match(t, /78%\s*Média acertos/, "média de 100, 33 e 100");
  const rank = [...h.document.querySelectorAll(".t-lesson-row .t")].map(e => e.textContent);
  assert.deepEqual(rank.slice(0, 2), ["Duda Lima", "Ana Souza"], "ranking por XP");
  h.fechar();
});

test("rendimento: filtros de disciplina e período", async () => {
  const h = await abrirRendimento();
  h.App.setProgDisc("por"); await h.estabilizar();
  assert.match(h.texto(), /1\s*Lições feitas/);
  h.App.setProgDisc(""); h.App.setProgPeriodo("30"); await h.estabilizar();
  assert.match(h.texto(), /2\s*Lições feitas/, "registro antigo sai do período de 30 dias");
  h.App.setProgPeriodo("todos"); h.App.setProgTurma("A"); await h.estabilizar();
  assert.match(h.texto(), /3\s*Lições feitas/);
  h.fechar();
});

test("rendimento: escopo incompleto não mostra alunos; erro de conexão mostra aviso e permite recarregar", async () => {
  const s = seed(); s.professores.p1.anos = [];
  let h = await abrirRendimento({ seed: s });
  assert.match(h.texto(), /Complete seu perfil para ver o rendimento/);
  assert.doesNotMatch(h.texto(), /Ana Souza/);
  h.fechar();

  h = await abrirProfessor({ seed: seed() });
  h.store.falhar({ op: "get", colecao: "alunos" });
  await h.clicar(/Rendi\./);
  assert.match(h.texto(), /Não foi possível carregar o rendimento/);
  await h.clicar(/Atualizar dados/);
  assert.match(h.texto(), /Alunos \(2\)/);
  h.fechar();
});

test("rendimento: sem alunos no escopo mostra mensagem com o escopo", async () => {
  const s = seed(); s.alunos = { a2: s.alunos.a2 };
  const h = await abrirRendimento({ seed: s });
  assert.match(h.texto(), /Nenhum aluno encontrado no seu escopo \(turmas A • anos 3º ano\)/);
  h.fechar();
});

// ---------------- gestão de alunos ----------------
test("redefinir senha: cancelar, senha curta e sucesso (grava só o hash)", async () => {
  const h = await abrirRendimento();
  h.respostaPrompt(null);
  await h.clicar(botaoDoAluno(h, "a1", "redefinirSenhaAluno"));
  assert.equal(h.store.escritas("alunos").length, 0);
  h.respostaPrompt("ab");
  await h.clicar(botaoDoAluno(h, "a1", "redefinirSenhaAluno"));
  assert.equal(ultimoToast(h), "A senha deve ter ao menos 3 caracteres.");
  h.respostaPrompt("  nova123  ");
  await h.clicar(botaoDoAluno(h, "a1", "redefinirSenhaAluno"));
  assert.equal(h.store.doc("alunos", "a1").senha, F.hash("nova123"));
  assert.doesNotMatch(JSON.stringify(h.store.doc("alunos", "a1")), /nova123/, "senha em claro nunca é gravada");
  assert.equal(ultimoToast(h), "Senha redefinida! ✅");
  assert.equal(h.store.doc("alunos", "a1").nome, "Ana Souza", "merge não apaga outros campos");
  h.fechar();
});

test("gestão: alterar/remover/zerar aluno FORA do escopo (id manipulado) é bloqueado", async () => {
  const h = await abrirRendimento();
  h.respostaPrompt("hack123");
  await h.App.redefinirSenhaAluno("a2"); await h.estabilizar();
  assert.equal(ultimoToast(h), "Você só pode alterar alunos das suas turmas.");
  await h.App.removerAluno("a3"); await h.estabilizar();
  assert.equal(ultimoToast(h), "Você só pode remover alunos das suas turmas.");
  await h.App.zerarProgressoAluno("a2"); await h.estabilizar();
  assert.equal(ultimoToast(h), "Aluno não encontrado.");
  assert.equal(h.store.log.length, 0);
  assert.equal(h.confirmacoes.length, 0);
  h.fechar();
});

test("remover aluno: cancelar mantém; confirmar apaga conta e progresso SÓ dele", async () => {
  const h = await abrirRendimento({ confirmar: false });
  await h.clicar(botaoDoAluno(h, "a1", "removerAluno"));
  assert.match(h.confirmacoes[0], /Remover Ana Souza\? A conta e o histórico de progresso dele serão excluídos/);
  assert.ok(h.store.doc("alunos", "a1"));
  h.respostaConfirm(true);
  await h.clicar(botaoDoAluno(h, "a1", "removerAluno"));
  assert.equal(h.store.doc("alunos", "a1"), undefined);
  assert.equal(h.store.doc("progresso", "a1_L1"), undefined);
  assert.ok(h.store.doc("progresso", "a4_L1"), "progresso de outro aluno intacto");
  assert.ok(h.store.doc("alunos", "a4"));
  assert.equal(ultimoToast(h), "Aluno removido.");
  assert.match(h.texto(), /Alunos \(1\)/);
  h.fechar();
});

// DEFEITO (regressão): remover aluno deixava as conquistas dele (premiacoes_alunos) órfãs.
test("remover aluno: não deixa premiacoes_alunos órfãs (e preserva as dos outros)", async () => {
  const h = await abrirRendimento();
  await h.clicar(botaoDoAluno(h, "a1", "removerAluno"));
  assert.equal(h.store.doc("alunos", "a1"), undefined);
  assert.equal(h.store.doc("premiacoes_alunos", "a1_P1"), undefined, "conquista do aluno removido não pode ficar órfã");
  assert.ok(h.store.doc("premiacoes_alunos", "a4_P1"));
  h.fechar();
});

test("remover aluno: falha de rede ao apagar a conta avisa e mantém a conta", async () => {
  const h = await abrirRendimento();
  h.store.falhar({ op: "delete", colecao: "alunos" });
  await h.clicar(botaoDoAluno(h, "a1", "removerAluno"));
  assert.ok(h.store.doc("alunos", "a1"));
  assert.equal(ultimoToast(h), "Erro ao remover o aluno. Verifique a conexão.");
  h.fechar();
});

test("zerar progresso: apaga progresso e conquistas só do aluno e zera a gamificação preservando a conta", async () => {
  const h = await abrirRendimento({ confirmar: false });
  await h.clicar(botaoDoAluno(h, "a4", "zerarProgressoAluno"));
  assert.match(h.confirmacoes[0], /zerar todo o progresso de Duda Lima/);
  assert.equal(h.store.escritas().length, 0);
  h.respostaConfirm(true);
  await h.clicar(botaoDoAluno(h, "a4", "zerarProgressoAluno"));
  assert.equal(h.store.doc("progresso", "a4_L1"), undefined);
  assert.equal(h.store.doc("progresso", "a4_LP"), undefined);
  assert.equal(h.store.doc("premiacoes_alunos", "a4_P1"), undefined);
  assert.ok(h.store.doc("progresso", "a1_L1"), "outros alunos intactos");
  assert.ok(h.store.doc("premiacoes_alunos", "a1_P1"));
  const a4 = copia(h.store.doc("alunos", "a4"));
  assert.equal(a4.xpTotal, 0); assert.deepEqual(a4.medalhas, []); assert.deepEqual(a4.licoesConcluidas, []);
  assert.equal(a4.nome, "Duda Lima"); assert.equal(a4.senha, F.hash("senha123")); assert.equal(a4.turma, "A");
  assert.equal(ultimoToast(h), "✅ Progresso de Duda Lima zerado com sucesso");
  h.fechar();
});

test("zerar progresso: erro no Firestore avisa", async () => {
  const h = await abrirRendimento();
  h.store.falhar({ op: "get", colecao: "progresso" });
  await h.clicar(botaoDoAluno(h, "a4", "zerarProgressoAluno"));
  assert.match(ultimoToast(h), /Erro ao zerar o progresso/);
  h.fechar();
});

// ---------------- premiações ----------------
async function abrirPremios(o) {
  const h = await abrirProfessor(Object.assign({ seed: seed() }, o || {}));
  await h.clicar(/Prêmios/);
  return h;
}

test("premiações: lista só as da turma do professor (ou sem turma)", async () => {
  const h = await abrirPremios();
  assert.match(h.texto(), /Primeira lição/);
  assert.doesNotMatch(h.texto(), /Só turma B/);
  h.fechar();
});

test("premiações: validações de nome e valor; criar com expiração; trocar critério preserva o formulário", async () => {
  const h = await abrirPremios();
  await h.clicar(/Criar premiação/);
  assert.equal(ultimoToast(h), "Dê um nome à premiação.");
  await h.preencher("pmNome", "Craque do XP");
  await h.clicar(/Criar premiação/);
  assert.equal(ultimoToast(h), "Informe o valor do critério.");
  h.campo("pmCriterio").value = "pontuacao"; h.App.setPremCriterio("pontuacao"); await h.estabilizar();
  assert.equal(h.campo("pmNome").value, "Craque do XP");
  assert.match(h.texto(), /XP mínimo/);
  await h.preencher("pmValor", "200");
  await h.preencher("pmTurma", "A");
  await h.preencher("pmExpira", "2026-12-31");
  await h.clicar(/Criar premiação/);
  const nova = Object.values(h.store.colecao("premiacoes")).find(p => p.nome === "Craque do XP");
  assert.ok(nova);
  assert.equal(nova.criterio, "pontuacao"); assert.equal(nova.valorMinimo, 200); assert.equal(nova.turma, "A"); assert.equal(nova.icone, "🏆");
  assert.equal(new Date(nova.expiracaoEm.seconds * 1000).getFullYear(), 2026);
  assert.match(h.texto(), /Craque do XP/);
  assert.match(h.texto(), /200 XP • Turma A • expira 31\/12\/2026/);
  h.fechar();
});

test("premiações: excluir com confirmação (cancelar mantém); erro ao salvar avisa", async () => {
  const h = await abrirPremios({ confirmar: false });
  await h.clicar(h.document.querySelector('[onclick="App.excluirPremiacao(\'P1\')"]'));
  assert.ok(h.store.doc("premiacoes", "P1"));
  h.respostaConfirm(true);
  await h.clicar(h.document.querySelector('[onclick="App.excluirPremiacao(\'P1\')"]'));
  assert.equal(h.store.doc("premiacoes", "P1"), undefined);
  assert.equal(ultimoToast(h), "Premiação excluída.");
  h.store.falhar({ op: "add", colecao: "premiacoes" });
  await h.preencher("pmNome", "X"); await h.preencher("pmValor", "1");
  await h.clicar(/Criar premiação/);
  assert.equal(ultimoToast(h), "Erro ao salvar premiação.");
  assert.ok(h.tem(/Criar premiação/), "botão volta após erro");
  h.fechar();
});

test("premiações: aluno da turma conquista ao concluir a lição (premiacoes_alunos); de outra turma não", async () => {
  const s = seed(); s.premiacoes_alunos = {};
  const aluno = await abrirApp({ seed: s, local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" }, ia: { padrao: "ok" } });
  aluno.App.openSubject("mat"); aluno.App.openLesson("L1"); await aluno.estabilizar();
  aluno.App.startExercises(); await aluno.estabilizar();
  for (let i = 0; i < 3; i++) { aluno.App.selectOpt(0); aluno.App.checkAnswer(); aluno.App.nextExercise(); await aluno.estabilizar(); }
  await aluno.estabilizar();
  assert.ok(aluno.store.doc("premiacoes_alunos", "a1_P1"), "conquistou a premiação da turma A");
  assert.equal(aluno.store.doc("premiacoes_alunos", "a1_PB"), undefined, "premiação da turma B não se aplica");
  assert.ok(aluno.toasts.some(t => /Primeira lição/.test(t)));
  aluno.fechar();
});

// ---------------- conta ----------------
test("conta: altera turmas/anos/disciplinas e grava; validações de mínimo", async () => {
  const h = await abrirProfessor({ seed: seed() });
  await h.clicar(/Conta/);
  h.App.toggleContaTurma("B"); h.App.toggleContaAno("4º ano"); h.App.toggleContaDisc("cie"); await h.estabilizar();
  await h.clicar(/Salvar alterações/);
  const p = copia(h.store.doc("professores", "p1"));
  assert.deepEqual(p.turmas, ["A", "B"]); assert.deepEqual(p.anos, ["3º ano", "4º ano"]);
  assert.deepEqual(p.disciplinas, ["mat", "por", "cie"]);
  assert.equal(p.senha, F.hash("prof123"), "merge preserva a senha");
  assert.equal(ultimoToast(h), "Conta atualizada! ✅");
  // o escopo novo vale na hora: lições da turma B passam a aparecer
  h.App.toggleContaTurma("A"); h.App.toggleContaTurma("B"); await h.estabilizar();
  await h.clicar(/Salvar alterações/);
  assert.equal(ultimoToast(h), "Selecione ao menos uma turma.");
  h.App.toggleContaTurma("A"); h.App.toggleContaAno("3º ano"); h.App.toggleContaAno("4º ano"); await h.estabilizar();
  await h.clicar(/Salvar alterações/);
  assert.equal(ultimoToast(h), "Selecione ao menos um ano/série que você leciona.");
  h.fechar();
});

test("conta: erro ao salvar avisa e não altera o perfil local", async () => {
  const h = await abrirProfessor({ seed: seed() });
  await h.clicar(/Conta/);
  h.store.falhar({ op: "set", colecao: "professores" });
  h.App.toggleContaTurma("C"); await h.estabilizar();
  await h.clicar(/Salvar alterações/);
  assert.equal(ultimoToast(h), "Erro ao salvar. Verifique a conexão.");
  assert.deepEqual(copia(h.store.doc("professores", "p1").turmas), ["A"]);
  h.fechar();
});

test("conta: turma legada (fora de A–F) aparece marcada com ✕ e pode ser removida", async () => {
  const s = seed(); s.professores.p1.turmas = ["A", "5 ano"];
  const h = await abrirProfessor({ seed: s });
  await h.clicar(/Conta/);
  assert.ok(h.tem(/Turma 5 ano ✕/));
  await h.clicar(/Turma 5 ano ✕/);
  await h.clicar(/Salvar alterações/);
  assert.deepEqual(copia(h.store.doc("professores", "p1").turmas), ["A"]);
  h.fechar();
});
