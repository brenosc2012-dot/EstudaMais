// Professor: corretor de provas — modo manual (correção determinística em JS), feedback
// da IA só para erros, salvar/abrir/excluir no histórico, PDF e compartilhamento.
// (Fotos/modo automático dependem de Image+canvas reais: ver E2E/relatório.)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, ultimoToast, F } = require("../support/professor-helpers");

const copia = v => JSON.parse(JSON.stringify(v));
function seed() {
  return F.banco({
    alunos: { a1: F.aluno(), a2: F.aluno({ nome: "Fora do Escopo", turma: "C" }) },
    correcoes: { C9: { professorId: "p1", alunoNome: "Ana Souza", disciplina: "mat", notaFinal: 10, notaMaxima: 10, conceito: "Excelente", questoes: [{ numero: 1, status: "correta", respostaAluno: "A", respostaCorreta: "A", pontuacao: 10, pontuacaoMaxima: 10 }], dataStr: "01/03/2026" },
      CX: { professorId: "outro", alunoNome: "De outro professor", disciplina: "mat", notaFinal: 1, notaMaxima: 10 } },
  });
}
async function abrirCorretor(o) {
  const h = await abrirProfessor(Object.assign({ seed: seed() }, o || {}));
  await h.clicar(/Corretor/);
  await h.estabilizar();
  return h;
}
/** Configura 4 questões, gabarito A B C D e respostas A B D (branco). */
async function corrigir4(h) {
  h.App.setNumQuestoes(4);
  h.App.setCorretorCampo("alunoId", "a1");
  await h.clicar(/Próximo: informar gabarito/);
  ["A", "B", "C", "D"].forEach((x, i) => h.App.setGabaritoResp(i, x));
  await h.clicar(/Próximo: respostas/);
  ["A", "B", "D"].forEach((x, i) => h.App.setRespAluno(i, x));
  await h.estabilizar();
  await h.clicar(/✅ Corrigir/);
}

test("corretor: lista só alunos do escopo e só o histórico do próprio professor", async () => {
  const h = await abrirCorretor();
  const opcoes = [...h.document.querySelectorAll("select option")].map(o => o.textContent);
  assert.ok(opcoes.includes("Ana Souza"));
  assert.ok(!opcoes.includes("Fora do Escopo"));
  assert.match(h.texto(), /Correções anteriores.*Ana Souza.*10\.0\/10 • Excelente/);
  assert.doesNotMatch(h.texto(), /De outro professor/);
  h.fechar();
});

test("corretor manual: gabarito incompleto bloqueia; correção determinística (nota, %, conceito, status)", async () => {
  const h = await abrirCorretor({ semChave: true });
  h.App.setNumQuestoes(4);
  await h.clicar(/Próximo: informar gabarito/);
  h.App.setGabaritoResp(3, ""); await h.estabilizar(); // o gabarito vem pré-preenchido; apaga um
  await h.clicar(/Próximo: respostas/);
  assert.match(h.texto(), /Selecione a alternativa correta de TODAS as questões/);
  await h.clicar(/← Voltar/);
  await corrigir4(h);
  const t = h.texto();
  assert.match(t, /Resultado da Correção/);
  assert.match(t, /5\.0\s*NOTA/);
  assert.match(t, /50%\s*ACERTOS/);
  assert.match(t, /Regular\s*CONCEITO/);
  assert.match(t, /Questão 3.*Aluno marcou: D.*Resposta correta: C/);
  assert.match(t, /Questão 4.*— \(em branco\)/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

// DEFEITO (regressão): sem chave de IA o feedback padrão era calculado depois do render()
// e nunca aparecia na tela de resultado (só no PDF/registro salvo).
test("corretor manual sem IA: o feedback padrão aparece na tela de resultado", async () => {
  const h = await abrirCorretor({ semChave: true });
  await corrigir4(h);
  assert.match(h.texto(), /Feedback geral.*O aluno acertou 2 de 4/);
  h.fechar();
});

test("corretor manual: com IA, pede comentário só das questões erradas e mostra ao lado", async () => {
  const h = await abrirCorretor();
  h.ia.fila(JSON.stringify({ porQuestao: { "3": "A alternativa C é a certa porque..." }, feedbackGeral: "Bom trabalho.", pontosForca: ["Somas"], pontosMelhoria: ["Atenção"] }));
  await corrigir4(h);
  await h.estabilizar();
  const p = h.ia.ultimoPrompt();
  assert.match(p, /Questão 3: aluno marcou alternativa "D"; alternativa correta é "C"/);
  assert.doesNotMatch(p, /Questão 1:/, "questões certas não vão para a IA");
  assert.match(p, /NÃO recalcule certo\/errado/);
  assert.match(h.texto(), /💬 A alternativa C é a certa porque/);
  assert.match(h.texto(), /Bom trabalho\./);
  assert.match(h.texto(), /5\.0\s*NOTA/, "a IA não altera a nota");
  h.fechar();
});

test("corretor manual: IA falha no feedback → resultado mantido com feedback padrão", async () => {
  const h = await abrirCorretor();
  h.ia.fila({ status: 500 });
  await corrigir4(h);
  await h.estabilizar();
  assert.match(h.texto(), /Revise com o aluno as questões erradas\./);
  assert.match(h.texto(), /5\.0\s*NOTA/);
  h.fechar();
});

test("corretor: tudo certo não chama a IA; número de questões limitado a 1..20", async () => {
  const h = await abrirCorretor();
  h.App.setNumQuestoes(99); await h.estabilizar();
  assert.equal(h.document.querySelector('input[type=number]').value, "20");
  h.App.setNumQuestoes(0); await h.estabilizar();
  assert.equal(h.document.querySelector('input[type=number]').value, "5", "valor inválido volta ao padrão");
  h.App.setNumQuestoes(2);
  await h.clicar(/Próximo: informar gabarito/);
  h.App.setGabaritoResp(0, "A"); h.App.setGabaritoResp(1, "b"); await h.estabilizar();
  await h.clicar(/Próximo: respostas/);
  h.App.setRespAluno(0, "A"); h.App.setRespAluno(1, "B"); await h.estabilizar();
  await h.clicar(/✅ Corrigir/);
  assert.match(h.texto(), /100%\s*ACERTOS/);
  assert.match(h.texto(), /Excelente/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

test("corretor: salvar grava a correção vinculada ao professor e ao aluno; aparece no histórico", async () => {
  const h = await abrirCorretor({ semChave: true });
  await corrigir4(h);
  await h.clicar(/Salvar resultado/);
  await h.estabilizar();
  const novas = Object.entries(h.store.colecao("correcoes")).filter(([id]) => !["C9", "CX"].includes(id));
  assert.equal(novas.length, 1);
  const c = copia(novas[0][1]);
  assert.equal(c.professorId, "p1"); assert.equal(c.alunoId, "a1"); assert.equal(c.alunoNome, "Ana Souza");
  assert.equal(c.notaFinal, 5); assert.equal(c.notaMaxima, 10); assert.equal(c.percentualAcerto, 50);
  assert.equal(c.questoes.length, 4); assert.equal(c.disciplina, "mat");
  assert.equal(ultimoToast(h), "Resultado salvo! ✅");
  h.fechar();
});

test("corretor: erro ao salvar avisa", async () => {
  const h = await abrirCorretor({ semChave: true });
  await corrigir4(h);
  h.store.falhar({ op: "add", colecao: "correcoes" });
  await h.clicar(/Salvar resultado/);
  await h.estabilizar();
  assert.equal(ultimoToast(h), "Erro ao salvar o resultado.");
  h.fechar();
});

test("corretor: PDF gerado com o nome do aluno; compartilhar usa navigator.share", async () => {
  const h = await abrirCorretor({ semChave: true });
  await corrigir4(h);
  await h.clicar(/Gerar PDF/);
  const pdfs = new h.window.jspdf.jsPDF().pdfs;
  assert.deepEqual([...pdfs], ["correcao_Ana_Souza.pdf"]);
  await h.clicar(/Compartilhar/);
  assert.match(h.compartilhados[0].text, /Nota: 5\/10 \| Acertos: 50% \| Conceito: Regular/);
  h.fechar();
});

test("corretor: PDF sem biblioteca carregada avisa", async () => {
  const h = await abrirCorretor({ semChave: true });
  delete h.window.jspdf;
  await corrigir4(h);
  await h.clicar(/Gerar PDF/);
  assert.equal(ultimoToast(h), "A biblioteca de PDF não carregou. Verifique a internet.");
  h.fechar();
});

test("corretor: abrir correção do histórico e excluir (com confirmação)", async () => {
  const h = await abrirCorretor({ confirmar: false });
  await h.clicar(h.document.querySelector('[title="Abrir"]'));
  assert.match(h.texto(), /Resultado da Correção/);
  assert.match(h.texto(), /10\.0\s*NOTA/);
  assert.match(h.texto(), /Data: 01\/03\/2026/);
  await h.clicar(/Corrigir outra/);
  await h.clicar(h.document.querySelector('[onclick="App.excluirCorrecao(\'C9\')"]'));
  assert.ok(h.store.doc("correcoes", "C9"), "cancelar mantém");
  h.respostaConfirm(true);
  await h.clicar(h.document.querySelector('[onclick="App.excluirCorrecao(\'C9\')"]'));
  await h.estabilizar();
  assert.equal(h.store.doc("correcoes", "C9"), undefined);
  assert.ok(h.store.doc("correcoes", "CX"), "correção de outro professor intacta");
  assert.equal(ultimoToast(h), "Correção excluída.");
  h.fechar();
});

test("corretor automático: sem foto ou sem chave mostra o erro adequado", async () => {
  const h = await abrirCorretor({ semChave: true });
  await h.clicar(/Usar modo automático/);
  ["A", "B", "C", "D", "A"].forEach((x, i) => h.App.setGabaritoResp(i, x));
  await h.clicar(/Próximo: foto/);
  assert.match(h.texto(), /Configure a chave da IA/);
  await h.App.corrigirProva(); await h.estabilizar();
  assert.match(h.texto(), /Adicione a foto da prova para o modo automático/);
  h.fechar();
});
