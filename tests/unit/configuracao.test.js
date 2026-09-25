// Configuração do projeto: manifest do PWA, regras do Firestore cobrindo TODAS as coleções
// que o app usa, storage.rules e firebase.json.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const ler = f => fs.readFileSync(path.join(RAIZ, f), "utf8");

test("manifest.json: campos obrigatórios de PWA e ícones que existem no projeto", () => {
  const m = JSON.parse(ler("manifest.json"));
  for (const k of ["name", "short_name", "start_url", "display", "icons"]) assert.ok(m[k], k);
  assert.ok(["standalone", "fullscreen", "minimal-ui"].includes(m.display));
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0);
  const tamanhos = m.icons.map(i => i.sizes);
  assert.ok(tamanhos.some(s => /192/.test(s)) && tamanhos.some(s => /512/.test(s)), "ícones 192 e 512: " + tamanhos);
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(RAIZ, i.src.replace(/^\.?\//, ""))), "ícone ausente: " + i.src);
  assert.match(ler("index.html"), /<link rel="manifest" href="manifest\.json">/);
});

test("firestore.rules: toda coleção usada pelo app tem regra (senão o boot/escrita falha em produção)", () => {
  const html = ler("index.html");
  const usadas = [...new Set([...html.matchAll(/\.collection\("([a-z_]+)"\)/g)].map(m => m[1]))].sort();
  assert.ok(usadas.length >= 10, "coleções encontradas: " + usadas);
  const regras = ler("firestore.rules");
  const cobertas = new Set([...regras.matchAll(/match \/([a-z_]+)\/\{/g)].map(m => m[1]));
  const faltando = usadas.filter(c => !cobertas.has(c));
  assert.deepEqual(faltando, [], "coleções sem regra: " + faltando.join(", "));
  assert.match(regras, /^rules_version = '2';/m);
});

test("firestore.rules: nenhuma regra curinga global fora das coleções mapeadas", () => {
  const regras = ler("firestore.rules");
  assert.doesNotMatch(regras, /match \/\{document=\*\*\}/, "curinga global liberaria qualquer coleção");
});

test("storage.rules e firebase.json existem e firebase.json aponta para firestore.rules", () => {
  assert.ok(fs.existsSync(path.join(RAIZ, "storage.rules")));
  const fb = JSON.parse(ler("firebase.json"));
  assert.equal(fb.firestore.rules, "firestore.rules");
});

test("index.html carrega Firebase compat, PDF.js, mammoth e jsPDF só de CDNs conhecidas", () => {
  const html = ler("index.html");
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(srcs.length >= 3);
  for (const s of srcs) assert.match(s, /^https:\/\/(www\.gstatic\.com\/firebasejs|cdnjs\.cloudflare\.com)\//, s);
});

test("nenhuma chave real da OpenAI embutida no código versionado", () => {
  for (const f of ["index.html", "sw.js", "proxy/cloudflare-worker.js", "firestore.rules", "manifest.json"]) {
    assert.doesNotMatch(ler(f), /sk-(proj-)?[A-Za-z0-9_-]{20,}/, f);
  }
});
