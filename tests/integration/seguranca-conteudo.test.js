// Segurança de conteúdo: renderização escapada (XSS) de dados do banco e da IA, ausência
// da chave da IA no front do aluno, proxy sem Authorization, entradas longas/malformadas.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, loginAluno, elementosPerigosos, F } = require("../support/auth-helpers");

const PAYLOADS = [
  "<script>window.__xss=1</script>",
  "<img src=x onerror=\"window.__xss=1\">",
  "\"><svg onload=\"window.__xss=1\">",
  "'><iframe src=javascript:alert(1)></iframe>",
];
const P = PAYLOADS.join(" ");

function semXss(h, onde) {
  assert.deepEqual(elementosPerigosos(h), [], `${onde}: elemento perigoso criado`);
  assert.equal(h.window.__xss, undefined, `${onde}: script executou`);
}

test("XSS: título/texto/enunciado/opções de lição e nome do aluno são exibidos escapados (aluno)", async t => {
  const extra = {
    alunos: { a1: F.aluno({ nome: "Ana " + PAYLOADS[1] }) },
    licoes: { L1: F.licao({ titulo: "Somas " + P, conteudo: "Texto " + P,
      exercicios: [F.mc(1, { enunciado: "Pergunta " + P, opcoes: [PAYLOADS[0], PAYLOADS[1], PAYLOADS[2], "ok"] }), F.fill(2, "x", { enunciado: "Lacuna " + PAYLOADS[2] + " ___" })] }) },
    config: { openai: { apiKey: "", proxyUrl: "" } }, // sem IA → estudo mostra o texto do professor
  };
  const h = await abrir(t, { extra, sessao: { tipo: "aluno", id: "a1" } });
  semXss(h, "home");
  assert.ok(h.texto().includes("<img src=x"), "o texto aparece literalmente");
  h.App.openSubject("mat"); await h.estabilizar(); semXss(h, "lista de lições");
  assert.ok(h.texto().includes("<script>window.__xss=1</script>"));
  await h.App.openLesson("L1"); await h.estabilizar(); semXss(h, "estudo (fallback)");
  h.App.iniciarModoClassico(); await h.estabilizar(); semXss(h, "exercício");
  h.App.selectOpt(1); h.App.checkAnswer(); await h.avancar(2000); semXss(h, "feedback/explicação");
  h.App.openProfile(); await h.estabilizar(); semXss(h, "perfil");
});

test("XSS: resumo e explicação vindos da IA são escapados (inclusive dentro de **negrito** e ## título)", async t => {
  const h = await abrir(t, { sessao: { tipo: "aluno", id: "a1" } });
  // abrir a lição também pré-gera as explicações em 2º plano: responde conforme o prompt
  h.ia.padrao(c => /TEXTO DE ESTUDO/.test(c.prompt)
    ? `## Título ${PAYLOADS[1]}\nParágrafo **${PAYLOADS[2]}**\n- tópico ${PAYLOADS[0]}`
    : `Explicação ${P}`);
  h.App.openSubject("mat"); await h.estabilizar();
  await h.App.openLesson("L1"); await h.estabilizar();
  semXss(h, "resumo IA");
  // texto da IA com tags HTML é recusado pela validação: cai no conteúdo do professor e não é gravado
  assert.ok(!h.texto().includes("<img src=x"));
  assert.equal((h.store.dados.licoes_geradas || {}).L1, undefined);
  h.App.iniciarModoClassico(); await h.estabilizar();
  h.App.selectOpt(1); h.App.checkAnswer(); await h.avancar(2000);
  assert.match(h.texto(), /Explicação/);
  semXss(h, "explicação IA");
});

test("XSS: painel do professor (lista, editor com value=\"...\", rendimento) escapa conteúdo", async t => {
  const extra = {
    alunos: { a1: F.aluno({ nome: "Ana " + P }) },
    licoes: { L1: F.licao({ titulo: PAYLOADS[2], conteudo: P, exercicios: [F.mc(1, { enunciado: PAYLOADS[2], opcoes: [PAYLOADS[2], "b", "c", "d"] })] }) },
  };
  const h = await abrir(t, { extra, sessao: { tipo: "professor", id: "p1" } });
  semXss(h, "lista do professor");
  h.App.editLesson("L1"); await h.estabilizar();
  semXss(h, "editor");
  assert.equal(h.campo("lTitulo").value, PAYLOADS[2], "value do input preserva o texto sem quebrar o atributo");
  h.App.previewLesson(); await h.estabilizar(); semXss(h, "pré-visualização");
  h.App.fecharPreview(); h.App.teacherTab("progresso"); await h.estabilizar();
  semXss(h, "rendimento");
});

test("chave da IA não aparece no DOM nem no armazenamento local do aluno", async t => {
  const extra = { config: { openai: { apiKey: "sk-SEGREDO-123456", proxyUrl: "" } } };
  const h = await abrir(t, { extra, sessao: { tipo: "aluno", id: "a1" } });
  h.ia.padrao("Conteúdo de estudo.");
  const vazou = () => {
    const html = h.document.documentElement.outerHTML;
    const armaz = JSON.stringify(Object.assign({}, h.window.localStorage)) + JSON.stringify(Object.assign({}, h.window.sessionStorage));
    return html.includes("sk-SEGREDO") || armaz.includes("sk-SEGREDO");
  };
  assert.equal(vazou(), false, "home");
  h.App.openSubject("mat"); await h.estabilizar(); assert.equal(vazou(), false, "lições");
  await h.App.openLesson("L1"); await h.estabilizar(); assert.equal(vazou(), false, "estudo");
  h.App.iniciarModoClassico(); await h.estabilizar(); assert.equal(vazou(), false, "exercício");
  h.App.openProfile(); await h.estabilizar(); assert.equal(vazou(), false, "perfil");
});

test("chave da IA não aparece no painel do professor", async t => {
  const extra = { config: { openai: { apiKey: "sk-SEGREDO-123456", proxyUrl: "" } } };
  const h = await abrir(t, { extra, sessao: { tipo: "professor", id: "p1" } });
  for (const tab of ["licoes", "novo", "progresso", "premios", "conta"]) {
    h.App.teacherTab(tab); await h.estabilizar();
    assert.ok(!h.document.documentElement.outerHTML.includes("sk-SEGREDO"), tab);
  }
});

test("com proxy configurado: a chamada vai ao proxy SEM header Authorization e sem chave no corpo", async t => {
  const extra = { config: { openai: { apiKey: "sk-SEGREDO-123456", proxyUrl: "https://proxy.exemplo.workers.dev" } } };
  const h = await abrir(t, { extra, sessao: { tipo: "aluno", id: "a1" } });
  h.ia.padrao("Resumo.");
  h.App.openSubject("mat"); await h.estabilizar();
  await h.App.openLesson("L1"); await h.estabilizar();
  // resumo + pré-geração das explicações: TODAS as chamadas passam pelo proxy
  assert.ok(h.ia.chamadas.length >= 1);
  for (const c of h.ia.chamadas) {
    assert.equal(c.url, "https://proxy.exemplo.workers.dev");
    assert.equal(c.headers.Authorization, undefined);
    assert.ok(!JSON.stringify(c).includes("sk-SEGREDO"));
    assert.equal(Object.keys(c.body).sort().join(), "messages,model,stream,temperature");
  }
});

test("modo direto (sem proxy): a chave vai só no header Authorization da OpenAI (risco documentado)", async t => {
  const h = await abrir(t, { sessao: { tipo: "aluno", id: "a1" } });
  h.ia.padrao("Resumo.");
  h.App.openSubject("mat"); await h.estabilizar();
  await h.App.openLesson("L1"); await h.estabilizar();
  for (const c of h.ia.chamadas) {
    assert.equal(c.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(c.headers.Authorization, "Bearer sk-teste-NAO-REAL");
    assert.ok(!JSON.stringify(c.body).includes("sk-teste"));
  }
});

test("entradas muito longas (10k caracteres) no login/cadastro não quebram", async t => {
  const longo = "A".repeat(10000);
  const h = await abrir(t);
  await loginAluno(h, longo, longo);
  assert.match(h.texto(), /Aluno não encontrado/);
  await h.clicar(/Ainda não tenho conta/);
  await h.preencher("caNome", longo); await h.preencher("caIdade", "9"); await h.preencher("caAno", "3º ano");
  await h.preencher("caTurma", "A"); await h.preencher("caSenha", longo);
  await h.clicar(/Cadastrar e entrar/);
  assert.deepEqual(h.errosJs(), []);
  const novo = Object.values(h.store.colecao("alunos")).find(a => a.nome === longo);
  assert.ok(novo, "conta criada (o app não limita o tamanho do nome — ver relatório)");
  assert.equal(novo.senha, F.hash(longo));
});

test("dados malformados no banco (aluno sem campos, lição sem exercícios/título) não quebram a UI", async t => {
  const extra = {
    alunos: { a1: { nome: "Ana Souza", nomeNorm: "ana souza", ano: "3º ano", turma: "A", nivel: "fund1", senha: F.hash("senha123"), xpTotal: "abc", disciplinas: null, medalhas: "x" } },
    licoes: { L1: { disciplina: "mat", ano: "3º ano", turma: "A" }, L2: F.licao({ titulo: "T".repeat(10000), exercicios: null }) },
  };
  const h = await abrir(t, { extra });
  await loginAluno(h, "Ana Souza", "senha123");
  assert.match(h.texto(), /Olá, Ana Souza/);
  h.App.openSubject("mat"); await h.estabilizar();
  h.App.openProfile(); await h.estabilizar();
  assert.deepEqual(h.errosJs(), []);
});

test("caracteres especiais/unicode no nome e senha funcionam no cadastro e no login", async t => {
  const h = await abrir(t);
  await h.clicar(/Sou Aluno/); await h.clicar(/Ainda não tenho conta/);
  await h.preencher("caNome", "Zoë O'Brien-Ñúñez 🚀"); await h.preencher("caIdade", "10"); await h.preencher("caAno", "3º ano");
  await h.preencher("caTurma", "A"); await h.preencher("caSenha", "ç@$%\"'<>🔑");
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Zoë O'Brien-Ñúñez 🚀/);
  h.App.logout(); await h.estabilizar();
  await loginAluno(h, "zoe o'brien-nunez 🚀", "ç@$%\"'<>🔑");
  assert.match(h.texto(), /Olá, Zoë/);
});
