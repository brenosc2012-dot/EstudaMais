// Aluno: resposta correta e conclusão — recompensa, medalhas, persistência, recarregar, idempotência, ofensiva.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

async function concluir(h, n) {
  for (let i = 0; i < (n || 3); i++) { await A.acertar(h); await h.clicar("Continuar"); }
}

test("última questão conclui: tela de celebração com XP, nível e medalhas", async () => {
  const h = await A.iniciarClassico({});
  await concluir(h);
  const t = h.texto();
  assert.match(t, /Lição Concluída!/);
  assert.match(t, /Você acertou 3 de 3 exercícios!/);
  assert.match(t, /\+50XP/, "30 de acertos + 20 de bônus");
  assert.match(t, /Subiu para o Nível 2!/);
  assert.match(t, /Primeiros Passos/);
  assert.match(t, /Nota Mil/);
  assert.match(t, /Gabarito perfeito!/);
  h.fechar();
});

test("progresso gravado em progresso/{alunoId}_{licaoId} com todos os campos", async () => {
  const h = await A.iniciarClassico({ seed: { licoes: { L1: F.licao({ exerciciosVersao: 2 }) } } });
  await concluir(h);
  const p = h.store.dados.progresso.a1_L1;
  assert.equal(p.alunoId, "a1"); assert.equal(p.alunoNome, "Ana Souza"); assert.equal(p.licaoId, "L1");
  assert.equal(p.disciplina, "mat"); assert.equal(p.turma, "A"); assert.equal(p.ano, "3º ano"); assert.equal(p.nivel, "fund1");
  assert.equal(p.acertos, 3); assert.equal(p.erros, 0); assert.equal(p.total, 3);
  assert.equal(p.percentualAcertos, 100); assert.equal(p.xpGanho, 30);
  assert.equal(p.concluido, true); assert.equal(p.modo, "classico"); assert.equal(p.exerciciosVersao, 2);
  assert.equal(typeof p.concluidoEm.toMillis, "function", "timestamp do servidor");
  h.fechar();
});

test("recompensa persistida no doc do aluno (write-through) e no cache local", async () => {
  const h = await A.iniciarClassico({});
  await concluir(h);
  const a = h.store.dados.alunos.a1;
  assert.equal(a.xpTotal, 50);
  assert.equal(a.disciplinas.mat.xp, 50);
  assert.equal(a.disciplinas.mat.nivel, 2);
  assert.equal(JSON.stringify(a.disciplinas.mat.licoesConcluidas), '["L1"]');
  assert.equal(JSON.stringify(a.licoesConcluidas), '["L1"]');
  assert.ok(a.medalhas.includes("first") && a.medalhas.includes("perfeito"));
  assert.equal(a.senha, F.hash("senha123"), "identidade preservada");
  const cache = JSON.parse(h.window.localStorage.getItem("estudamais_aluno_cache_v2"));
  assert.equal(cache.id, "a1"); assert.equal(cache.doc.xpTotal, 50);
  // voltar mostra a lição concluída
  await h.clicar("Continuar");
  assert.match(h.texto(), /Somas simples 3 exercícios • Concluída ✅/);
  h.fechar();
});

test("conclusão com erros: revisão lista as erradas e percentual reflete a tentativa final", async () => {
  // um erro reinicia a tentativa; só a tentativa final (perfeita) é registrada
  const h = await A.iniciarClassico({});
  await A.errar(h);
  await A.esperarExplicacao(h);
  await h.clicar(/Entendi, recomeçar/);
  await concluir(h);
  const p = h.store.dados.progresso.a1_L1;
  assert.equal(p.acertos, 3); assert.equal(p.erros, 0); assert.equal(p.percentualAcertos, 100);
  assert.equal(h.store.escritas("progresso").length, 1, "gravado uma única vez");
  h.fechar();
});

test("repetir uma lição já concluída: soma XP de novo mas não duplica a lição concluída", async () => {
  const h = await A.iniciarClassico({});
  await concluir(h);
  await h.clicar("Continuar");
  await h.clicar(/Somas simples/);
  await A.irParaClassico(h);
  await concluir(h);
  const a = h.store.dados.alunos.a1;
  assert.equal(JSON.stringify(a.disciplinas.mat.licoesConcluidas), '["L1"]');
  assert.equal(a.xpTotal, 100);
  assert.equal(h.store.escritas("progresso").length, 2);
  h.fechar();
});

test("recarregar no meio da tentativa: sessão restaurada na home, nada gravado, pode recomeçar", async () => {
  const h = await A.iniciarClassico({});
  await A.acertar(h);
  const antesLog = h.store.log.length;
  const h2 = await h.recarregar();
  assert.match(h2.texto(), /Olá, Ana Souza!/);
  assert.equal(h2.store.escritas("progresso").length, 0);
  assert.equal(h2.store.dados.alunos.a1.xpTotal, 0);
  assert.ok(h2.store.log.slice(antesLog).every(l => !/^progresso/.test(l.caminho)));
  await A.abrirLicao(h2);
  await A.irParaClassico(h2);
  assert.match(h2.texto(), /Questão 1 de 3/);
  assert.match(h2.texto(), /✅ 0 acertos/);
  assert.deepEqual(h2.errosJs(), []);
  h2.fechar();
});

test("recarregar após concluir mantém o progresso (vem do Firestore)", async () => {
  const h = await A.iniciarClassico({});
  await concluir(h);
  const h2 = await h.recarregar();
  assert.match(h2.texto(), /⭐ 50XP Total/);
  assert.match(h2.texto(), /Matemática 1\/1 lição • 50 XP/);
  h2.fechar();
});

test("tentativa concluída não é alterada: navegar na tela final não regrava nem soma XP", async () => {
  const h = await A.iniciarClassico({});
  await concluir(h);
  const nEsc = h.store.escritas("progresso").length;
  await h.clicar("🏠 Início");
  await h.clicar(/Matemática/);
  await h.estabilizar();
  assert.equal(h.store.escritas("progresso").length, nEsc);
  assert.equal(h.store.dados.alunos.a1.xpTotal, 50);
  h.fechar();
});

test("REGRESSÃO: App.nextExercise() após concluir não conclui de novo (XP/progresso em dobro)", async () => {
  const h = await A.iniciarClassico({});
  await concluir(h);
  h.App.nextExercise();
  await h.estabilizar();
  assert.equal(h.store.dados.alunos.a1.xpTotal, 50);
  assert.equal(h.store.escritas("progresso").length, 1);
  h.fechar();
});

test("ofensiva: dia seguinte soma 1; pular um dia reinicia em 1; mesmo dia não muda", async () => {
  const ontem = new Date(2026, 2, 9, 12).toDateString();
  const anteontem = new Date(2026, 2, 8, 12).toDateString();
  const hoje = new Date(2026, 2, 10, 12).toDateString();
  let h = await A.entrarAluno({ seed: { alunos: { a1: F.aluno({ streak: 4, ultimoDia: ontem }) } } });
  assert.match(h.texto(), /🔥 5Ofensiva/);
  assert.equal(h.store.dados.alunos.a1.ultimoDia, hoje);
  h.fechar();
  h = await A.entrarAluno({ seed: { alunos: { a1: F.aluno({ streak: 4, ultimoDia: anteontem }) } } });
  assert.match(h.texto(), /🔥 1Ofensiva/);
  h.fechar();
  h = await A.entrarAluno({ seed: { alunos: { a1: F.aluno({ streak: 4, ultimoDia: hoje }) } } });
  assert.match(h.texto(), /🔥 4Ofensiva/);
  h.fechar();
});

test("ofensiva avança quando o relógio vira o dia com o app aberto", async () => {
  const h = await A.entrarAluno({ seed: { alunos: { a1: F.aluno({ streak: 2, ultimoDia: new Date(2026, 2, 9, 12).toDateString() }) } } });
  assert.match(h.texto(), /🔥 3Ofensiva/);
  h.relogio.agora += 24 * 3600 * 1000;
  await h.clicar(/Matemática/); await h.clicar("←");
  assert.match(h.texto(), /🔥 4Ofensiva/);
  h.fechar();
});

test("medalhas por marco: 100 XP, ofensiva de 3 dias e Explorador (3 disciplinas)", async () => {
  const aluno = F.aluno({ xpTotal: 60, streak: 2, ultimoDia: new Date(2026, 2, 9, 12).toDateString() });
  aluno.disciplinas.por.licoesConcluidas = ["P1"];
  aluno.disciplinas.cie.licoesConcluidas = ["C1"];
  const h = await A.iniciarClassico({ seed: { alunos: { a1: aluno }, licoes: {
    P1: F.licao({ disciplina: "por", titulo: "P" }), C1: F.licao({ disciplina: "cie", titulo: "C" }) } } });
  await concluir(h);
  const t = h.texto();
  assert.match(t, /Cem de XP/);
  assert.match(t, /Pegando Fogo/);
  assert.match(t, /Explorador/);
  h.fechar();
});
