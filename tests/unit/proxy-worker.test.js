// BACKEND: proxy da OpenAI (proxy/cloudflare-worker.js). Testa o Worker real com
// Request/Response do Node e o fetch da OpenAI simulado (nenhuma chamada externa).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

const URL_WORKER = pathToFileURL(path.join(__dirname, "..", "..", "proxy", "cloudflare-worker.js")).href;
const ENV = { OPENAI_API_KEY: "sk-servidor" };

let worker;
test.before(async () => { worker = (await import(URL_WORKER)).default; });

// substitui o fetch global só durante `fn` e registra as chamadas
async function comFetch(impl, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init) => { chamadas.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null }); return impl(url, init); };
  try { return await fn(chamadas); } finally { globalThis.fetch = original; }
}
const post = (corpo, extra) => new Request("https://proxy.exemplo/", Object.assign({ method: "POST", body: typeof corpo === "string" ? corpo : JSON.stringify(corpo), headers: { "Content-Type": "application/json" } }, extra));
const jsonOk = obj => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });

test("OPTIONS (preflight) → 204 com CORS completo", async () => {
  const r = await worker.fetch(new Request("https://proxy.exemplo/", { method: "OPTIONS" }), ENV);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(r.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(r.headers.get("access-control-allow-headers"), "Content-Type");
  assert.equal(r.headers.get("access-control-max-age"), "86400");
});

test("método diferente de POST → 405 com CORS", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const r = await worker.fetch(new Request("https://proxy.exemplo/", { method }), ENV);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await r.json(), { error: { message: "Use POST." } });
  }
});

test("sem OPENAI_API_KEY configurada → 500 e não chama a OpenAI", async () => {
  await comFetch(() => jsonOk({}), async chamadas => {
    const r = await worker.fetch(post({ messages: [] }), {});
    assert.equal(r.status, 500);
    assert.match((await r.json()).error.message, /OPENAI_API_KEY não configurada/);
    assert.equal(chamadas.length, 0);
  });
});

test("corpo que não é JSON → 400", async () => {
  await comFetch(() => jsonOk({}), async chamadas => {
    const r = await worker.fetch(post("{isso não é json"), ENV);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: { message: "JSON inválido." } });
    assert.equal(chamadas.length, 0);
  });
});

test("repassa SÓ model/messages/temperature, injeta a chave do servidor e devolve a resposta com CORS", async () => {
  await comFetch(() => jsonOk({ choices: [{ message: { content: "oi" } }] }), async chamadas => {
    const r = await worker.fetch(post({ model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }], temperature: 0.2, max_tokens: 99999, tools: ["abuso"], stream: "sim" }), ENV);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    assert.equal(r.headers.get("content-type"), "application/json");
    assert.deepEqual(await r.json(), { choices: [{ message: { content: "oi" } }] });
    const c = chamadas[0];
    assert.equal(c.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(c.init.headers.Authorization, "Bearer sk-servidor");
    assert.deepEqual(c.body, { model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }], temperature: 0.2 }, "stream só com true literal; campos extras descartados");
  });
});

test("campos com tipo errado recebem os padrões (modelo, mensagens, temperatura)", async () => {
  await comFetch(() => jsonOk({}), async chamadas => {
    await worker.fetch(post({ model: 123, messages: "texto", temperature: "quente" }), ENV);
    assert.deepEqual(chamadas[0].body, { model: "gpt-4o-mini", messages: [], temperature: 0.7 });
  });
});

test("streaming: repassa o corpo SSE sem bufferizar, com event-stream e CORS", async () => {
  const sse = "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\ndata: [DONE]\n\n";
  await comFetch(() => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }), async chamadas => {
    const r = await worker.fetch(post({ messages: [], stream: true }), ENV);
    assert.equal(chamadas[0].body.stream, true);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "no-cache");
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    assert.equal(await r.text(), sse);
  });
});

test("erro da OpenAI (401/429) é repassado com o status original E com CORS (inclusive em stream)", async () => {
  for (const [status, stream] of [[401, false], [429, true]]) {
    await comFetch(() => new Response(JSON.stringify({ error: { message: "x" + status } }), { status }), async () => {
      const r = await worker.fetch(post({ messages: [], stream }), ENV);
      assert.equal(r.status, status);
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
      assert.equal(r.headers.get("content-type"), "application/json");
      assert.deepEqual(await r.json(), { error: { message: "x" + status } });
    });
  }
});

test("falha de rede ao contatar a OpenAI → 502 com a mensagem", async () => {
  await comFetch(() => { throw new TypeError("getaddrinfo ENOTFOUND"); }, async () => {
    const r = await worker.fetch(post({ messages: [] }), ENV);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error.message, /Falha ao contatar a OpenAI: getaddrinfo ENOTFOUND/);
  });
});

test("ALLOWED_ORIGIN restringe a origem em todas as respostas", async () => {
  const env = Object.assign({ ALLOWED_ORIGIN: "https://brenosc2012-dot.github.io" }, ENV);
  const pre = await worker.fetch(new Request("https://proxy.exemplo/", { method: "OPTIONS" }), env);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://brenosc2012-dot.github.io");
  assert.equal(pre.headers.get("vary"), "Origin");
  await comFetch(() => jsonOk({}), async () => {
    const r = await worker.fetch(post({ messages: [] }), env);
    assert.equal(r.headers.get("access-control-allow-origin"), "https://brenosc2012-dot.github.io");
  });
});

test("a chave do servidor nunca aparece na resposta ao navegador", async () => {
  await comFetch(() => jsonOk({ ok: true }), async () => {
    const r = await worker.fetch(post({ messages: [] }), ENV);
    const tudo = JSON.stringify([...r.headers]) + await r.text();
    assert.doesNotMatch(tudo, /sk-servidor/);
  });
});
