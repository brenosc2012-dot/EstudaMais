// Harness: carrega o index.html REAL no jsdom com Firebase, OpenAI, relógio, aleatoriedade,
// voz e áudio falsos — tudo determinístico e isolado por teste.
//
//   const h = await abrirApp({ seed, sessao, ia, random });
//   await h.clicar(/Entrar/); h.texto(); h.store.doc("alunos", "a1"); await h.avancar(10000);
//   const h2 = await h.recarregar();   // "F5": mesmo banco + mesmo localStorage
//
// O script do app é executado a partir de build/index.app.js (mesmas linhas do
// index.html), o que permite ao c8 medir a cobertura do código real.
"use strict";
const fs = require("fs");
const vm = require("vm");
const { webcrypto, createHash } = require("crypto");
const { TextDecoder, TextEncoder } = require("util");
const { JSDOM, VirtualConsole } = require("jsdom");
const { pathToFileURL } = require("url");
const { extrair } = require("../tools/extrair-app");
const { criarFirebaseFake } = require("./fake-firebase");
const { criarIAFake } = require("./fake-ia");

let _compilado = null;
function compilado() {
  if (!_compilado) {
    const { appPath, htmlPath, offset } = extrair();
    _compilado = { script: new vm.Script(fs.readFileSync(appPath, "utf8"), { filename: pathToFileURL(appPath).href, lineOffset: offset }), html: fs.readFileSync(htmlPath, "utf8") };
  }
  return _compilado;
}
const esperarMacro = () => new Promise(r => setImmediate(r));

// ---------------- relógio falso (setTimeout/setInterval/Date) ----------------
function criarRelogio(inicio) {
  const r = { agora: inicio, _id: 0, timers: new Map() };
  r.setTimeout = (fn, ms, ...a) => { const id = ++r._id; r.timers.set(id, { fn, a, quando: r.agora + Math.max(0, +ms || 0), intervalo: 0 }); return id; };
  r.setInterval = (fn, ms, ...a) => { const id = ++r._id; const iv = Math.max(1, +ms || 0); r.timers.set(id, { fn, a, quando: r.agora + iv, intervalo: iv }); return id; };
  r.clearTimeout = r.clearInterval = id => { r.timers.delete(id); };
  r.proximo = limite => {
    let melhor = null;
    for (const [id, t] of r.timers) if (t.quando <= limite && (!melhor || t.quando < melhor[1].quando || (t.quando === melhor[1].quando && id < melhor[0]))) melhor = [id, t];
    return melhor;
  };
  return r;
}

// ---------------- aleatoriedade injetável ----------------
function criarRandom(semente) {
  let s = (semente >>> 0) || 1;
  const fila = [];
  const fn = () => {
    if (fila.length) return fila.shift();
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.fila = (...v) => { fila.push(...v); return fn; };
  return fn;
}

// ---------------- voz / áudio falsos ----------------
function criarFala(window) {
  const faladas = [];
  const synth = {
    speaking: false, paused: false, pending: false,
    speak(u) { faladas.push(u); this.speaking = true; Promise.resolve().then(() => { if (u.onstart) u.onstart(); }); },
    cancel() { this.speaking = false; },
    pause() { this.paused = true; }, resume() { this.paused = false; },
    getVoices() { return [{ name: "Google português do Brasil", lang: "pt-BR", localService: true, default: true }, { name: "Microsoft Maria", lang: "pt-BR", localService: true }, { name: "Google US English", lang: "en-US", localService: true }]; },
    addEventListener() {}, removeEventListener() {}, onvoiceschanged: null,
    /** termina a fala atual (dispara onend) — usado para avançar a leitura por parágrafo */
    terminar() { const u = faladas[faladas.length - 1]; this.speaking = false; if (u && u.onend) u.onend(); },
  };
  function SpeechSynthesisUtterance(texto) { this.text = texto; this.lang = ""; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; }
  window.speechSynthesis = synth;
  window.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
  return { synth, faladas, textos: () => faladas.map(u => u.text) };
}
function criarAudio(window) {
  const sons = [];
  const no = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, type: "sine" });
  function AudioContext() { this.currentTime = 0; this.state = "running"; this.destination = {}; }
  AudioContext.prototype.createOscillator = function () { const n = no(); sons.push("osc"); return n; };
  AudioContext.prototype.createGain = no;
  AudioContext.prototype.resume = () => Promise.resolve();
  window.AudioContext = AudioContext;
  return sons;
}

/**
 * Abre o app.
 * @param {object} o
 *  seed        dados iniciais do Firestore { colecao: { id: dados } }
 *  store       firebase fake já existente (para "recarregar")
 *  local       entradas do localStorage { chave: valor(string|obj) }
 *  sessao      atalho: { tipo:"aluno"|"professor", id } → grava a sessão local
 *  ia          fake da IA (criarIAFake) ou opções para criar um
 *  random      semente numérica ou função
 *  agora       instante inicial do relógio (ms) — padrão 2026-03-10 12:00 local
 *  url         padrão http://localhost/index.html
 *  confirmar   true | false | fn(msg) → resposta do window.confirm
 *  semBoot     não espera o boot terminar
 */
async function abrirApp(o) {
  o = o || {};
  const { script, html } = compilado();
  const erros = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/Not implemented: (navigation|window\.scrollTo|HTMLMediaElement)/.test(e.message)) erros.push("jsdom: " + e.message); });
  vc.on("error", (...a) => erros.push("console.error: " + a.map(x => (x && x.stack) || String(x)).join(" ")));
  const relogio = o.relogio || criarRelogio(o.agora || new Date(2026, 2, 10, 12, 0, 0).getTime());
  const random = typeof o.random === "function" ? o.random : criarRandom(o.random || 7);
  const firebase = o.store || criarFirebaseFake({ seed: o.seed, agora: () => relogio.agora });
  const ia = o.ia && o.ia.fetch ? o.ia : criarIAFake(o.ia);
  const confirmacoes = [], alertas = [], toasts = [];
  let respostaConfirm = o.confirmar === undefined ? true : o.confirmar;
  let respostaPrompt = null;

  const dom = new JSDOM(html, {
    url: o.url || "http://localhost/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;

  // ---- ambiente do navegador ----
  w.setTimeout = relogio.setTimeout; w.setInterval = relogio.setInterval;
  w.clearTimeout = relogio.clearTimeout; w.clearInterval = relogio.clearInterval;
  const RealDate = w.Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(relogio.agora); else super(...a); }
    static now() { return relogio.agora; }
  }
  w.Date = FakeDate;
  w.Math.random = random;
  w.fetch = ia.fetch;
  w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
  // SHA-256 idêntico ao do navegador, mas calculado na hora: o webcrypto real roda no pool de
  // threads do Node e, com a máquina carregada, podia não terminar dentro de h.estabilizar()
  // (teste instável no login/cadastro). Assim o hash resolve numa microtarefa, sempre.
  const cryptoDeterministico = {
    getRandomValues: a => webcrypto.getRandomValues(a),
    randomUUID: () => webcrypto.randomUUID(),
    subtle: {
      async digest(alg, dados) {
        const nome = String(alg && alg.name || alg).replace("-", "").toLowerCase();
        const bytes = dados instanceof ArrayBuffer ? new Uint8Array(dados) : new Uint8Array(dados.buffer, dados.byteOffset, dados.byteLength);
        const b = createHash(nome).update(bytes).digest();
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
    },
  };
  Object.defineProperty(w, "crypto", { value: cryptoDeterministico, configurable: true });
  w.confirm = msg => { confirmacoes.push(String(msg)); return typeof respostaConfirm === "function" ? respostaConfirm(String(msg)) : respostaConfirm; };
  w.alert = msg => { alertas.push(String(msg)); };
  w.prompt = msg => { confirmacoes.push(String(msg)); return typeof respostaPrompt === "function" ? respostaPrompt(String(msg)) : respostaPrompt; };
  w.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.HTMLCanvasElement.prototype.getContext = function () {
    const W = this.width || 1, H = this.height || 1;
    return { drawImage() {}, fillRect() {}, clearRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4), width: W, height: H }), putImageData() {}, fillText() {}, measureText: () => ({ width: 10 }), save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, beginPath() {}, stroke() {}, fill() {}, arc() {}, moveTo() {}, lineTo() {}, rect() {}, strokeRect() {} };
  };
  w.HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/jpeg;base64,AAAA"; };
  const fala = criarFala(w);
  const sons = criarAudio(w);
  const compartilhados = [];
  Object.defineProperty(w.navigator, "share", { value: d => { compartilhados.push(d); return Promise.resolve(); }, configurable: true });
  Object.defineProperty(w.navigator, "clipboard", { value: { writeText: t => { compartilhados.push({ clipboard: t }); return Promise.resolve(); } }, configurable: true });
  w.firebase = firebase;
  if (o.libs !== false) {
    w.pdfjsLib = o.pdfjsLib || { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "Texto do PDF de teste" }] }) }) }) }) };
    w.mammoth = o.mammoth || { extractRawText: async () => ({ value: "Texto do DOCX de teste" }) };
    const pdfs = [];
    w.jspdf = { jsPDF: function () { const d = { pdfs, texto: [], text(t) { d.texto.push([].concat(t).join(" ")); return d; }, setFontSize() { return d; }, setFont() { return d; }, setTextColor() { return d; }, setFillColor() { return d; }, setDrawColor() { return d; }, rect() { return d; }, roundedRect() { return d; }, line() { return d; }, addPage() { return d; }, addImage() { return d; }, splitTextToSize: t => [String(t)], getTextWidth: t => String(t).length * 2, internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } }, save(n) { pdfs.push(n); }, output: () => new w.Blob(["pdf"]) }; return d; } };
  }

  // ---- armazenamento local / sessão ----
  const local = Object.assign({}, o.local || {});
  if (o.sessao) local.estudamais_sessao_v2 = o.sessao;
  for (const k in local) w.localStorage.setItem(k, typeof local[k] === "string" ? local[k] : JSON.stringify(local[k]));
  for (const k in (o.session || {})) w.sessionStorage.setItem(k, o.session[k]);

  // ---- captura de toasts ----
  const toastEl = w.document.getElementById("toast");
  if (toastEl) new w.MutationObserver(() => { const t = toastEl.textContent; if (t && toasts[toasts.length - 1] !== t) toasts.push(t); })
    .observe(toastEl, { childList: true, characterData: true, subtree: true });

  // ---- executa o app ----
  script.runInContext(dom.getInternalVMContext());

  const h = {
    dom, window: w, document: w.document, firebase, store: firebase.__store, ia, fala, sons, relogio, random,
    confirmacoes, alertas, toasts, erros, compartilhados,
    get App() { return w.App; },
    /** HTML/texto da área principal (#app). */
    html: () => w.document.getElementById("app").innerHTML,
    texto: () => normalizarEspacos(w.document.getElementById("app").textContent),
    /** Esvazia microtarefas e timers vencidos (sem avançar o relógio). */
    async estabilizar(rodadas) {
      for (let i = 0; i < (rodadas || 25); i++) { await esperarMacro(); await rodarVencidos(relogio.agora); }
    },
    /** Avança o relógio falso `ms`, rodando os timers na ordem. */
    async avancar(ms) {
      const alvo = relogio.agora + ms;
      for (let guarda = 0; guarda < 100000; guarda++) {
        await esperarMacro();
        const p = relogio.proximo(alvo);
        if (!p) break;
        relogio.agora = Math.max(relogio.agora, p[1].quando);
        executarTimer(p[0], p[1]);
      }
      relogio.agora = alvo;
      await h.estabilizar();
    },
    /** Espera (em tempo falso) até cond() ser verdadeira. */
    async aguardar(cond, { max = 60000, passo = 100, msg } = {}) {
      await h.estabilizar();
      for (let t = 0; t <= max; t += passo) { if (cond()) return; await h.avancar(passo); }
      throw new Error("aguardar: condição não atingida" + (msg ? " — " + msg : "") + "\nTela: " + h.texto().slice(0, 600));
    },
    respostaConfirm(v) { respostaConfirm = v; },
    respostaPrompt(v) { respostaPrompt = v; },
    // ---------- consultas "acessíveis" ----------
    botoes() { return [...w.document.querySelectorAll("button, [role=button], [onclick]")].filter(visivel); },
    nomes() { return h.botoes().map(nomeAcessivel); },
    botao(nome, { todos = false } = {}) {
      const lista = h.botoes().filter(b => casa(nomeAcessivel(b), nome));
      if (todos) return lista;
      if (!lista.length) throw new Error(`botão ${nome} não encontrado. Disponíveis:\n - ${h.nomes().join("\n - ")}`);
      return lista[0];
    },
    tem(nome) { return h.botoes().some(b => casa(nomeAcessivel(b), nome)); },
    async clicar(nome, opts) {
      const b = typeof nome === "object" && nome && nome.nodeType ? nome : h.botao(nome);
      if (b.disabled && !(opts && opts.forcar)) throw new Error("botão desabilitado: " + nomeAcessivel(b));
      b.click();
      await h.estabilizar();
      return b;
    },
    campo(id) {
      const el = w.document.getElementById(id) || w.document.querySelector(`[name="${id}"]`) || [...w.document.querySelectorAll("input,textarea,select")].find(i => i.placeholder === id);
      if (!el) throw new Error("campo não encontrado: " + id);
      return el;
    },
    async preencher(id, valor) {
      const el = h.campo(id);
      el.value = valor;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
      el.dispatchEvent(new w.Event("change", { bubbles: true }));
      await h.estabilizar();
      return el;
    },
    /** Erros de JavaScript visíveis (faixa vermelha do app) + erros do console/jsdom. */
    errosJs() { const b = w.document.getElementById("erroJs"); return erros.concat(b ? ["faixa: " + b.textContent] : []); },
    /** "F5": abre uma nova janela com o mesmo banco e o mesmo localStorage/sessionStorage. */
    async recarregar(extra) {
      const localAtual = {}, sessAtual = {};
      for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); localAtual[k] = w.localStorage.getItem(k); }
      for (let i = 0; i < w.sessionStorage.length; i++) { const k = w.sessionStorage.key(i); sessAtual[k] = w.sessionStorage.getItem(k); }
      h.fechar();
      return abrirApp(Object.assign({}, o, { store: firebase, ia, relogio, random, local: localAtual, session: sessAtual, sessao: undefined, seed: undefined }, extra || {}));
    },
    fechar() { relogio.timers.clear(); try { w.close(); } catch (_) { /* já fechada */ } },
  };

  function executarTimer(id, t) {
    if (!relogio.timers.has(id)) return;
    if (t.intervalo) t.quando += t.intervalo; else relogio.timers.delete(id);
    try { t.fn(...t.a); } catch (e) { erros.push("timer: " + ((e && e.stack) || e)); }
  }
  async function rodarVencidos(limite) {
    for (let g = 0; g < 1000; g++) { const p = relogio.proximo(limite); if (!p) return; executarTimer(p[0], p[1]); await esperarMacro(); }
  }
  function visivel(el) { return !el.closest("[hidden]") && el.style.display !== "none"; }

  if (!o.semBoot) await h.aguardar(() => !/Carregando/.test(h.texto()), { max: 5000, msg: "boot" });
  return h;
}

function normalizarEspacos(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function nomeAcessivel(el) { return normalizarEspacos(el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || ""); }
function casa(texto, nome) { return nome instanceof RegExp ? nome.test(texto) : texto.includes(nome); }

module.exports = { abrirApp, criarIAFake, criarFirebaseFake, criarRandom, criarRelogio };
