// Service worker (PWA): cache do app shell, limpeza de caches antigos, network-first na
// navegação com fallback offline e stale-while-revalidate nos assets. Executa o sw.js real
// num vm com self/caches/fetch/clients falsos.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { pathToFileURL } = require("url");

const SW_PATH = path.join(__dirname, "..", "..", "sw.js");
const SCRIPT = new vm.Script(fs.readFileSync(SW_PATH, "utf8"), { filename: pathToFileURL(SW_PATH).href });
const ORIGEM = "https://app.exemplo";
const tick = () => new Promise(r => setImmediate(r));

function ambiente(opts) {
  opts = opts || {};
  const caches = new Map(); // nome → Map(chave → Response)
  const ouvintes = {};
  const log = { skipWaiting: 0, claim: 0, addAll: [], fetches: [] };
  const chave = r => (typeof r === "string" ? new URL(r, ORIGEM + "/").href : r.url);
  const cacheApi = {
    open: async nome => {
      if (!caches.has(nome)) caches.set(nome, new Map());
      const c = caches.get(nome);
      return {
        addAll: async lista => { log.addAll.push(...lista); if (opts.addAllFalha) throw new Error("offline"); lista.forEach(u => c.set(chave(u), new Response("asset " + u))); },
        put: async (req, resp) => { c.set(chave(req), resp); },
      };
    },
    keys: async () => [...caches.keys()],
    delete: async nome => caches.delete(nome),
    match: async req => { for (const c of caches.values()) { const r = c.get(chave(req)); if (r) return r.clone(); } return undefined; },
  };
  const self = {
    location: { origin: ORIGEM },
    addEventListener: (tipo, fn) => { ouvintes[tipo] = fn; },
    skipWaiting: () => { log.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { log.claim++; return Promise.resolve(); } },
  };
  const fetch = async req => { log.fetches.push(req.url); if (opts.rede === "falha") throw new TypeError("offline"); return opts.resposta ? opts.resposta(req) : new Response("rede " + req.url, { status: 200 }); };
  const ctx = vm.createContext({ self, caches: cacheApi, fetch, URL, Response, Promise, console });
  SCRIPT.runInContext(ctx);
  function evento(tipo, extra) {
    const esperas = [];
    let resposta;
    const e = Object.assign({ waitUntil: p => esperas.push(p), respondWith: p => { resposta = p; } }, extra);
    ouvintes[tipo](e);
    return { concluido: Promise.all(esperas), resposta: () => resposta, respondeu: () => resposta !== undefined };
  }
  return { caches, log, evento, cacheApi };
}
const req = (url, extra) => Object.assign({ url: new URL(url, ORIGEM + "/").href, method: "GET", mode: "cors" }, extra);

test("install: guarda o app shell no cache e chama skipWaiting", async () => {
  const a = ambiente();
  await a.evento("install").concluido;
  assert.deepEqual(a.log.addAll, ["./", "./index.html", "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png", "./icon-180.png"]);
  assert.ok(a.caches.has("estudamais-v2"));
  assert.equal(a.log.skipWaiting, 1);
});

test("install: falha ao baixar assets (offline) não quebra a instalação", async () => {
  const a = ambiente({ addAllFalha: true });
  await a.evento("install").concluido; // não rejeita
  assert.equal(a.log.skipWaiting, 0);
});

test("todos os ASSETS do cache existem no projeto", () => {
  const src = fs.readFileSync(SW_PATH, "utf8");
  const lista = JSON.parse(src.match(/const ASSETS = (\[[^\]]*\])/)[1]);
  for (const a of lista.filter(x => x !== "./")) assert.ok(fs.existsSync(path.join(__dirname, "..", "..", a)), a);
});

test("activate: apaga caches de versões antigas, mantém o atual e assume os clientes", async () => {
  const a = ambiente();
  await a.cacheApi.open("estudamais-v1"); await a.cacheApi.open("estudamais-v2"); await a.cacheApi.open("outro");
  await a.evento("activate").concluido;
  assert.deepEqual([...a.caches.keys()], ["estudamais-v2"]);
  assert.equal(a.log.claim, 1);
});

test("fetch: ignora métodos diferentes de GET, URL inválida e outras origens (Firebase/CDN/OpenAI)", () => {
  const a = ambiente();
  assert.equal(a.evento("fetch", { request: req("/index.html", { method: "POST" }) }).respondeu(), false);
  assert.equal(a.evento("fetch", { request: { url: "::inválida::", method: "GET" } }).respondeu(), false);
  for (const u of ["https://firestore.googleapis.com/x", "https://api.openai.com/v1/chat/completions", "https://cdnjs.cloudflare.com/lib.js"])
    assert.equal(a.evento("fetch", { request: req(u) }).respondeu(), false, u);
});

test("navegação online: network-first e atualiza a cópia do index.html no cache", async () => {
  const a = ambiente({ resposta: () => new Response("<html>nova</html>") });
  const ev = a.evento("fetch", { request: req("/", { mode: "navigate" }) });
  const r = await ev.resposta();
  assert.equal(await r.text(), "<html>nova</html>");
  await tick(); await tick();
  const guardado = await a.cacheApi.match("./index.html");
  assert.equal(await guardado.text(), "<html>nova</html>");
});

test("navegação offline: cai no index.html em cache; sem ele, no './'", async () => {
  const a = ambiente({ rede: "falha" });
  await a.evento("install").concluido; // (addAll falso grava "asset ./index.html")
  const r = await a.evento("fetch", { request: req("/qualquer", { mode: "navigate" }) }).resposta();
  assert.equal(await r.text(), "asset ./index.html");
  const b = ambiente({ rede: "falha" });
  (await b.cacheApi.open("estudamais-v2")).put("./", new Response("raiz"));
  const r2 = await b.evento("fetch", { request: req("/x", { mode: "navigate" }) }).resposta();
  assert.equal(await r2.text(), "raiz");
});

test("assets: stale-while-revalidate — serve o cache na hora e atualiza em segundo plano", async () => {
  const a = ambiente({ resposta: () => { const r = new Response("icone novo", { status: 200 }); Object.defineProperty(r, "type", { value: "basic" }); return r; } });
  (await a.cacheApi.open("estudamais-v2")).put(req("/icon.svg"), new Response("icone velho"));
  const r = await a.evento("fetch", { request: req("/icon.svg") }).resposta();
  assert.equal(await r.text(), "icone velho", "resposta imediata do cache");
  await tick(); await tick();
  assert.equal(await (await a.cacheApi.match(req("/icon.svg"))).text(), "icone novo", "cache revalidado");
});

test("assets: sem cache busca na rede; resposta não-200/opaca não é guardada; offline sem cache → undefined", async () => {
  const a = ambiente({ resposta: () => new Response("erro", { status: 404 }) });
  const r = await a.evento("fetch", { request: req("/manifest.json") }).resposta();
  assert.equal(r.status, 404);
  await tick();
  assert.equal(await a.cacheApi.match(req("/manifest.json")), undefined);
  const b = ambiente({ rede: "falha" });
  assert.equal(await b.evento("fetch", { request: req("/manifest.json") }).resposta(), undefined);
});
