// CONTRATO com a OpenAI: o que o app ENVIA (URL, headers, corpo) e como ele trata cada
// forma de RESPOSTA (SSE, JSON de proxy antigo, erros HTTP, rede, timeout, corte, corpo
// inválido, vazio). Roda o app inteiro (index.html real) via o botão "Testar conexão"
// do painel Admin, com a OpenAI falsa e relógio falso — sem esperas reais.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp, criarIAFake } = require("../support/app");
const { carregar } = require("./carregar-app");
const F = require("../support/fixtures");

async function painelAdmin(config, ...fila) {
  const ia = criarIAFake().fila(...fila);
  const h = await abrirApp({ seed: F.banco({ config: { openai: config } }), local: F.LOCAL_BASE, ia });
  await h.clicar(/Administrador/);
  await h.preencher("admSenha", "admin123");
  await h.clicar(/^Entrar$/);
  return h;
}
async function testar(h) { await h.clicar(/Testar conexão com a IA/); }

test("modo direto: POST à OpenAI com Bearer, modelo gpt-4o-mini, stream e mensagem do usuário", async () => {
  const h = await painelAdmin({ apiKey: "sk-direta", proxyUrl: "" }, "ok");
  await testar(h);
  const c = h.ia.chamadas[0];
  assert.equal(c.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(c.headers.Authorization, "Bearer sk-direta");
  assert.equal(c.headers["Content-Type"], "application/json");
  assert.deepEqual(c.body, { model: "gpt-4o-mini", messages: [{ role: "user", content: "Responda apenas: ok" }], temperature: 0.7, stream: true });
  assert.ok(h.toasts.some(t => /Conexão OK/.test(t)));
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

test("modo proxy: chama a URL do proxy e NUNCA envia a chave", async () => {
  const h = await painelAdmin({ apiKey: "sk-que-nao-deve-sair", proxyUrl: "https://meu-proxy.workers.dev" }, "ok");
  await testar(h);
  const c = h.ia.chamadas[0];
  assert.equal(c.url, "https://meu-proxy.workers.dev");
  assert.equal(c.headers.Authorization, undefined);
  assert.doesNotMatch(JSON.stringify(c), /sk-que-nao-deve-sair/);
  h.fechar();
});

test("sem chave nem proxy: não chama a IA e pede configuração", async () => {
  const h = await painelAdmin({ apiKey: "", proxyUrl: "" });
  await testar(h);
  assert.equal(h.ia.chamadas.length, 0);
  assert.match(h.texto(), /Informe a URL do proxy ou a chave antes de testar/);
  h.fechar();
});

test("resposta JSON (proxy antigo que não repassa stream) é aceita", async () => {
  const h = await painelAdmin({ apiKey: "sk", proxyUrl: "" }, { json: true, texto: "ok" });
  await testar(h);
  assert.ok(h.toasts.some(t => /Conexão OK/.test(t)));
  h.fechar();
});

const ERROS = [
  ["401 com mensagem da OpenAI", { status: 401, mensagem: "Incorrect API key provided" }, /Erro 401 — Incorrect API key provided/],
  ["401 sem corpo", { status: 401 }, /Erro 401 — Chave da API inválida\./],
  ["429 limite de uso", { status: 429 }, /Erro 429 — Limite de uso atingido \(ou conta sem créditos\)/],
  ["500 erro interno", { status: 500 }, /Erro 500/],
  ["503 indisponível", { status: 503, mensagem: "Service Unavailable" }, /Erro 503 — Service Unavailable/],
  ["falha de rede/CORS", { rede: true }, /Falha na chamada à OpenAI\. Verifique, nesta ordem: \(1\) a chave/],
  ["corte no meio do streaming", { corte: "parcial" }, /A resposta da IA foi interrompida no meio/],
  ["corpo 200 que não é JSON", { corpoInvalido: true }, /A resposta da IA chegou incompleta/],
  ["streaming vazio", "", /A IA respondeu vazio/],
];
for (const [nome, item, esperado] of ERROS) {
  test(`erro tratado: ${nome}`, async () => {
    const h = await painelAdmin({ apiKey: "sk", proxyUrl: "" }, item);
    await testar(h);
    assert.match(h.texto(), esperado);
    assert.equal(h.toasts.some(t => /Conexão OK/.test(t)), false);
    assert.deepEqual(h.errosJs(), [], "erro de IA não vira erro de JavaScript");
    h.fechar();
  });
}

test("timeout inicial: sem resposta em 15s o app aborta e mostra 'demorou demais'", async () => {
  const h = await painelAdmin({ apiKey: "sk", proxyUrl: "" }, { pendurar: true });
  await testar(h);
  await h.avancar(14000);
  assert.doesNotMatch(h.texto(), /demorou demais/, "ainda dentro do prazo");
  await h.avancar(1500);
  assert.match(h.texto(), /A IA demorou demais para responder/);
  h.fechar();
});

test("cabeçalhos chegam mas nenhum byte: o timeout inicial continua valendo (não fica pendurado)", async () => {
  const h = await painelAdmin({ apiKey: "sk", proxyUrl: "" }, { silencio: true });
  await testar(h);
  await h.avancar(16000);
  assert.match(h.texto(), /demorou demais/);
  h.fechar();
});

test("clique repetido no teste não dispara 2 chamadas (botão some durante o teste)", async () => {
  const h = await painelAdmin({ apiKey: "sk", proxyUrl: "" }, { pendurar: true });
  await testar(h);
  assert.equal(h.tem(/Testar conexão/), false);
  assert.equal(h.ia.chamadas.length, 1);
  await h.avancar(16000);
  h.fechar();
});

test("conteúdo inseguro devolvido pela IA no resumo é recusado; texto válido é exibido como texto", async () => {
  // ao abrir a lição o app também pré-gera explicações em segundo plano: responde pelo tipo de prompt
  const ia = criarIAFake().padrao(ch => (/TEXTO DE ESTUDO/.test(ch.prompt)
    ? F.RESUMO_DIDATICO + "\n## Oi <img src=x onerror=\"window.__xss=1\">\n<script>window.__xss=2</script> **ok**" : "Explicação."));
  const h = await abrirApp({ seed: F.banco(), local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" }, ia });
  h.App.openSubject("mat"); await h.estabilizar();
  h.App.openLesson("L1"); await h.estabilizar();
  assert.doesNotMatch(h.texto(), /<img src=x onerror=/, "recusado pela validação (tags HTML)");
  assert.equal(h.document.querySelector("#app img[src=x]"), null);
  assert.equal(h.document.querySelector("#app script"), null);
  assert.equal(h.window.__xss, undefined);
  h.fechar();
  // texto válido: marcação ** vira negrito, o resto é escapado
  const ia2 = criarIAFake().padrao(ch => (/TEXTO DE ESTUDO/.test(ch.prompt) ? F.RESUMO_DIDATICO + "\nCompare: 2 < 3 & 4 > 1." : "Explicação."));
  const h2 = await abrirApp({ seed: F.banco(), local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" }, ia: ia2 });
  h2.App.openSubject("mat"); await h2.estabilizar();
  h2.App.openLesson("L1"); await h2.estabilizar();
  assert.ok(h2.html().includes("2 &lt; 3 &amp; 4 &gt; 1"));
  assert.ok(h2.document.querySelector("#app .resumo-box b"), "negrito permitido");
  h2.fechar();
});

// ---------------- lerStreamIA isolado (formato SSE e inatividade) ----------------
function leitorDe(pedacos) {
  const enc = new TextEncoder();
  let i = 0;
  return { getReader: () => ({ read: async () => (i < pedacos.length ? { done: false, value: enc.encode(pedacos[i++]) } : { done: true }) }) };
}
function ctxStream() {
  const intervals = [], timeouts = [];
  let agora = 0;
  const c = carregar({
    funcoes: ["lerStreamIA"], constantes: ["IA_INATIVIDADE_MS", "IA_TETO_TOTAL_MS"],
    stubs: {
      TextDecoder: require("util").TextDecoder,
      setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
      clearInterval: () => {}, setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; }, clearTimeout: () => {},
      Date: { now: () => agora },
    },
  });
  return { c, intervals, timeouts, avancar: ms => { agora += ms; } };
}

test("lerStreamIA: junta deltas, ignora keep-alive ':' , linhas sem 'data:', JSON parcial e [DONE]; linhas quebradas entre pedaços", async () => {
  const { c } = ctxStream();
  const progresso = [];
  let primeiro = 0;
  const d = t => "data: " + JSON.stringify({ choices: [{ delta: { content: t } }] }) + "\n";
  const txt = await c.lerStreamIA({ body: leitorDe([
    ": keep-alive\n", "event: ping\n", d("Olá"), d(", ").slice(0, 10), d(", ").slice(10), "data: {quebrado\n",
    "data: " + JSON.stringify({ choices: [{ message: { content: "mundo" } }] }) + "\n", "data: [DONE]\n",
  ]) }, null, { onProgresso: t => progresso.push(t), aoPrimeiroByte: () => primeiro++ });
  assert.equal(txt, "Olá, mundo");
  assert.equal(primeiro, 1, "aoPrimeiroByte chamado uma vez");
  assert.deepEqual(progresso, ["Olá", "Olá, ", "Olá, mundo"]);
});

test("lerStreamIA: vigia aborta após 30s sem bytes e há teto total de 5 min", async () => {
  const { c, intervals, timeouts, avancar } = ctxStream();
  let abortado = 0;
  let liberar;
  const reader = { read: () => new Promise(r => { liberar = r; }) };
  const p = c.lerStreamIA({ body: { getReader: () => reader } }, { abort: () => { abortado++; liberar({ done: true }); } }, {});
  assert.equal(timeouts[0].ms, 300000, "teto total");
  avancar(29000); intervals[0].fn(); assert.equal(abortado, 0);
  avancar(2000); intervals[0].fn(); assert.equal(abortado, 1, "inatividade > 30s aborta");
  assert.equal(await p, "");
  // inatividade customizada
  const s2 = ctxStream();
  s2.c.lerStreamIA({ body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }, { abort: () => { abortado++; } }, { inatividadeMs: 5000 });
  s2.avancar(5001); s2.intervals[0].fn();
  assert.equal(abortado, 2);
});

test("mensagemErroIA: timeout, rede (3 variações de navegador), mensagem própria e erro sem mensagem", () => {
  const c = carregar({ funcoes: ["mensagemErroIA"] });
  assert.equal(c.mensagemErroIA(new Error("timeout")), "A IA demorou demais para responder. Tente novamente.");
  for (const m of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) assert.match(c.mensagemErroIA(new Error(m)), /Falha na chamada à OpenAI/);
  assert.equal(c.mensagemErroIA(new Error("Erro 429 — x")), "Erro 429 — x");
  assert.equal(c.mensagemErroIA(null), "Falha ao contatar a IA.");
  assert.equal(c.mensagemErroIA({}), "Falha ao contatar a IA.");
});
