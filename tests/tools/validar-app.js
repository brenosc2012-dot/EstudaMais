// Validação estática do app (o projeto não tem TypeScript nem compilação):
//  1) sintaxe do script inline (node --check)
//  2) constantes MAIÚSCULAS usadas mas não declaradas (o "clique que não faz nada" do CLAUDE.md)
//  3) handlers chamados por onclick="App.x()" que não existem em window.App
//  4) JSON válido: manifest.json, firebase.json
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { extrair, RAIZ } = require("./extrair-app");

const falhas = [];
const { appPath, codigo } = extrair();
const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");

try { execFileSync(process.execPath, ["--check", appPath], { stdio: "pipe" }); }
catch (e) { falhas.push("sintaxe: " + String(e.stderr || e.message)); }

const declaradas = new Set([...codigo.matchAll(/(?:(?:const|let|var)\s+|,\s*)([A-Z][A-Z0-9_]*)\s*=/g)].map(m => m[1]));
const orfas = [...new Set([...codigo.matchAll(/([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)/g)].map(m => m[1]))].filter(n => !declaradas.has(n));
if (orfas.length) falhas.push("constantes usadas sem declaração: " + orfas.join(", "));

const blocoApp = (codigo.match(/window\.App\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || "";
const expostos = new Set([...blocoApp.replace(/\/\/.*$/gm, "").matchAll(/([A-Za-z_$][\w$]*)\s*(?=[,:\n]|$)/g)].map(m => m[1]));
const chamados = [...new Set([...html.matchAll(/App\.([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))];
const faltando = chamados.filter(n => !expostos.has(n));
if (faltando.length) falhas.push("App.x() chamados no HTML mas ausentes em window.App: " + faltando.join(", "));

for (const f of ["manifest.json", "firebase.json"]) {
  try { JSON.parse(fs.readFileSync(path.join(RAIZ, f), "utf8")); } catch (e) { falhas.push(f + " inválido: " + e.message); }
}

if (falhas.length) { console.error("VALIDAÇÃO FALHOU:\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`OK — sintaxe, ${declaradas.size} constantes, ${chamados.length} handlers App.x() e JSONs validados.`);
