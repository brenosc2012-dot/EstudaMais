// Testes end-to-end (navegador real). Firebase, CDNs e OpenAI são interceptados
// (ver tests/e2e/base.js) — nenhum serviço externo é chamado.
// Local: usa o Google Chrome instalado (channel "chrome"). CI: Chromium do Playwright.
"use strict";
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/e2e",
  forbidOnly: true,            // test.only quebra a execução (local e CI)
  retries: 0,                  // sem retry: teste instável deve falhar, não ser mascarado
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    channel: process.env.CI ? undefined : (process.env.PW_CHANNEL || "chrome"),
    serviceWorkers: "block",   // o SW faria cache entre testes
    viewport: { width: 420, height: 860 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/tools/servidor-estatico.js",
    url: "http://localhost:4173/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
