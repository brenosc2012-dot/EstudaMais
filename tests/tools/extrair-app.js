// Extrai o <script> inline do index.html para build/index.app.js (o c8 mede a cobertura
// desse arquivo). Linha do index.html = linha do build + `offset` (gravado em
// build/offset.json e aplicado como lineOffset no vm, então stack traces já mostram
// a linha do index.html). Sem linhas de preenchimento, para não inflar a cobertura.
// Também gera build/index.sem-script.html (o HTML sem nenhum <script>), usado pelo jsdom.
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const BUILD = path.join(RAIZ, "build");
const HTML_PATH = path.join(RAIZ, "index.html");

function extrair() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!blocos.length) throw new Error("index.html sem <script> inline");
  const ultimo = blocos[blocos.length - 1];
  const inicioCodigo = ultimo.index + "<script>".length;
  const linhasAntes = html.slice(0, inicioCodigo).split("\n").length - 1;
  // o código começa na mesma linha do <script>: a linha 1 do build é a linha linhasAntes+1
  const codigo = ultimo[1];
  const offset = linhasAntes;
  const semScript = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  fs.mkdirSync(BUILD, { recursive: true });
  const appPath = path.join(BUILD, "index.app.js");
  if (!fs.existsSync(appPath) || fs.readFileSync(appPath, "utf8") !== codigo) fs.writeFileSync(appPath, codigo);
  const htmlPath = path.join(BUILD, "index.sem-script.html");
  if (!fs.existsSync(htmlPath) || fs.readFileSync(htmlPath, "utf8") !== semScript) fs.writeFileSync(htmlPath, semScript);
  fs.writeFileSync(path.join(BUILD, "offset.json"), JSON.stringify({ offset }));
  return { appPath, htmlPath, codigo, semScript, offset };
}

if (require.main === module) {
  const r = extrair();
  console.log("extraído:", path.relative(RAIZ, r.appPath));
}
module.exports = { extrair, RAIZ, BUILD };
