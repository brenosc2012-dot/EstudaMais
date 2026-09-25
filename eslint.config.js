// ESLint (flat config). O app não tem build: o script inline do index.html é extraído
// para build/index.app.js (npm run lint faz isso antes) e analisado como script de navegador.
"use strict";
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", "coverage/**", "test-results/**", "playwright-report/**", "cartilha_estudamais.html", "prova-fracoes-demo.html", "qrcode-folha.html"] },
  js.configs.recommended,
  {
    // Código do app (script clássico dentro de uma IIFE, globais de CDN)
    files: ["build/index.app.js"],
    languageOptions: {
      ecmaVersion: 2022, sourceType: "script",
      globals: { ...globals.browser, firebase: "readonly", pdfjsLib: "readonly", mammoth: "readonly", jspdf: "readonly" },
    },
    rules: {
      // Código morto legado (funções/constantes nunca usadas, atribuições sobrescritas) é
      // AVISO, não erro: está listado no relatório de testes e não foi apagado para não
      // mexer em produção fora do escopo. Regras que indicam bug real seguem como erro.
      "no-unused-vars": ["warn", { vars: "local", args: "none", caughtErrors: "none" }],
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off", // regex/template com escapes redundantes mas inofensivos
    },
  },
  {
    files: ["sw.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.serviceworker } },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    files: ["proxy/**/*.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.worker } },
  },
  {
    files: ["tests/**/*.js", "eslint.config.js", "playwright.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }], "no-empty-pattern": "off" },
  },
  {
    // callbacks de page.evaluate / addInitScript rodam no navegador
    files: ["tests/e2e/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["tests/support/fake-firebase.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
