// Servidor estático mínimo (sem dependências) para os testes E2E: serve a raiz do projeto.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const PORTA = Number(process.env.PORT || 4173);
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".css": "text/css" };

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const alvo = path.normalize(path.join(RAIZ, url === "/" ? "index.html" : url));
  if (!alvo.startsWith(RAIZ) || /node_modules|\.git/.test(alvo)) { res.writeHead(403); res.end(); return; }
  fs.readFile(alvo, (err, dados) => {
    if (err) { res.writeHead(404); res.end("não encontrado"); return; }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(alvo)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(dados);
  });
}).listen(PORTA, () => console.log(`servidor de teste em http://localhost:${PORTA}`));
