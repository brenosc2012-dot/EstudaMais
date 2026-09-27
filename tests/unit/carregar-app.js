// Carrega funções REAIS do index.html para os testes (o app é um arquivo único, sem
// módulos). Extrai cada função/constante pelo nome e as executa num contexto `vm`
// isolado, junto com stubs das dependências de navegador/Firestore/IA.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const JS = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

// Recorta `function nome(...){...}` (ou async) contando chaves a partir da 1ª `{` do corpo.
function extrairFuncao(nome) {
  const re = new RegExp("^(async\\s+)?function\\s+" + nome + "\\s*\\(", "m");
  const m = re.exec(JS);
  if (!m) throw new Error("função não encontrada no index.html: " + nome);
  const ini = m.index;
  const abre = JS.indexOf("{", JS.indexOf(")", ini));
  let prof = 0;
  for (let i = abre; i < JS.length; i++) {
    const c = JS[i];
    if (c === "{") prof++;
    else if (c === "}" && --prof === 0) return JS.slice(ini, i + 1);
  }
  throw new Error("chaves desbalanceadas em " + nome);
}
// Recorta uma constante declarada em uma linha (`const NOME = ...;`) ou em bloco `[...]`/`{...}`.
function extrairConst(nome) {
  const re = new RegExp("^const\\s+" + nome + "\\s*=", "m");
  const m = re.exec(JS);
  if (!m) throw new Error("constante não encontrada no index.html: " + nome);
  const fim = JS.indexOf(";", m.index);
  // blocos multilinha ([ ... ]; / { ... };): acha o fechamento balanceado
  const depoisIgual = m.index + m[0].length;
  const primeiro = JS.slice(depoisIgual).trimStart()[0];
  if (primeiro === "[" || primeiro === "{") {
    const abre = JS.indexOf(primeiro, depoisIgual);
    const fecha = primeiro === "[" ? "]" : "}";
    let prof = 0;
    for (let i = abre; i < JS.length; i++) {
      if (JS[i] === primeiro) prof++;
      else if (JS[i] === fecha && --prof === 0) return JS.slice(m.index, i + 1) + ";";
    }
  }
  return JS.slice(m.index, fim + 1);
}

// Monta um contexto com as funções/constantes pedidas + os stubs dados.
// Funções/constantes viram globais do contexto (`let`/`const` via var para poder trocar nos testes).
// Dependências são resolvidas sozinhas: toda FUNÇÃO de topo e toda CONSTANTE EM MAIÚSCULAS que o
// código extraído usa entra junto (recursivamente) — exceto o que o teste passou em `stubs`, que
// continua sendo o dublê. Objetos de estado em minúsculas (Teacher, State, Sess...) NÃO entram:
// o teste decide se os fornece. Assim um refactor que cria um helper não quebra dezenas de testes.
const NOMES_FUNCOES = new Set([...JS.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]));
const NOMES_CONSTS = new Set([...JS.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=/gm)].map(m => m[1]));
function resolver(funcoes, constantes, stubs) {
  const fs_ = new Set(funcoes), cs = new Set(constantes), fila = [...funcoes, ...constantes];
  while (fila.length) {
    const nome = fila.shift();
    const src = fs_.has(nome) ? extrairFuncao(nome) : extrairConst(nome);
    for (const [, id] of src.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (id === nome || id in stubs || fs_.has(id) || cs.has(id)) continue;
      if (NOMES_FUNCOES.has(id)) { fs_.add(id); fila.push(id); } else if (NOMES_CONSTS.has(id)) { cs.add(id); fila.push(id); }
    }
  }
  return { funcoes: [...fs_], constantes: [...cs] };
}
function carregar({ funcoes = [], constantes = [], stubs = {} }) {
  const ctx = vm.createContext(Object.assign({ console, Math, JSON, Date, Set, Promise, Object, Array, String }, stubs));
  const r = resolver(funcoes, constantes, stubs);
  const codigo = r.constantes.map(c => extrairConst(c).replace(/^const\s+/, "var ")).join("\n") + "\n" +
                 r.funcoes.map(extrairFuncao).join("\n");
  vm.runInContext(codigo, ctx, { filename: "index.html(extraído)" });
  return ctx;
}

module.exports = { carregar, extrairFuncao, JS };
