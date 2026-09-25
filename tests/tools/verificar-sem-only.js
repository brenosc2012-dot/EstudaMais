// Falha se algum teste estiver focado/ignorado: .only / .skip / .todo / fixme / { skip: } / { only: } / { todo: }.
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const PROIBIDO = /\b(?:test|it|describe|suite)\s*\.\s*(?:only|skip|todo|fixme)\s*\(|\{\s*(?:only|skip|todo)\s*:|\btest\.describe\.(?:only|skip|fixme)\s*\(/;
const achados = [];
(function varrer(dir) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) { if (n.name !== "tools") varrer(p); continue; }
    if (!/\.(test|spec)\.js$/.test(n.name)) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => { if (PROIBIDO.test(l)) achados.push(`${path.relative(RAIZ, p)}:${i + 1}: ${l.trim()}`); });
  }
})(RAIZ);
if (achados.length) { console.error("Testes focados/ignorados não são permitidos:\n" + achados.join("\n")); process.exit(1); }
console.log("OK — nenhum teste com only/skip/todo/fixme.");
