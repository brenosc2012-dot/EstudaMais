// Base dos testes E2E: intercepta Firebase (troca pelo banco falso em memória, persistido
// no localStorage da página para sobreviver ao recarregar), CDNs e OpenAI.
// Uso:
//   const { test, expect } = require("./base");
//   test("...", async ({ app, ia }) => { ia.fila(RESUMO); await app.abrir({ seed, sessao }); ... });
"use strict";
const fs = require("fs");
const path = require("path");
const base = require("@playwright/test");

const FAKE_FIREBASE = fs.readFileSync(path.join(__dirname, "..", "support", "fake-firebase.js"), "utf8");
const BOOT_FAKE = `\n;window.firebase = window.__criarFirebaseFake({ persistirEm: window.localStorage, chave: "__fakeFirestore", seed: window.__FAKE_SEED__ });`;

const test = base.test.extend({
  // Fila de respostas da OpenAI falsa. Itens: "texto" | {status, mensagem} | {rede:true} | {pendurar:true}
  ia: async ({}, use) => {
    const fila = [], chamadas = [];
    await use({
      fila(...itens) { fila.push(...itens); return this; },
      chamadas,
      prompts: () => chamadas.map(c => (c.messages || []).map(m => typeof m.content === "string" ? m.content : "").join("\n")),
      _proximo: () => (fila.length ? fila.shift() : "Resposta padrão da IA."),
    });
  },
  app: async ({ page, ia }, use) => {
    const errosPagina = [];
    page.on("pageerror", e => errosPagina.push(e.message));
    // (no Playwright a rota registrada POR ÚLTIMO tem precedência: a específica vem depois)
    await page.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: "text/javascript", body: "/* firestore compat: incluído no fake */" }));
    await page.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, r => r.fulfill({ contentType: "text/javascript", body: FAKE_FIREBASE + BOOT_FAKE }));
    await page.route(/cdnjs\.cloudflare\.com/, r => r.fulfill({ contentType: "text/javascript", body: "/* biblioteca de CDN desativada no E2E */" }));
    await page.route(/api\.openai\.com|workers\.dev/, async route => {
      let body = {};
      try { body = JSON.parse(route.request().postData() || "{}"); } catch (_) { /* corpo inválido */ }
      ia.chamadas.push(body);
      let item = ia._proximo();
      if (typeof item === "string") item = { texto: item };
      if (item.rede) return route.abort("failed");
      if (item.pendurar) return; // nunca responde: o app aborta por timeout
      if (item.status) return route.fulfill({ status: item.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: { message: item.mensagem || "" } }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ choices: [{ message: { content: item.texto } }] }) });
    });
    await use({
      page,
      errosPagina,
      /** Abre o app com banco/localStorage iniciais (só na 1ª carga; recarregar mantém o estado). */
      async abrir({ seed, local, sessao, url } = {}) {
        const loc = Object.assign({ estudamais_seed_firestore: "1" }, local || {});
        if (sessao) loc.estudamais_sessao_v2 = JSON.stringify(sessao);
        await page.addInitScript(({ seed, loc }) => {
          if (!window.localStorage.getItem("__fakeFirestore")) {
            window.__FAKE_SEED__ = seed;
            for (const k in loc) window.localStorage.setItem(k, loc[k]);
          }
        }, { seed: seed || {}, loc });
        await page.goto(url || "/index.html");
        await base.expect(page.locator("#app")).not.toContainText("Carregando", { timeout: 10000 });
      },
      /** Lê um documento do banco falso da página. */
      async doc(colecao, id) {
        return page.evaluate(([c, i]) => { const d = window.firebase.__store.dados[c]; return d && d[i] ? JSON.parse(JSON.stringify(d[i])) : undefined; }, [colecao, id]);
      },
      async colecao(colecao) {
        return page.evaluate(c => JSON.parse(JSON.stringify(window.firebase.__store.dados[c] || {})), colecao);
      },
      async escritas(colecao) {
        return page.evaluate(c => window.firebase.__store.log.filter(l => !c || l.caminho.split("/")[0] === c).map(l => ({ op: l.op, caminho: l.caminho })), colecao);
      },
    });
  },
});

module.exports = { test, expect: base.expect };
