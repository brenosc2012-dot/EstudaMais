// Faixa de erro de JavaScript na tela, falha de leitura de arquivo no material de apoio,
// edição da resposta de lacuna no editor, diagnóstico de escopo (console) e sons de comemoração.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const { abrirProfessor, ultimoToast, F } = require("../support/professor-helpers");
const A = require("../support/aluno-helpers");

/** A faixa escreve no console.error (o harness registra como erro): capturamos à parte. */
function silenciarConsoleErro(h) {
  const msgs = [];
  h.window.console.error = (...a) => msgs.push(a.join(" "));
  return msgs;
}

test("erro de JS não tratado vira faixa vermelha com a mensagem; 'Fechar' remove; um 2º erro reaproveita a faixa", async () => {
  const h = await abrirApp({ seed: F.banco(), local: F.LOCAL_BASE });
  try {
    const log = silenciarConsoleErro(h);
    const erro = new h.window.Error("quebrou no clique");
    h.window.dispatchEvent(new h.window.ErrorEvent("error", { message: "quebrou no clique", error: erro }));
    let box = h.document.getElementById("erroJs");
    assert.ok(box, "faixa criada");
    assert.match(box.textContent, /⚠️ Erro no app \(erro\): .*quebrou no clique/);
    assert.match(log.join("|"), /\[EstudaMais\] erro/);
    // erro sem objeto Error (só mensagem)
    h.window.dispatchEvent(new h.window.ErrorEvent("error", { message: "só mensagem" }));
    assert.equal(h.document.querySelectorAll("#erroJs").length, 1, "uma faixa só");
    assert.match(h.document.getElementById("erroJs").textContent, /só mensagem/);
    const fechar = [...h.document.querySelectorAll("#erroJs button")].find(b => b.textContent === "Fechar");
    fechar.click();
    assert.equal(h.document.getElementById("erroJs"), null);
  } finally { h.fechar(); }
});

test("promessa rejeitada sem tratamento também aparece na faixa (origem 'promessa')", async () => {
  const h = await abrirApp({ seed: F.banco(), local: F.LOCAL_BASE });
  try {
    silenciarConsoleErro(h);
    const ev = new h.window.Event("unhandledrejection");
    ev.reason = new h.window.Error("gravação recusada");
    h.window.dispatchEvent(ev);
    assert.match(h.document.getElementById("erroJs").textContent, /Erro no app \(promessa\): .*gravação recusada/);
    const ev2 = new h.window.Event("unhandledrejection");
    ev2.reason = "motivo em texto";
    h.window.dispatchEvent(ev2);
    assert.match(h.document.getElementById("erroJs").textContent, /\(promessa\): motivo em texto/);
  } finally { h.fechar(); }
});

test("material: falha do FileReader ao ler um TXT avisa, não anexa e não quebra; os outros arquivos seguem", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  try {
    const Real = h.window.FileReader;
    h.window.FileReader = class extends Real {
      readAsText(f) {
        if (f.name === "quebrado.txt") { Promise.resolve().then(() => { if (this.onerror) this.onerror(); }); return; }
        return super.readAsText(f);
      }
    };
    const input = h.document.querySelector("input[type=file]");
    const arqs = [new h.window.File(["x"], "quebrado.txt", { type: "text/plain" }), new h.window.File(["Conteúdo bom"], "bom.txt", { type: "text/plain" })];
    Object.defineProperty(input, "files", { value: arqs, configurable: true });
    input.dispatchEvent(new h.window.Event("change"));
    await h.estabilizar(60);
    // a falha de leitura é tratada como "sem texto extraível" (a mensagem orienta o professor)
    assert.match(h.toasts.join("|"), /Não foi possível extrair texto de "quebrado\.txt"/);
    const nomes = [...h.document.querySelectorAll("#materialLista .t-lesson-row .t")].map(e => e.textContent);
    assert.deepEqual(nomes, ["bom.txt"]);
    assert.doesNotMatch(h.toasts.join("|"), /✅ .*lido/, "com falha em algum arquivo não anuncia sucesso geral");
    assert.deepEqual(h.errosJs(), []);
  } finally { h.fechar(); }
});

test("editor: editar a resposta de uma lacuna (setExResp) e salvar grava a nova resposta", async () => {
  const lic = F.licao({ exercicios: [F.fill(1, "juntar")] });
  const h = await abrirProfessor({ seed: F.banco({ licoes: { L1: lic } }), editar: "L1" });
  try {
    const campo = h.document.querySelector('input[placeholder="Resposta esperada"]');
    assert.equal(campo.value, "juntar");
    campo.value = "somar";
    campo.dispatchEvent(new h.window.Event("input", { bubbles: true }));
    await h.estabilizar();
    assert.equal(h.document.querySelector('input[placeholder="Resposta esperada"]'), campo, "digitar não re-renderiza (mantém o foco)");
    await h.clicar(/Salvar lição/);
    assert.equal(h.store.doc("licoes", "L1").exercicios[0].resposta, "somar");
    // resposta apagada: a validação impede salvar
    h.App.editLesson("L1"); await h.estabilizar();
    h.App.setExResp(0, "   ");
    await h.clicar(/Salvar lição/);
    assert.match(ultimoToast(h), /Exercício 1: informe a resposta/);
    assert.equal(h.store.doc("licoes", "L1").exercicios[0].resposta, "somar");
  } finally { h.fechar(); }
});

test("App.diagLicoes(): relata no console, lição a lição, se está visível para o aluno e por quê", async () => {
  const seed = F.banco({ licoes: { L2: F.licao({ titulo: "Da turma B", turma: "B" }) } });
  const h = await A.entrarAluno({ seedCompleto: seed });
  try {
    const log = [];
    h.window.console.log = (...a) => log.push(a.map(x => String(x)).join(" "));
    h.App.diagLicoes();
    const t = log.join("\n");
    assert.match(t, /=== Aluno: Ana Souza \| ano: "3º ano" \| turma: "A"/);
    assert.match(t, /\[mat\] Somas simples/);
    assert.match(t, /\[mat\] Da turma B/);
    assert.match(t, /Lição turma: "B" \| Aluno turma: "A"/);
    assert.match(t, /1 de 2|visíveis: 1|1\/2/, "resumo: 1 de 2 visíveis");
    assert.deepEqual(h.errosJs(), []);
  } finally { h.fechar(); }
  // sem aluno logado
  const h2 = await abrirApp({ seed: F.banco(), local: F.LOCAL_BASE });
  try {
    const log = [];
    h2.window.console.log = (...a) => log.push(a.join(" "));
    h2.App.diagLicoes();
    assert.match(log.join("\n"), /Nenhum aluno logado/);
  } finally { h2.fechar(); }
});

/** Registra os osciladores criados pelo Web Audio (tipo de onda + frequência de cada nota). */
function gravarNotas(h) {
  const notas = [];
  const P = h.window.AudioContext.prototype, orig = P.createOscillator;
  P.createOscillator = function () { const o = orig.call(this); notas.push(o); return o; };
  return () => notas.map(o => o.type + ":" + o.frequency.value);
}
test("conclusão sem subir de nível nem ganhar medalha toca a 'celebração simples'; com som desligado, silêncio", async () => {
  const todas = ["first", "l5", "l10", "l15", "perfeito", "xp100", "xp500", "streak3", "streak7", "nivel5", "explorador", "contador"];
  const aluno = F.aluno({ medalhas: todas });
  aluno.disciplinas.mat = { xp: 0, nivel: 1, licoesConcluidas: [] };
  const h = await A.iniciarClassico({ seedCompleto: F.banco({ alunos: { a1: aluno }, licoes: { L1: F.licao({ exercicios: [F.mc(1)] }) } }) });
  try {
    const notas = gravarNotas(h);
    await A.acertar(h);
    await h.clicar(/Continuar/);
    assert.match(h.texto(), /Lição concluída|Parabéns|XP/);
    const tocadas = notas();
    // celebrate(): 523 → 659 → 784 → 1047 em onda triangular (level() usa 'square', unlock() 'sine')
    assert.deepEqual(tocadas.slice(-4), ["triangle:523", "triangle:659", "triangle:784", "triangle:1047"]);
  } finally { h.fechar(); }

  const semSom = F.aluno({ medalhas: todas, som: false });
  const h2 = await A.iniciarClassico({ seedCompleto: F.banco({ alunos: { a1: semSom }, licoes: { L1: F.licao({ exercicios: [F.mc(1)] }) } }) });
  try {
    const notas = gravarNotas(h2);
    await A.acertar(h2);
    await h2.clicar(/Continuar/);
    assert.equal(notas().length, 0, "som desligado no perfil: nenhuma nota");
  } finally { h2.fechar(); }
});
