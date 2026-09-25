// Autorização e isolamento: ações de professor/admin não podem ser executadas por aluno
// ou por visitante sem sessão; cada aluno só enxerga o que é do seu ano+turma.
//
// Contexto: o app é client-only e o Firestore está com regras abertas (`if true`), então
// estes testes validam as guardas da APLICAÇÃO (UI + handlers de window.App). A falta de
// autorização no servidor é limitação conhecida de arquitetura (ver relatório).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, sessao, F } = require("../support/auth-helpers");

const EXTRA = {
  premiacoes: { pr1: { nome: "Top", criterio: "pontuacao", valorMinimo: 10, turma: "A" } },
  progresso: { a1_L1: { alunoId: "a1", licaoId: "L1", acertos: 3, total: 3, concluido: true } },
  alunos: { a2: F.aluno({ nome: "Bruno Dias", senha: F.hash("bruno1") }) },
};
const SESSOES = [["aluno logado", { tipo: "aluno", id: "a1" }], ["sem sessão", undefined]];

/** Executa o handler e devolve { escritas, erro } sem deixar o teste quebrar. */
async function executar(h, fn, args) {
  h.respostaConfirm(true);
  h.respostaPrompt("senhaHacker");
  const antes = h.store.log.length;
  let erro = null;
  try { await h.App[fn](...(args || [])); } catch (e) { erro = e; }
  await h.estabilizar();
  return { escritas: h.store.log.slice(antes).map(l => `${l.op} ${l.caminho}`), erro, errosJs: h.errosJs() };
}

// --- UI: o aluno não enxerga nenhuma ação administrativa ---
test("UI do aluno: nenhuma ação de professor/admin em home, lista, perfil e estudo", async t => {
  const h = await abrir(t, { sessao: { tipo: "aluno", id: "a1" } });
  const proibidos = /Nova lição|Excluir|Editar|Regenerar|Gerar .*IA|Rendimento|Premia|Salvar configuração|Remover|Redefinir|Zerar progresso de|Painel do Professor/i;
  const telas = [
    () => {},
    () => h.App.openSubject("mat"),
    () => h.App.openProfile(),
    () => h.App.openLesson("L1"),
  ];
  for (const ir of telas) {
    ir(); await h.estabilizar();
    const achados = h.nomes().filter(n => proibidos.test(n));
    assert.deepEqual(achados, [], "botões administrativos visíveis: " + achados.join(", ") + "\nTela: " + h.texto().slice(0, 200));
  }
});

// --- Handlers administrativos chamados sem ser professor ---
// Cada linha: [handler, argumentos]. Todos devem terminar SEM gravar e sem erro de JS.
const ACOES_PROFESSOR = [
  ["deleteLesson", ["L1"]],
  ["removerAluno", ["a2"]],
  ["redefinirSenhaAluno", ["a2"]],
  ["zerarProgressoAluno", ["a1"]],
  ["excluirPremiacao", ["pr1"]],
  ["criarPremiacao", []],
  ["saveLesson", []],
  ["gerarExerciciosIA", []],
  ["regenerarConteudoIA", []],
  ["regenerarExerciciosIA", []],
  ["regenerarHistoriaProf", []],
  ["gerarInterpretacao", []],
  ["salvarConta", []],
  ["salvarChaveOpenAI", []],
];
for (const [fn, args] of ACOES_PROFESSOR) {
  test(`autorização: App.${fn}() sem professor não grava nada nem quebra`, async t => {
    for (const [rotulo, s] of SESSOES) {
      const h = await abrir(t, { extra: EXTRA, sessao: s });
      const r = await executar(h, fn, args);
      assert.deepEqual(r.escritas, [], `${rotulo}: ${fn} gravou no banco`);
      assert.equal(r.erro, null, `${rotulo}: ${fn} lançou ${r.erro && r.erro.message}`);
      assert.deepEqual(r.errosJs, [], `${rotulo}: erro de JS`);
      assert.ok(h.store.doc("licoes", "L1") && h.store.doc("alunos", "a2") && h.store.doc("premiacoes", "pr1"), `${rotulo}: dado apagado`);
      assert.equal(h.store.doc("alunos", "a2").senha, F.hash("bruno1"), `${rotulo}: senha de outro aluno alterada`);
      assert.equal(h.store.doc("config", "openai").apiKey, "sk-teste-NAO-REAL", `${rotulo}: config da IA alterada`);
    }
  });
}

test("autorização: irTela('teacher') sem professor não abre o painel do professor", async t => {
  for (const [rotulo, s] of SESSOES) {
    const h = await abrir(t, { sessao: s });
    h.App.irTela("teacher"); await h.estabilizar();
    assert.doesNotMatch(h.texto(), /Painel do Professor/, rotulo);
  }
});

test("autorização: irTela('admin') sempre pede a senha de admin", async t => {
  const h = await abrir(t, { sessao: { tipo: "aluno", id: "a1" } });
  h.App.irTela("admin"); await h.estabilizar();
  assert.ok(h.campo("admSenha"));
  assert.doesNotMatch(h.texto(), /Configuração da IA/);
});

test("autorização: professor não remove nem redefine senha de aluno fora do seu escopo (turma+ano)", async t => {
  // p1 leciona turma A / 3º ano; a2 é da turma B → fora do escopo
  const extra = { alunos: { a2: F.aluno({ nome: "Bruno Dias", turma: "B", senha: F.hash("bruno1") }) } };
  const h = await abrir(t, { extra, sessao: { tipo: "professor", id: "p1" } });
  h.App.teacherTab("progresso"); await h.estabilizar();
  for (const fn of ["removerAluno", "redefinirSenhaAluno", "zerarProgressoAluno"]) {
    const r = await executar(h, fn, ["a2"]);
    assert.deepEqual(r.escritas, [], `${fn} alterou aluno fora do escopo`);
  }
  assert.equal(h.store.doc("alunos", "a2").senha, F.hash("bruno1"));
});

test("professor: redefinir senha de aluno do escopo grava só o hash; senha curta e cancelar não gravam", async t => {
  const h = await abrir(t, { sessao: { tipo: "professor", id: "p1" } });
  h.App.teacherTab("progresso"); await h.estabilizar();
  h.respostaPrompt(null);
  await h.App.redefinirSenhaAluno("a1"); await h.estabilizar();
  h.respostaPrompt("ab");
  await h.App.redefinirSenhaAluno("a1"); await h.estabilizar();
  assert.ok(h.toasts.some(x => /ao menos 3 caracteres/.test(x)));
  assert.equal(h.store.doc("alunos", "a1").senha, F.hash("senha123"));
  h.respostaPrompt("  nova123  ");
  await h.App.redefinirSenhaAluno("a1"); await h.estabilizar();
  assert.equal(h.store.doc("alunos", "a1").senha, F.hash("nova123"));
  assert.ok(!JSON.stringify(h.store.doc("alunos", "a1")).includes("nova123"));
});

// --- sessão local adulterada ---
test("sessão adulterada tipo 'professor' com id de aluno: não vira professor (landing)", async t => {
  const h = await abrir(t, { sessao: { tipo: "professor", id: "a1" } });
  assert.match(h.texto(), /Sou Aluno/);
  assert.equal(sessao(h), null);
});

test("LIMITAÇÃO CONHECIDA: sessão local com id de outro aluno entra nessa conta (sem Firebase Auth)", async t => {
  // A sessão é só {tipo,id} no localStorage, sem token assinado: quem conhece o id de
  // outra conta assume essa conta. Documentado; a correção exige Firebase Auth.
  const h = await abrir(t, { extra: EXTRA, sessao: { tipo: "aluno", id: "a2" } });
  assert.match(h.texto(), /Olá, Bruno Dias/);
});

// --- isolamento entre alunos ---
test("isolamento: aluno só vê lições do seu ano E turma (regra estrita, tolerante a caixa/espaços)", async t => {
  const extra = { licoes: {
    L2: F.licao({ titulo: "Outra turma", turma: "B" }),
    L3: F.licao({ titulo: "Outro ano", ano: "4º ano" }),
    L4: F.licao({ titulo: "Mesma turma em minúscula", turma: " a ", ano: "3º ANO" }),
    L5: F.licao({ titulo: "Sem turma", turma: "" }),
    L6: F.licao({ titulo: "Sem ano", ano: "" }),
    L7: F.licao({ titulo: "Outro nível", nivel: "fund2" }),
    L8: F.licao({ titulo: "Sem nível", nivel: "" }),
    L9: F.licao({ titulo: "Demo escondida", isDemo: true }),
  } };
  const h = await abrir(t, { extra, sessao: { tipo: "aluno", id: "a1" } });
  h.App.openSubject("mat"); await h.estabilizar();
  const txt = h.texto();
  for (const vis of ["Somas simples", "Mesma turma em minúscula", "Sem nível"]) assert.match(txt, new RegExp(vis), vis);
  for (const esc of ["Outra turma", "Outro ano", "Sem turma", "Sem ano", "Outro nível", "Demo escondida"]) assert.doesNotMatch(txt, new RegExp(esc), esc);
});

test("isolamento: progresso é gravado só no doc {alunoId}_{licaoId} do próprio aluno", async t => {
  const h = await abrir(t, { extra: EXTRA, sessao: { tipo: "aluno", id: "a1" } });
  h.ia.padrao("Resumo.");
  h.App.openSubject("mat"); await h.estabilizar();
  await h.App.openLesson("L1"); await h.estabilizar();
  h.App.iniciarModoClassico(); await h.estabilizar();
  for (let i = 0; i < 3; i++) { h.App.selectOpt(0); h.App.checkAnswer(); await h.estabilizar(); h.App.nextExercise(); await h.estabilizar(); }
  const prog = h.store.escritas("progresso").map(l => l.caminho);
  assert.deepEqual([...new Set(prog)], ["progresso/a1_L1"]);
  const doc = h.store.doc("progresso", "a1_L1");
  assert.equal(doc.alunoId, "a1"); assert.equal(doc.acertos, 3); assert.equal(doc.percentualAcertos, 100);
  const alunos = [...new Set(h.store.escritas("alunos").map(l => l.caminho))];
  assert.deepEqual(alunos, ["alunos/a1"], "só o doc do próprio aluno é atualizado");
});

test("isolamento: rendimento do professor lista só alunos da sua turma E ano", async t => {
  const extra = { alunos: {
    a2: F.aluno({ nome: "Bruno Turma B", turma: "B" }),
    a3: F.aluno({ nome: "Caio Quarto Ano", ano: "4º ano" }),
    a4: F.aluno({ nome: "Duda Mesma Sala", turma: "a" }),
  } };
  const h = await abrir(t, { extra, sessao: { tipo: "professor", id: "p1" } });
  h.App.teacherTab("progresso"); await h.estabilizar();
  const txt = h.texto();
  assert.match(txt, /Ana Souza/); assert.match(txt, /Duda Mesma Sala/);
  assert.doesNotMatch(txt, /Bruno Turma B/); assert.doesNotMatch(txt, /Caio Quarto Ano/);
});

test("isolamento: professor com escopo incompleto (sem anos) não vê aluno nenhum", async t => {
  const h = await abrir(t, { extra: { professores: { p1: F.professor({ anos: [] }) } }, sessao: { tipo: "professor", id: "p1" } });
  h.App.teacherTab("progresso"); await h.estabilizar();
  assert.doesNotMatch(h.texto(), /Ana Souza/);
});
