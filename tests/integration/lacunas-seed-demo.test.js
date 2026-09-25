// Primeiro acesso (semeadura das lições de exemplo) e Modo Demo do PROFESSOR / saída do demo.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const F = require("../support/fixtures");

const DEMO_URL = "http://localhost/index.html?demo=true";

test("1º acesso: banco sem lições e sem a flag → semeia os exemplos UMA vez e grava a flag", async () => {
  const seed = F.banco(); delete seed.licoes;
  const h = await abrirApp({ seed, local: {} });
  try {
    const licoes = Object.values(h.store.dados.licoes || {});
    assert.ok(licoes.length >= 20, `semeou ${licoes.length} lições de exemplo`);
    const disciplinas = new Set(licoes.map(l => l.disciplina));
    ["mat", "por", "art", "fil", "red", "geo", "his", "cie", "ing"].forEach(d => assert.ok(disciplinas.has(d), "exemplo de " + d));
    licoes.forEach(l => {
      assert.ok(l.titulo && l.conteudo, "título e conteúdo");
      assert.ok(Array.isArray(l.exercicios) && l.exercicios.length > 0, "tem exercícios");
      assert.ok(l.criadoEm && typeof l.criadoEm.toMillis === "function", "criadoEm é timestamp do servidor");
    });
    assert.equal(h.window.localStorage.getItem("estudamais_seed_firestore"), "1");
    const escritas = h.store.escritas("licoes").length;
    assert.equal(escritas, licoes.length);
    // recarregar não duplica (a flag e o banco não vazio impedem)
    const h2 = await h.recarregar();
    try {
      assert.equal(Object.keys(h2.store.dados.licoes).length, licoes.length);
      assert.equal(h2.store.escritas("licoes").length, escritas);
    } finally { h2.fechar(); }
  } finally { h.fechar(); }
});

test("1º acesso: com a flag já gravada neste navegador, banco vazio NÃO é semeado", async () => {
  const seed = F.banco(); delete seed.licoes;
  const h = await abrirApp({ seed, local: F.LOCAL_BASE });
  try {
    assert.equal(Object.keys(h.store.dados.licoes || {}).length, 0);
    assert.equal(h.store.escritas("licoes").length, 0);
    assert.match(h.texto(), /Sou Aluno/, "boot normal na landing");
  } finally { h.fechar(); }
});

test("1º acesso: falha ao semear não trava o boot (flag gravada, app abre)", async () => {
  const seed = F.banco(); delete seed.licoes;
  const h = await abrirApp({ seed, local: {}, semBoot: true });
  // o fake aplica a falha na 1ª escrita; o boot já está em andamento → só verificamos o desfecho
  h.store.falhar({ op: "add", colecao: "licoes", vezes: 1 });
  try {
    await h.aguardar(() => !/Carregando/.test(h.texto()), { msg: "boot" });
    assert.match(h.texto(), /Sou Aluno/);
    assert.equal(Object.keys(h.store.dados.licoes || {}).length, 0, "a 1ª gravação falhou: nada semeado");
    assert.equal(h.window.localStorage.getItem("estudamais_seed_firestore"), "1");
  } finally { h.fechar(); }
});

test("professor demo: painel com todas as disciplinas, rendimento e corretor fictícios, nenhuma escrita", async () => {
  const h = await abrirApp({ url: DEMO_URL, seed: F.banco(), local: F.LOCAL_BASE });
  try {
    await h.clicar(/Entrar como Professor Demo/);
    assert.match(h.texto(), /Prof\. Demo/);
    assert.match(h.texto(), /MODO DEMO/);
    await h.clicar(/Rendi/);
    const t = h.texto();
    assert.match(t, /Dados fictícios para demonstração — 5º ano, Turma A/);
    assert.match(t, /5\s*Alunos ativos/);
    assert.match(t, /82%\s*Média acertos/);
    assert.match(t, /📷 3\s*Provas corrigidas/, "histórico fictício do corretor entra nas métricas");
    assert.match(t, /Ana Silva.*85% acertos.*320 XP/);
    assert.match(t, /Pedro Oliveira/);
    assert.doesNotMatch(t, /Ana Souza/, "aluno real do banco não aparece no demo");
    await h.clicar(/Corretor/);
    assert.match(h.texto(), /Maria Santos.*9\.0\/10 • Excelente/);
    // correção manual no demo salva só na sessão (não no Firestore)
    h.App.setNumQuestoes(2);
    await h.clicar(/Próximo: informar gabarito/);
    ["A", "B"].forEach((x, i) => h.App.setGabaritoResp(i, x));
    await h.clicar(/Próximo: respostas/);
    ["A", "C"].forEach((x, i) => h.App.setRespAluno(i, x));
    await h.clicar(/✅ Corrigir/);
    assert.match(h.texto(), /5\.0\s*NOTA/);
    h.App.salvarCorrecao(); await h.estabilizar();
    assert.match(h.toasts.join("|"), /salvo localmente \(modo demo\)/);
    const salvas = JSON.parse(h.window.sessionStorage.getItem("estudamais_demo_correcoes"));
    assert.equal(salvas.length, 1);
    assert.equal(h.store.log.length, 0, "nenhuma escrita no Firestore no modo demo");
  } finally { h.fechar(); }
});

test("professor demo: corretor automático sem chave mostra resultado demonstrativo (sem IA)", async () => {
  const seed = F.banco(); delete seed.config;
  const h = await abrirApp({ url: DEMO_URL, seed, local: F.LOCAL_BASE });
  try {
    await h.clicar(/Entrar como Professor Demo/);
    await h.clicar(/Corretor/);
    h.App.setNumQuestoes(5);
    h.App.setCorretorModo("auto");
    ["A", "B", "C", "D", "A"].forEach((x, i) => h.App.setGabaritoResp(i, x));
    h.App.corretorAvancarGabarito(); await h.estabilizar();
    assert.match(h.texto(), /Sem chave da IA agora: será exibido um resultado de demonstração/);
    // injeta uma foto já comprimida (a compressão é coberta em lacunas-corretor-foto)
    class Img { set src(v) { Promise.resolve().then(() => { this.width = 10; this.height = 10; this.onload && this.onload(); }); } }
    h.window.Image = Img;
    h.App.onSelecionarFotoProva({ files: [new h.window.File(["x"], "p.jpg", { type: "image/jpeg" })], value: "" });
    await h.aguardar(() => /1\/3 foto/.test(h.texto()));
    await h.clicar(/Ler marcações com IA/);
    assert.match(h.texto(), /Analisando a imagem/);
    await h.avancar(2600);
    const t = h.texto();
    assert.match(t, /Resultado demonstrativo — dados simulados/);
    assert.match(t, /8\.0\s*NOTA/);
    assert.match(t, /Ótimo\s*CONCEITO/);
    assert.equal(h.ia.chamadas.length, 0);
    assert.equal(h.store.log.length, 0);
  } finally { h.fechar(); }
});

test("sair do demo: 'Criar conta' e 'Já tenho conta' gravam o destino e o boot real abre cadastro/login", async () => {
  for (const [acao, destino, tela] of [["demoCriarConta", "cadastroAluno", /Criar conta de Aluno/], ["demoLogin", "loginAluno", /Entrar como Aluno/]]) {
    const h = await abrirApp({ url: DEMO_URL, seed: F.banco(), local: F.LOCAL_BASE });
    let h2;
    try {
      h.App[acao](); await h.estabilizar();
      assert.equal(h.window.sessionStorage.getItem("demoDestino"), destino);
      assert.equal(h.window.sessionStorage.getItem("modoDemo"), null, "flag do demo removida");
      // a navegação (location.replace) não existe no jsdom: simulamos o recarregamento sem ?demo
      h2 = await h.recarregar({ url: "http://localhost/index.html" });
      assert.match(h2.texto(), tela);
      assert.equal(h2.window.sessionStorage.getItem("demoDestino"), null, "destino consumido uma vez");
      if (destino === "cadastroAluno") assert.match(h2.toasts.join("|"), /Gostou do EstudaMais\? Crie sua conta grátis!/);
      assert.equal(h2.store.log.length, 0);
    } finally { if (h2) h2.fechar(); else h.fechar(); }
  }
});

test("sair do demo: destino inválido no sessionStorage é ignorado (landing)", async () => {
  const h = await abrirApp({ seed: F.banco(), local: F.LOCAL_BASE, session: { demoDestino: "teacher" } });
  try {
    assert.match(h.texto(), /Sou Aluno/);
    assert.equal(h.window.sessionStorage.getItem("demoDestino"), null);
  } finally { h.fechar(); }
});
