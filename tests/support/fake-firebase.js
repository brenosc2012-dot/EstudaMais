/* Firebase "compat" FALSO e em memória — o banco isolado dos testes.
   Implementa só o subconjunto que o index.html usa: initializeApp/apps, firestore(),
   collection/doc/add/get/set(merge)/update(caminho com ponto)/delete, where (==, !=, <,
   <=, >, >=, in, array-contains), onSnapshot, batch atômico, enablePersistence,
   FieldValue.serverTimestamp/delete/increment/arrayUnion/arrayRemove e Timestamp.

   Controle para os testes (store = firebase.__store):
   - store.dados                → { colecao: { id: dados } } (leitura direta)
   - store.semear(obj)          → substitui o conteúdo
   - store.log                  → operações de escrita confirmadas [{op, caminho, dados}]
   - store.falhar({op, colecao, vezes, erro}) → injeta falha (op: get|set|update|delete|add|commit|snapshot|*)
   - store.segurar({op, colecao}) → a próxima op fica pendente até liberar() (concorrência)
   - store.offline = true       → toda operação rejeita ("unavailable")
   Funciona no Node (require) e no navegador (<script>, expõe window.__criarFirebaseFake). */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.__criarFirebaseFake = api.criarFirebaseFake;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function criarFirebaseFake(opts) {
    opts = opts || {};
    const agora = opts.agora || (() => Date.now());

    // ---------- Timestamp / FieldValue ----------
    class Timestamp {
      constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds || 0; }
      toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
      toDate() { return new Date(this.toMillis()); }
      isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
      static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
      static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
      static now() { return Timestamp.fromMillis(agora()); }
    }
    class Sentinela { constructor(tipo, valor) { this.__sentinela = tipo; this.valor = valor; } }
    const FieldValue = {
      serverTimestamp: () => new Sentinela("ts"),
      delete: () => new Sentinela("del"),
      increment: n => new Sentinela("inc", n),
      arrayUnion: (...v) => new Sentinela("union", v),
      arrayRemove: (...v) => new Sentinela("remove", v),
    };

    // ---------- estado ----------
    const store = {
      dados: {}, log: [], offline: false, _falhas: [], _seguros: [], _ouvintes: [], _seq: 0,
      semear(obj) { this.dados = reviver(clonar(obj || {})); salvar(); },
      falhar(f) { this._falhas.push(Object.assign({ op: "*", vezes: 1, erro: null }, f)); },
      segurar(f) {
        let liberar;
        const p = new Promise(r => { liberar = r; });
        this._seguros.push(Object.assign({ op: "*" }, f, { p }));
        return liberar;
      },
      doc(colecao, id) { const c = this.dados[colecao]; return c && c[id] ? clonar(c[id]) : undefined; },
      colecao(colecao) { return clonar(this.dados[colecao] || {}); },
      escritas(colecao) { return this.log.filter(l => !colecao || l.caminho.split("/")[0] === colecao); },
    };

    // persistência opcional (E2E: sobrevive ao recarregar a página)
    const persist = opts.persistirEm || null, chave = opts.chave || "__fakeFirestore";
    function salvar() { if (persist) try { persist.setItem(chave, JSON.stringify(store.dados, replacer)); } catch (_) { /* cota */ } }
    function replacer(k, v) { return v && typeof v === "object" && typeof v.seconds === "number" && typeof v.toMillis === "function" ? { __ts: v.toMillis() } : v; }
    function reviver(v) {
      if (Array.isArray(v)) return v.map(reviver);
      if (v && typeof v === "object") {
        if (typeof v.__ts === "number" && Object.keys(v).length === 1) return Timestamp.fromMillis(v.__ts);
        if (v instanceof Timestamp) return v;
        const o = {}; for (const k in v) o[k] = reviver(v[k]); return o;
      }
      return v;
    }
    function clonar(v) {
      if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds);
      if (v instanceof Sentinela) return v;
      if (Array.isArray(v)) return v.map(clonar);
      if (v && typeof v === "object") { const o = {}; for (const k in v) if (v[k] !== undefined) o[k] = clonar(v[k]); return o; }
      return v;
    }
    const inicial = persist ? (function () { try { return persist.getItem(chave); } catch (_) { return null; } })() : null;
    if (inicial) store.dados = reviver(JSON.parse(inicial));
    else if (opts.seed) store.dados = reviver(clonar(opts.seed));

    function erroFirestore(code, msg) { const e = new Error(msg || code); e.code = code; e.name = "FirebaseError"; return e; }
    async function portao(op, colecao) {
      await Promise.resolve();
      if (store.offline) throw erroFirestore("unavailable", "Failed to get document because the client is offline.");
      const i = store._seguros.findIndex(s => (s.op === "*" || s.op === op) && (!s.colecao || s.colecao === colecao));
      if (i >= 0) { const s = store._seguros.splice(i, 1)[0]; await s.p; }
      const j = store._falhas.findIndex(f => (f.op === "*" || f.op === op) && (!f.colecao || f.colecao === colecao));
      if (j >= 0) {
        const f = store._falhas[j];
        if (--f.vezes <= 0) store._falhas.splice(j, 1);
        throw f.erro || erroFirestore("unavailable", `falha simulada em ${op} ${colecao || ""}`.trim());
      }
    }

    // ---------- aplicação de escrita ----------
    function aplicarCampos(alvo, dados, merge, anterior) {
      for (const k in dados) {
        const v = dados[k];
        if (v === undefined) throw erroFirestore("invalid-argument", `Function set() called with invalid data. Unsupported field value: undefined (found in field ${k})`);
        if (v instanceof Sentinela) {
          if (v.__sentinela === "del") { delete alvo[k]; continue; }
          if (v.__sentinela === "ts") { alvo[k] = Timestamp.now(); continue; }
          if (v.__sentinela === "inc") { const a = anterior && typeof anterior[k] === "number" ? anterior[k] : 0; alvo[k] = a + v.valor; continue; }
          if (v.__sentinela === "union") { const a = Array.isArray(anterior && anterior[k]) ? anterior[k].slice() : []; v.valor.forEach(x => { if (!a.some(y => JSON.stringify(y) === JSON.stringify(x))) a.push(clonar(x)); }); alvo[k] = a; continue; }
          if (v.__sentinela === "remove") { const a = Array.isArray(anterior && anterior[k]) ? anterior[k] : []; alvo[k] = a.filter(y => !v.valor.some(x => JSON.stringify(x) === JSON.stringify(y))); continue; }
        }
        if (merge && v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Timestamp)) {
          const base = alvo[k] && typeof alvo[k] === "object" && !Array.isArray(alvo[k]) ? alvo[k] : {};
          alvo[k] = base;
          aplicarCampos(base, v, true, anterior && anterior[k]);
        } else alvo[k] = limparSentinelas(v);
      }
    }
    function limparSentinelas(v) {
      if (v instanceof Sentinela) return v.__sentinela === "ts" ? Timestamp.now() : undefined;
      if (Array.isArray(v)) return v.map(limparSentinelas);
      if (v && typeof v === "object" && !(v instanceof Timestamp)) { const o = {}; for (const k in v) { const x = limparSentinelas(v[k]); if (x !== undefined) o[k] = x; } return o; }
      return v;
    }
    // Calcula (sem aplicar) o novo valor do documento. Lança se a operação for inválida.
    function calcular(op) {
      const col = store.dados[op.colecao] || {};
      const atual = col[op.id];
      if (op.tipo === "delete") return null;
      if (op.tipo === "update") {
        if (!atual) throw erroFirestore("not-found", `No document to update: ${op.colecao}/${op.id}`);
        const novo = clonar(atual);
        for (const caminho in op.dados) {
          const partes = caminho.split(".");
          let alvo = novo, ant = atual;
          for (let i = 0; i < partes.length - 1; i++) {
            if (!alvo[partes[i]] || typeof alvo[partes[i]] !== "object") alvo[partes[i]] = {};
            alvo = alvo[partes[i]]; ant = ant && ant[partes[i]];
          }
          const campo = {}; campo[partes[partes.length - 1]] = op.dados[caminho];
          aplicarCampos(alvo, campo, false, ant);
        }
        return novo;
      }
      // set
      const novo = op.merge && atual ? clonar(atual) : {};
      aplicarCampos(novo, op.dados, !!op.merge, atual);
      return novo;
    }
    function aplicar(ops) {
      const novos = ops.map(calcular); // valida tudo antes (atomicidade)
      const tocadas = new Set();
      ops.forEach((op, i) => {
        store.dados[op.colecao] = store.dados[op.colecao] || {};
        if (novos[i] === null) delete store.dados[op.colecao][op.id];
        else store.dados[op.colecao][op.id] = novos[i];
        store.log.push({ op: op.tipo, caminho: op.colecao + "/" + op.id, dados: op.dados, merge: !!op.merge });
        tocadas.add(op.colecao);
      });
      salvar();
      tocadas.forEach(notificar);
    }

    // ---------- referências ----------
    function DocSnap(colecao, id, dados) {
      return {
        id, exists: dados !== undefined,
        ref: docRef(colecao, id),
        data: () => (dados === undefined ? undefined : clonar(dados)),
        get: campo => campo.split(".").reduce((o, p) => (o == null ? undefined : o[p]), dados),
      };
    }
    function QuerySnap(docs) {
      return {
        docs, size: docs.length, empty: docs.length === 0,
        forEach: cb => docs.forEach(cb),
        docChanges: () => docs.map(d => ({ type: "added", doc: d })),
        metadata: { fromCache: false, hasPendingWrites: false },
      };
    }
    function docRef(colecao, id) {
      return {
        id, path: colecao + "/" + id,
        parent: { id: colecao },
        async get() { await portao("get", colecao); const c = store.dados[colecao] || {}; return DocSnap(colecao, id, c[id] && clonar(c[id])); },
        async set(dados, o) { await portao("set", colecao); aplicar([{ tipo: "set", colecao, id, dados, merge: !!(o && o.merge) }]); },
        async update(dados) { await portao("update", colecao); aplicar([{ tipo: "update", colecao, id, dados }]); },
        async delete() { await portao("delete", colecao); aplicar([{ tipo: "delete", colecao, id }]); },
        collection(sub) { return colRef(colecao + "/" + id + "/" + sub); },
      };
    }
    function comparar(v, op, alvo) {
      switch (op) {
        case "==": return JSON.stringify(v) === JSON.stringify(alvo);
        case "!=": return v !== undefined && JSON.stringify(v) !== JSON.stringify(alvo);
        case "<": return v < alvo;
        case "<=": return v <= alvo;
        case ">": return v > alvo;
        case ">=": return v >= alvo;
        case "in": return Array.isArray(alvo) && alvo.some(a => JSON.stringify(a) === JSON.stringify(v));
        case "array-contains": return Array.isArray(v) && v.some(a => JSON.stringify(a) === JSON.stringify(alvo));
        default: throw erroFirestore("invalid-argument", "operador não suportado no fake: " + op);
      }
    }
    function consulta(colecao, filtros, ordem, lim) {
      return {
        where(campo, op, valor) { return consulta(colecao, filtros.concat([[campo, op, valor]]), ordem, lim); },
        orderBy(campo, dir) { return consulta(colecao, filtros, [campo, dir || "asc"], lim); },
        limit(n) { return consulta(colecao, filtros, ordem, n); },
        async get() { await portao("get", colecao); return QuerySnap(listar()); },
        onSnapshot(cb, erroCb) { return ouvir(colecao, () => QuerySnap(listar()), cb, erroCb); },
      };
      function listar() {
        const c = store.dados[colecao] || {};
        let ids = Object.keys(c).filter(id => filtros.every(([campo, op, v]) => comparar(campo.split(".").reduce((o, p) => (o == null ? undefined : o[p]), c[id]), op, v)));
        if (ordem) ids.sort((a, b) => { const x = c[a][ordem[0]], y = c[b][ordem[0]]; const r = x < y ? -1 : x > y ? 1 : 0; return ordem[1] === "desc" ? -r : r; });
        if (lim) ids = ids.slice(0, lim);
        return ids.map(id => DocSnap(colecao, id, clonar(c[id])));
      }
    }
    function colRef(colecao) {
      const q = consulta(colecao, [], null, 0);
      return Object.assign(q, {
        id: colecao,
        doc(id) { return docRef(colecao, id || novoId()); },
        async add(dados) { const id = novoId(); await portao("add", colecao); aplicar([{ tipo: "set", colecao, id, dados }]); return docRef(colecao, id); },
      });
    }
    function novoId() { store._seq++; return "auto" + String(store._seq).padStart(4, "0"); }
    function ouvir(colecao, montar, cb, erroCb) {
      const o = { colecao, montar, cb, erroCb, ativo: true };
      store._ouvintes.push(o);
      Promise.resolve().then(async () => {
        try { await portao("snapshot", colecao); if (o.ativo) cb(montar()); }
        catch (e) { o.ativo = false; if (erroCb) erroCb(e); }
      });
      return () => { o.ativo = false; store._ouvintes = store._ouvintes.filter(x => x !== o); };
    }
    function notificar(colecao) {
      store._ouvintes.filter(o => o.colecao === colecao && o.ativo).forEach(o => {
        Promise.resolve().then(() => { if (o.ativo) o.cb(o.montar()); });
      });
    }

    // ---------- db / app ----------
    const db = {
      collection: colRef,
      enablePersistence: () => Promise.resolve(),
      batch() {
        const ops = [];
        return {
          set(ref, dados, o) { ops.push({ tipo: "set", colecao: ref.path.split("/")[0], id: ref.id, dados, merge: !!(o && o.merge) }); return this; },
          update(ref, dados) { ops.push({ tipo: "update", colecao: ref.path.split("/")[0], id: ref.id, dados }); return this; },
          delete(ref) { ops.push({ tipo: "delete", colecao: ref.path.split("/")[0], id: ref.id }); return this; },
          async commit() { await portao("commit", ops[0] && ops[0].colecao); aplicar(ops); },
        };
      },
    };
    const firestore = () => db;
    firestore.FieldValue = FieldValue;
    firestore.Timestamp = Timestamp;
    const firebase = {
      apps: [],
      initializeApp(cfg) { const app = { name: "[DEFAULT]", options: cfg }; this.apps.push(app); return app; },
      firestore,
      __store: store,
      __Timestamp: Timestamp,
    };
    return firebase;
  }

  return { criarFirebaseFake };
});
