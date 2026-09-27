// Diagnóstico (manual, SÓ LEITURA): confere se as regras PUBLICADAS no Firebase permitem ler
// cada coleção que o app usa. Uma coleção com 403 indica que o firestore.rules do repositório
// não foi publicado (ex.: "Missing or insufficient permissions" ao regenerar exercícios).
//   npm run check:regras-publicadas
// Não grava nada. Não faz parte do CI (depende do projeto real e da internet).
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
const projeto = (html.match(/projectId:\s*"([^"]+)"/) || [])[1];
const colecoes = [...new Set([...html.matchAll(/collection\("([a-z_]+)"\)/g)].map(m => m[1]))].sort();

(async () => {
  if (!projeto) { console.error("projectId não encontrado no index.html"); process.exit(2); }
  const bloqueadas = [];
  for (const c of colecoes) {
    const url = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/${c}?pageSize=1&mask.fieldPaths=zz`;
    let status;
    try { status = (await fetch(url)).status; } catch (e) { status = "erro de rede: " + e.message; }
    console.log(`${c.padEnd(20)} ${status === 200 ? "✅ leitura permitida" : status === 403 ? "❌ BLOQUEADA pelas regras publicadas" : status}`);
    if (status === 403) bloqueadas.push(c);
  }
  if (bloqueadas.length) {
    console.log(`\n${bloqueadas.length} coleção(ões) bloqueada(s): ${bloqueadas.join(", ")}.`);
    console.log("Publique o firestore.rules do repositório: Firebase Console → Firestore Database → Regras → cole o conteúdo → Publicar.");
    process.exit(1);
  }
  console.log("\nRegras publicadas permitem ler todas as coleções usadas pelo app.");
})();
