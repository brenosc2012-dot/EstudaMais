// Autenticação: landing, login/cadastro de aluno e professor, sessão, logout, recarregar.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, storePronto, loginAluno, loginProf, sessao, F } = require("../support/auth-helpers");

// ---------------- landing / navegação ----------------
test("sem sessão: boot abre a landing com as três entradas", async t => {
  const h = await abrir(t);
  assert.match(h.texto(), /EstudaMais/);
  for (const b of [/Sou Aluno/, /Sou Professor/, /Administrador/]) assert.ok(h.tem(b));
  assert.equal(sessao(h), null);
  assert.deepEqual(h.errosJs(), []);
});

test("navegação: landing → login aluno → cadastro → login → voltar", async t => {
  const h = await abrir(t);
  await h.clicar(/Sou Aluno/);
  assert.match(h.texto(), /Entrar como Aluno/);
  await h.clicar(/Ainda não tenho conta/);
  assert.match(h.texto(), /Criar conta de Aluno/);
  await h.clicar(/Já tenho conta/);
  assert.match(h.texto(), /Entrar como Aluno/);
  await h.clicar(/^←$/);
  assert.match(h.texto(), /Sou Professor/);
  await h.clicar(/Sou Professor/);
  await h.clicar(/Ainda não tenho conta/);
  assert.match(h.texto(), /Criar conta de Professor/);
});

// ---------------- login do aluno ----------------
test("login aluno: sucesso grava sessão e abre a home", async t => {
  const h = await abrir(t);
  await loginAluno(h, "Ana Souza", "senha123");
  assert.match(h.texto(), /Olá, Ana Souza/);
  assert.deepEqual(sessao(h), { tipo: "aluno", id: "a1" });
  const cache = JSON.parse(h.window.localStorage.getItem("estudamais_aluno_cache_v2"));
  assert.equal(cache.id, "a1");
});

test("login aluno: nome tolerante a acento, maiúsculas e espaços", async t => {
  const h = await abrir(t, { extra: { alunos: { a2: F.aluno({ nome: "João Açaí" }) } } });
  await loginAluno(h, "   JOAO acai  ", "senha123");
  assert.match(h.texto(), /Olá, João Açaí/);
  assert.equal(sessao(h).id, "a2");
});

test("login aluno: campos vazios mostram erro sem consultar o banco", async t => {
  const h = await abrir(t);
  await h.clicar(/Sou Aluno/);
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Informe nome e senha/);
  await h.preencher("laNome", "Ana Souza");
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Informe nome e senha/);
  assert.equal(sessao(h), null);
});

test("login aluno: aluno inexistente e senha incorreta", async t => {
  const h = await abrir(t);
  await loginAluno(h, "Fulano de Tal", "senha123");
  assert.match(h.texto(), /Aluno não encontrado/);
  await h.preencher("laNome", "Ana Souza");
  await h.preencher("laSenha", "errada");
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Senha incorreta/);
  assert.equal(sessao(h), null);
});

test("login aluno: homônimos — entra na conta cuja senha confere", async t => {
  const h = await abrir(t, { extra: { alunos: { a2: F.aluno({ senha: F.hash("outra") }) } } });
  await loginAluno(h, "Ana Souza", "outra");
  assert.equal(sessao(h).id, "a2");
});

test("login aluno: conta legada sem nomeNorm é achada pelo nome e recebe backfill", async t => {
  const legado = F.aluno({ nome: "Pedro Álvares" }); delete legado.nomeNorm;
  const h = await abrir(t, { extra: { alunos: { leg: legado } } });
  await loginAluno(h, "pedro alvares", "senha123"); // só a varredura tolerante acha
  assert.equal(sessao(h).id, "leg");
  assert.equal(h.store.doc("alunos", "leg").nomeNorm, "pedro alvares");
});

test("login aluno: falha de rede no Firestore mostra erro de conexão", async t => {
  const h = await abrir(t);
  h.store.falhar({ op: "get", colecao: "alunos" });
  await loginAluno(h, "Ana Souza", "senha123");
  assert.match(h.texto(), /Erro ao entrar\. Verifique a conexão/);
  assert.equal(sessao(h), null);
  assert.ok(h.tem(/^Entrar$/), "botão volta a ficar disponível");
});

test("login aluno: botão mostra 'Aguarde...' desabilitado durante a consulta", async t => {
  const h = await abrir(t);
  await h.clicar(/Sou Aluno/);
  await h.preencher("laNome", "Ana Souza"); await h.preencher("laSenha", "senha123");
  const liberar = h.store.segurar({ op: "get", colecao: "alunos" });
  h.botao(/^Entrar$/).click();
  const aguarde = h.botao(/Aguarde/);
  assert.equal(aguarde.disabled, true);
  assert.equal(h.tem(/^Entrar$/), false);
  liberar();
  await h.estabilizar();
  assert.match(h.texto(), /Olá, Ana Souza/);
});

// ---------------- cadastro do aluno ----------------
async function preencherCadastroAluno(h, d) {
  await h.clicar(/Sou Aluno/);
  await h.clicar(/Ainda não tenho conta/);
  if (d.nivel) await h.preencher("caNivel", d.nivel);
  if (d.nome != null) await h.preencher("caNome", d.nome);
  if (d.idade != null) await h.preencher("caIdade", d.idade);
  if (d.ano) await h.preencher("caAno", d.ano);
  if (d.turma) await h.preencher("caTurma", d.turma);
  if (d.senha != null) await h.preencher("caSenha", d.senha);
}

test("cadastro aluno: cria conta com hash da senha e gamificação zerada, e entra", async t => {
  const h = await abrir(t);
  await preencherCadastroAluno(h, { nome: "Bia Lima", idade: "9", nivel: "fund1", ano: "4º ano", turma: "B", senha: "segredo" });
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Olá, Bia Lima/);
  const s = sessao(h);
  const doc = h.store.doc("alunos", s.id);
  assert.equal(doc.nome, "Bia Lima"); assert.equal(doc.nomeNorm, "bia lima");
  assert.equal(doc.idade, 9); assert.equal(doc.ano, "4º ano"); assert.equal(doc.turma, "B"); assert.equal(doc.nivel, "fund1");
  assert.equal(doc.senha, F.hash("segredo"));
  assert.ok(!JSON.stringify(doc).includes("\"segredo\""), "senha em claro não pode ser gravada");
  assert.equal(doc.xpTotal, 0);
  assert.ok(doc.criadoEm && typeof doc.criadoEm.toMillis === "function");
});

test("cadastro aluno: validações de campos obrigatórios e ano", async t => {
  const h = await abrir(t);
  await preencherCadastroAluno(h, { nome: "", senha: "" });
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Preencha todos os campos/);
  await h.preencher("caNome", "Bia"); await h.preencher("caIdade", "abc"); await h.preencher("caTurma", "A"); await h.preencher("caSenha", "x1");
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Preencha todos os campos/, "idade não numérica");
  await h.preencher("caIdade", "9");
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Selecione o ano/);
  assert.equal(Object.keys(h.store.colecao("alunos")).length, 1, "nenhuma conta nova");
  assert.equal(h.campo("caNome").value, "Bia", "o que foi digitado é preservado");
});

test("cadastro aluno: trocar o nível reseta o ano e mostra os anos do nível", async t => {
  const h = await abrir(t);
  await preencherCadastroAluno(h, { nome: "Caio", nivel: "medio" });
  const anos = [...h.campo("caAno").options].map(o => o.value).filter(Boolean);
  assert.deepEqual(anos, ["1º ano EM", "2º ano EM", "3º ano EM"]);
  assert.equal(h.campo("caAno").value, "");
  assert.equal(h.campo("caNome").value, "Caio");
});

test("cadastro aluno: erro ao gravar mostra mensagem e não cria sessão", async t => {
  const h = await abrir(t);
  await preencherCadastroAluno(h, { nome: "Bia", idade: "9", ano: "3º ano", turma: "A", senha: "x" });
  h.store.falhar({ op: "add", colecao: "alunos" });
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Não foi possível cadastrar/);
  assert.equal(sessao(h), null);
});

test("cadastro aluno: clique duplo não duplica a conta (botão vira 'Aguarde' desabilitado)", async t => {
  const h = await abrir(t);
  await preencherCadastroAluno(h, { nome: "Bia", idade: "9", ano: "3º ano", turma: "A", senha: "x" });
  const liberar = h.store.segurar({ op: "add", colecao: "alunos" });
  h.botao(/Cadastrar e entrar/).click();
  assert.equal(h.tem(/Cadastrar e entrar/), false);
  const aguarde = h.botao(/Aguarde/);
  assert.equal(aguarde.disabled, true);
  aguarde.click(); // clique em botão desabilitado não dispara nada
  liberar();
  await h.estabilizar();
  const nomes = Object.values(h.store.colecao("alunos")).map(a => a.nome);
  assert.equal(nomes.filter(n => n === "Bia").length, 1);
});

// ---------------- professor ----------------
test("login professor: sucesso (e-mail com maiúsculas/espaços) abre o painel", async t => {
  const h = await abrir(t);
  await loginProf(h, "  CARLOS@Escola.com ", "prof123");
  assert.deepEqual(sessao(h), { tipo: "professor", id: "p1" });
  assert.ok(h.tem(/Nova|lição/i));
});

test("login professor: vazio, inexistente, senha errada e falha de rede", async t => {
  const h = await abrir(t);
  await h.clicar(/Sou Professor/);
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Informe e-mail e senha/);
  await h.preencher("lpEmail", "ninguem@x.com"); await h.preencher("lpSenha", "a");
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Professor não encontrado/);
  await h.preencher("lpEmail", "carlos@escola.com"); await h.preencher("lpSenha", "errada");
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Senha incorreta/);
  h.store.falhar({ op: "get", colecao: "professores" });
  await h.preencher("lpEmail", "carlos@escola.com"); await h.preencher("lpSenha", "prof123");
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Erro ao entrar/);
  assert.equal(sessao(h), null);
});

async function abrirCadastroProf(h, d) {
  await h.clicar(/Sou Professor/);
  await h.clicar(/Ainda não tenho conta/);
  if (d.nome != null) await h.preencher("cpNome", d.nome);
  if (d.email != null) await h.preencher("cpEmail", d.email);
  if (d.senha != null) await h.preencher("cpSenha", d.senha);
}

test("cadastro professor: validações em ordem (dados, turma, ano, disciplina)", async t => {
  const h = await abrir(t);
  await abrirCadastroProf(h, {});
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Preencha nome, e-mail e senha/);
  await h.preencher("cpNome", "Rita"); await h.preencher("cpEmail", "rita@x.com"); await h.preencher("cpSenha", "abc");
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /ao menos uma turma/);
  await h.preencher("cpNome", "Rita"); await h.preencher("cpEmail", "rita@x.com"); await h.preencher("cpSenha", "abc");
  await h.clicar(/Turma B/);
  assert.equal(h.campo("cpNome").value, "Rita", "toggles preservam o formulário");
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /ao menos um ano/);
  await h.clicar(/^5º ano$/);
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /ao menos uma disciplina/);
  assert.equal(Object.keys(h.store.colecao("professores")).length, 1);
});

test("cadastro professor: sucesso grava e-mail normalizado, hash e escopo; toggle desmarca", async t => {
  const h = await abrir(t);
  await abrirCadastroProf(h, { nome: "Rita", email: " RITA@X.com ", senha: "abc" });
  await h.clicar(/Turma C/); await h.clicar(/Turma A/); await h.clicar(/✓ Turma C/); // desmarca C
  await h.clicar(/^5º ano$/);
  await h.clicar(/Geografia/);
  await h.clicar(/Cadastrar e entrar/);
  const s = sessao(h);
  assert.equal(s.tipo, "professor");
  const p = h.store.doc("professores", s.id);
  assert.equal(p.email, "rita@x.com");
  assert.equal(p.senha, F.hash("abc"));
  assert.equal(JSON.stringify([p.turmas, p.anos, p.disciplinas]), JSON.stringify([["A"], ["5º ano"], ["geo"]]));
});

// REGRESSÃO (defeito encontrado): no cadastro de ALUNO o que foi digitado sobrevive a um
// erro de validação; no de PROFESSOR, submitCadastroProf não sincroniza o Form antes do
// render(), então nome/e-mail/senha são apagados a cada erro de validação.
test("cadastro professor: erro de validação preserva nome, e-mail e senha digitados", async t => {
  const h = await abrir(t);
  await abrirCadastroProf(h, { nome: "Rita", email: "rita@x.com", senha: "abc" });
  await h.clicar(/Cadastrar e entrar/); // falta turma
  assert.match(h.texto(), /ao menos uma turma/);
  assert.equal(h.campo("cpNome").value, "Rita");
  assert.equal(h.campo("cpEmail").value, "rita@x.com");
  assert.equal(h.campo("cpSenha").value, "abc");
});

test("cadastro professor: e-mail já cadastrado é recusado", async t => {
  const h = await abrir(t);
  await abrirCadastroProf(h, { nome: "Outro", email: "Carlos@escola.com", senha: "abc" });
  await h.clicar(/Turma A/); await h.clicar(/^3º ano$/); await h.clicar(/Matemática/);
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Já existe uma conta com este e-mail/);
  assert.equal(Object.keys(h.store.colecao("professores")).length, 1);
});

test("cadastro professor: falha de gravação mostra erro", async t => {
  const h = await abrir(t);
  await abrirCadastroProf(h, { nome: "Rita", email: "rita@x.com", senha: "abc" });
  await h.clicar(/Turma A/); await h.clicar(/^3º ano$/); await h.clicar(/Matemática/);
  h.store.falhar({ op: "add", colecao: "professores" });
  await h.clicar(/Cadastrar e entrar/);
  assert.match(h.texto(), /Não foi possível cadastrar/);
  assert.equal(sessao(h), null);
});

// ---------------- sessão / boot ----------------
test("sessão válida de aluno: boot vai direto para a home", async t => {
  const h = await abrir(t, { sessao: { tipo: "aluno", id: "a1" } });
  assert.match(h.texto(), /Olá, Ana Souza/);
});

test("sessão válida de professor: boot vai direto para o painel", async t => {
  const h = await abrir(t, { sessao: { tipo: "professor", id: "p1" } });
  assert.ok(h.tem(/Sair|Nova lição|Lições/i));
  assert.doesNotMatch(h.texto(), /Sou Aluno/);
});

test("sessão para conta apagada: volta à landing e limpa a sessão", async t => {
  for (const s of [{ tipo: "aluno", id: "sumiu" }, { tipo: "professor", id: "sumiu" }, { tipo: "desconhecido", id: "a1" }]) {
    const h = await abrir(t, { sessao: s });
    assert.match(h.texto(), /Sou Aluno/, JSON.stringify(s));
    assert.equal(sessao(h), null);
  }
});

test("sessão corrompida no localStorage: trata como ausente", async t => {
  const h = await abrir(t, { local: { estudamais_sessao_v2: "{isto não é json" } });
  assert.match(h.texto(), /Sou Aluno/);
  assert.deepEqual(h.errosJs(), []);
});

test("offline ao ler o aluno: usa o cache local e abre a home", async t => {
  const fb = storePronto();
  fb.__store.falhar({ op: "get", colecao: "alunos" });
  const cache = { id: "a1", doc: Object.assign(F.aluno(), { id: "a1", nome: "Ana do Cache" }) };
  const h = await abrir(t, { store: fb, sessao: { tipo: "aluno", id: "a1" }, local: { estudamais_aluno_cache_v2: cache } });
  assert.match(h.texto(), /Olá, Ana do Cache/);
});

test("offline ao ler o aluno sem cache (ou cache de outro id): landing", async t => {
  const fb = storePronto();
  fb.__store.falhar({ op: "get", colecao: "alunos" });
  const h = await abrir(t, { store: fb, sessao: { tipo: "aluno", id: "a1" }, local: { estudamais_aluno_cache_v2: { id: "outro", doc: F.aluno() } } });
  assert.match(h.texto(), /Sou Aluno/);
});

test("boot sem conexão (lições): tela 'Sem conexão' e 'Tentar novamente' recupera", async t => {
  const fb = storePronto();
  fb.__store.offline = true;
  const h = await abrir(t, { store: fb, sessao: { tipo: "aluno", id: "a1" } });
  assert.match(h.texto(), /Sem conexão/);
  fb.__store.offline = false;
  await h.clicar(/Tentar novamente/);
  assert.match(h.texto(), /Olá, Ana Souza/);
});

test("logout: limpa sessão e cache do aluno e volta à landing; recarregar continua deslogado", async t => {
  const h = await abrir(t, { sessao: { tipo: "aluno", id: "a1" } });
  h.App.logout();
  await h.estabilizar();
  assert.match(h.texto(), /Sou Aluno/);
  assert.equal(sessao(h), null);
  assert.equal(h.window.localStorage.getItem("estudamais_aluno_cache_v2"), null);
  const h2 = await h.recarregar();
  t.after(() => h2.fechar());
  assert.match(h2.texto(), /Sou Aluno/);
});

test("logout pelo botão do perfil do aluno", async t => {
  const h = await abrir(t, { sessao: { tipo: "aluno", id: "a1" } });
  h.App.openProfile(); await h.estabilizar();
  await h.clicar(/Sair/);
  assert.match(h.texto(), /Sou Aluno/);
  assert.equal(sessao(h), null);
});

test("recarregar a página mantém o login (aluno e professor)", async t => {
  const h = await abrir(t);
  await loginAluno(h, "Ana Souza", "senha123");
  const h2 = await h.recarregar();
  t.after(() => h2.fechar());
  assert.match(h2.texto(), /Olá, Ana Souza/);
  h2.App.logout(); await h2.estabilizar();
  await loginProf(h2, "carlos@escola.com", "prof123");
  const h3 = await h2.recarregar();
  t.after(() => h3.fechar());
  assert.equal(sessao(h3).tipo, "professor");
  assert.doesNotMatch(h3.texto(), /Sou Aluno/);
});

test("mostrar/ocultar senha alterna o tipo do campo", async t => {
  const h = await abrir(t);
  await h.clicar(/Sou Aluno/);
  assert.equal(h.campo("laSenha").type, "password");
  await h.clicar(/Mostrar senha/);
  assert.equal(h.campo("laSenha").type, "text");
});
