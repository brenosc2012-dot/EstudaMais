// Professor: abas, lista de lições, criar/editar/salvar/excluir/cancelar/pré-visualizar.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, ultimoToast, F } = require("../support/professor-helpers");

test("lista: mostra as lições da disciplina no escopo do professor (ano+turma, vazio = curinga)", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: {
    L2: F.licao({ titulo: "Outra turma", turma: "B" }),
    L3: F.licao({ titulo: "Outro ano", ano: "5º ano" }),
    L4: F.licao({ titulo: "Para todas", turma: "", ano: "" }),
  } } });
  const t = h.texto();
  assert.match(t, /Somas simples/);
  assert.match(t, /3 exercício\(s\)/);
  assert.match(t, /Para todas/);
  assert.doesNotMatch(t, /Outra turma/);
  assert.doesNotMatch(t, /Outro ano/);
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

test("lista: professor sem turmas/anos vê orientação para completar o perfil (sem fallback)", async () => {
  const seed = F.banco({ professores: { p1: F.professor({ turmas: [] }) } });
  const h = await abrirProfessor({ seed });
  assert.match(h.texto(), /Complete seu perfil para ver as lições/);
  assert.doesNotMatch(h.texto(), /Somas simples/);
  await h.clicar(/Atualizar meu perfil/);
  assert.match(h.texto(), /Salvar/i);
  h.fechar();
});

test("lista: trocar a disciplina mostra lista vazia", async () => {
  const h = await abrirProfessor();
  h.App.teacherSelectSubj("por"); await h.estabilizar();
  assert.match(h.texto(), /Nenhuma lição desta disciplina/);
  h.fechar();
});

test("abas: navega entre Lições, Nova, Rendimento, Prêmios, Corretor e Conta sem erros", async () => {
  const h = await abrirProfessor();
  for (const aba of [/Nova/, /Rendi/, /Prêmios/, /Corretor/, /Conta/, /Lições/]) {
    await h.clicar(aba);
    assert.deepEqual(h.errosJs(), [], "erro ao abrir aba " + aba);
  }
  assert.match(h.texto(), /Somas simples/);
  h.fechar();
});

test("nova lição: cria no Firestore com escopo e exercícios", async () => {
  const h = await abrirProfessor();
  await h.clicar(/Criar nova lição/);
  await h.preencher("lTitulo", "Subtração");
  await h.preencher("lTexto", "Subtrair é tirar.");
  h.campo("lNivel").value = "fund1"; h.App.onLessonNivel("fund1"); await h.estabilizar();
  await h.preencher("lAno", "3º ano");
  await h.preencher("lTurma", "A");
  await h.clicar(/Adicionar exercício/);
  const inputs = h.document.querySelectorAll("#exList input");
  inputs[0].value = "Quanto é 5 - 2?"; inputs[0].dispatchEvent(new h.window.Event("input"));
  inputs[1].value = "3"; inputs[1].dispatchEvent(new h.window.Event("input"));
  inputs[2].value = "4"; inputs[2].dispatchEvent(new h.window.Event("input"));
  await h.clicar(/Salvar lição/);
  const novos = Object.entries(h.store.colecao("licoes")).filter(([id]) => id !== "L1");
  assert.equal(novos.length, 1);
  const [, d] = novos[0];
  assert.equal(d.titulo, "Subtração");
  assert.equal(d.conteudo, "Subtrair é tirar.");
  assert.equal(d.disciplina, "mat");
  assert.equal(d.turma, "A"); assert.equal(d.ano, "3º ano"); assert.equal(d.nivel, "fund1");
  assert.equal(d.resumoIA, "");
  assert.ok(d.criadoEm && d.criadoEm.seconds > 0, "criadoEm com serverTimestamp");
  assert.equal(d.exercicios.length, 1);
  assert.equal(d.exercicios[0].enunciado, "Quanto é 5 - 2?");
  assert.deepEqual([...d.exercicios[0].opcoes], ["3", "4"]);
  assert.equal(ultimoToast(h), "✅ Lição salva com sucesso!");
  assert.match(h.texto(), /Subtração/, "volta para a lista com a lição nova");
  h.fechar();
});

test("salvar: validações bloqueiam a gravação (título, enunciado, opções, resposta da lacuna)", async () => {
  const h = await abrirProfessor();
  await h.clicar(/Criar nova lição/);
  await h.clicar(/Salvar lição/);
  assert.equal(ultimoToast(h), "Dê um título à lição.");
  await h.preencher("lTitulo", "T");
  await h.clicar(/Adicionar exercício/);
  await h.clicar(/Salvar lição/);
  assert.equal(ultimoToast(h), "Exercício 1: falta o enunciado.");
  h.App.setExEnun(0, "Pergunta?");
  await h.clicar(/Salvar lição/);
  assert.equal(ultimoToast(h), "Exercício 1: preencha todas as opções.");
  h.App.setExType(0, "fill"); await h.estabilizar();
  await h.clicar(/Salvar lição/);
  assert.equal(ultimoToast(h), "Exercício 1: informe a resposta.");
  assert.equal(h.store.escritas("licoes").length, 0, "nada foi gravado");
  h.fechar();
});

test("salvar: título só com espaços é rejeitado (caso extremo)", async () => {
  const h = await abrirProfessor();
  await h.clicar(/Criar nova lição/);
  await h.preencher("lTitulo", "    ");
  await h.clicar(/Salvar lição/);
  assert.equal(ultimoToast(h), "Dê um título à lição.");
  h.fechar();
});

test("editar: set merge invalida resumoIA/explicações, limpa licoes_geradas e normaliza turma", async () => {
  const seed = F.banco({
    licoes: { L1: F.licao({ resumoIA: "resumo velho", explicacoes: { ex1: "exp" }, turma: " a " }) },
    licoes_geradas: { L1: { licaoId: "L1", resumo: "cache" } },
    progresso: { a1_L1: { alunoId: "a1", licaoId: "L1", acertos: 3, total: 3 } },
  });
  const h = await abrirProfessor({ seed, editar: "L1" });
  assert.match(h.texto(), /Editando lição/);
  await h.preencher("lTitulo", "Somas (revisada)");
  await h.clicar(/Salvar lição/);
  const d = h.store.doc("licoes", "L1");
  assert.equal(d.titulo, "Somas (revisada)");
  assert.equal(d.resumoIA, "");
  assert.equal(d.explicacoes, undefined, "explicações removidas (FieldValue.delete)");
  assert.equal(d.turma, "A", "turma normalizada em maiúscula e sem espaços");
  assert.equal(h.store.doc("licoes_geradas", "L1"), undefined, "cache de IA limpo");
  assert.deepEqual(h.store.doc("progresso", "a1_L1").acertos, 3, "histórico do aluno preservado");
  assert.equal(Object.keys(h.store.colecao("licoes")).length, 1, "não criou documento novo");
  h.fechar();
});

test("salvar: falha no Firestore mostra erro e mantém o editor aberto", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.store.falhar({ op: "set", colecao: "licoes", erro: new Error("rede caiu") });
  await h.preencher("lTitulo", "Novo título");
  await h.clicar(/Salvar lição/);
  assert.match(ultimoToast(h), /Erro ao salvar: rede caiu/);
  assert.equal(h.store.doc("licoes", "L1").titulo, "Somas simples");
  assert.match(h.texto(), /Editando lição/);
  h.fechar();
});

test("excluir: cancelar não apaga; confirmar apaga só a lição escolhida", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L2: F.licao({ titulo: "Segunda" }) } }, confirmar: false });
  h.document.querySelector('[onclick="App.deleteLesson(\'L1\')"]').click(); await h.estabilizar();
  assert.equal(h.confirmacoes[0], "Excluir esta lição e todos os seus exercícios?");
  assert.ok(h.store.doc("licoes", "L1"));
  h.respostaConfirm(true);
  h.document.querySelector('[onclick="App.deleteLesson(\'L1\')"]').click(); await h.estabilizar();
  assert.equal(h.store.doc("licoes", "L1"), undefined);
  assert.ok(h.store.doc("licoes", "L2"), "outra lição intacta");
  assert.equal(ultimoToast(h), "Lição excluída.");
  assert.doesNotMatch(h.texto(), /Somas simples/);
  h.fechar();
});

test("excluir: erro de rede mantém a lição e avisa", async () => {
  const h = await abrirProfessor();
  h.store.falhar({ op: "delete", colecao: "licoes" });
  await h.App.deleteLesson("L1"); await h.estabilizar();
  assert.ok(h.store.doc("licoes", "L1"));
  assert.equal(ultimoToast(h), "Erro ao excluir. Verifique a conexão.");
  h.fechar();
});

test("cancelar edição volta à lista sem gravar", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await h.preencher("lTitulo", "Não salvar");
  await h.clicar(/^Cancelar$/);
  assert.match(h.texto(), /Lições cadastradas/);
  assert.equal(h.store.escritas("licoes").length, 0);
  assert.equal(h.store.doc("licoes", "L1").titulo, "Somas simples");
  h.fechar();
});

test("pré-visualizar mostra material, exercícios com a correta destacada e volta ao editor", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L1: F.licao({ exercicios: [F.mc(1), F.fill(2, "sete")] }) } }, editar: "L1" });
  await h.clicar(/Pré-visualizar/);
  const t = h.texto();
  assert.match(t, /Pré-visualização/);
  assert.match(t, /Somar é juntar quantidades/);
  assert.match(t, /Exercícios \(2\)/);
  assert.match(t, /Resposta: sete/);
  assert.equal(h.document.querySelectorAll(".opt.correct").length, 1);
  await h.clicar(/Voltar ao editor/);
  assert.match(h.texto(), /Editando lição/);
  h.fechar();
});

test("título com HTML é escapado na lista (sem injeção)", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L1: F.licao({ titulo: '<img src=x onerror="alert(1)">' }) } } });
  assert.equal(h.document.querySelector("#app img[src=x]"), null);
  assert.match(h.texto(), /<img src=x/);
  h.fechar();
});
