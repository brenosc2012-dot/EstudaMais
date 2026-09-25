// Painel de Administrador: senha, salvar configuração da IA, testar conexão, config legada.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, storePronto, F } = require("../support/auth-helpers");

async function entrarAdmin(h, senha) {
  await h.clicar(/Administrador/);
  await h.preencher("admSenha", senha);
  await h.clicar(/^Entrar$/);
}

test("admin: senha errada é recusada; certa abre a configuração", async t => {
  const h = await abrir(t);
  await entrarAdmin(h, "chute");
  assert.match(h.texto(), /Senha de administrador incorreta/);
  assert.doesNotMatch(h.texto(), /Configuração da IA/);
  await h.preencher("admSenha", "admin123");
  await h.clicar(/^Entrar$/);
  assert.match(h.texto(), /Configuração da IA/);
  assert.match(h.texto(), /chave direta/, "status reflete a chave carregada do Firestore");
});

test("admin: Enter no campo de senha também entra", async t => {
  const h = await abrir(t);
  await h.clicar(/Administrador/);
  await h.avancar(100); // o app liga o onkeydown 80ms depois de renderizar
  const campo = h.campo("admSenha");
  campo.value = "admin123";
  campo.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Enter" }));
  await h.estabilizar();
  assert.match(h.texto(), /Configuração da IA/);
});

test("admin: sair e voltar exige a senha de novo", async t => {
  const h = await abrir(t);
  await entrarAdmin(h, "admin123");
  await h.clicar(/^Voltar$/);
  await h.clicar(/Administrador/);
  assert.ok(h.campo("admSenha"));
  assert.doesNotMatch(h.texto(), /Configuração da IA/);
});

test("admin: salvar configuração grava config/openai (proxy + chave) e atualiza o status", async t => {
  const h = await abrir(t);
  await entrarAdmin(h, "admin123");
  await h.preencher("admProxy", "  https://meu-proxy.workers.dev  ");
  await h.preencher("admKey", " sk-nova ");
  await h.clicar(/Salvar configuração/);
  const cfg = h.store.doc("config", "openai");
  assert.equal(cfg.proxyUrl, "https://meu-proxy.workers.dev");
  assert.equal(cfg.apiKey, "sk-nova");
  assert.ok(cfg.atualizadoEm && cfg.atualizadoEm.toMillis);
  assert.ok(h.toasts.some(x => /Configuração salva/.test(x)));
  assert.match(h.texto(), /via proxy/);
});

test("admin: falha ao gravar mostra erro e mantém a config anterior", async t => {
  const h = await abrir(t);
  await entrarAdmin(h, "admin123");
  h.store.falhar({ op: "set", colecao: "config" });
  await h.preencher("admKey", "sk-outra");
  await h.clicar(/Salvar configuração/);
  assert.match(h.texto(), /Erro ao salvar/);
  assert.equal(h.store.doc("config", "openai").apiKey, "sk-teste-NAO-REAL");
});

test("admin: testar conexão — sucesso", async t => {
  const h = await abrir(t);
  h.ia.fila("ok");
  await entrarAdmin(h, "admin123");
  await h.clicar(/Testar conexão/);
  assert.ok(h.toasts.some(x => /Conexão OK/.test(x)));
  assert.equal(h.ia.chamadas.length, 1);
  assert.equal(h.ia.chamadas[0].headers.Authorization, "Bearer sk-teste-NAO-REAL");
});

test("admin: testar conexão — 401, 429, rede, timeout e sem configuração", async t => {
  const casos = [
    [{ status: 401 }, /Erro 401.*Chave da API inválida/],
    [{ status: 429 }, /Erro 429.*Limite de uso/],
    [{ status: 503, mensagem: "indisponível" }, /Erro 503.*indisponível/],
    [{ rede: true }, /Falha na chamada à OpenAI/],
  ];
  for (const [item, re] of casos) {
    const h = await abrir(t);
    h.ia.fila(item);
    await entrarAdmin(h, "admin123");
    await h.clicar(/Testar conexão/);
    assert.match(h.texto(), re);
  }
  // timeout: a IA nunca responde → 15s depois aborta
  const h = await abrir(t);
  h.ia.fila({ pendurar: true });
  await entrarAdmin(h, "admin123");
  await h.clicar(/Testar conexão/);
  assert.ok(h.tem(/Aguarde/), "loading enquanto espera");
  await h.avancar(15500);
  assert.match(h.texto(), /demorou demais/);
  // sem configuração
  const h2 = await abrir(t, { extra: { config: { openai: { apiKey: "", proxyUrl: "" } } } });
  await entrarAdmin(h2, "admin123");
  await h2.clicar(/Testar conexão/);
  assert.match(h2.texto(), /Informe a URL do proxy ou a chave/);
  assert.equal(h2.ia.chamadas.length, 0);
});

test("admin: config legada config/app.openaiApiKey é carregada no boot", async t => {
  const seed = F.banco(); delete seed.config.openai; seed.config.app = { openaiApiKey: " sk-legado " };
  const h = await abrir(t, { store: storePronto(seed) });
  await entrarAdmin(h, "admin123");
  assert.match(h.texto(), /chave direta/);
  assert.equal(h.campo("admKey").value, "sk-legado");
});

test("admin: sem config nenhuma → status 'não configurada'; falha ao ler config não impede o boot", async t => {
  const seed = F.banco(); delete seed.config;
  const fb = storePronto(seed);
  fb.__store.falhar({ op: "get", colecao: "config" });
  const h = await abrir(t, { store: fb });
  assert.match(h.texto(), /Sou Aluno/);
  await entrarAdmin(h, "admin123");
  assert.match(h.texto(), /não configurada/);
});
