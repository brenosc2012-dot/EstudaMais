// OpenAI FALSA e determinística (nenhuma chamada real nos testes comuns).
// Substitui window.fetch. Cada chamada consome o próximo item da fila (ou a resposta
// padrão). Itens aceitos:
//   "texto"                      → 200 com o texto (SSE se o app pediu stream, senão JSON)
//   fn(chamada) => item          → decide pela chamada (prompt, body, url)
//   { status: 401|429|500|503, mensagem }  → erro HTTP com corpo {error:{message}}
//   { rede: true }               → fetch rejeita com TypeError("Failed to fetch")
//   { pendurar: true }           → nunca responde (só termina quando o app aborta = timeout)
//   { silencio: true }           → cabeçalhos SSE chegam e depois nenhum byte (inatividade)
//   { corte: "parcial" }         → SSE manda "parcial" e a conexão cai no meio
//   { corpoInvalido: true }      → 200 com corpo que não é JSON
//   { json: true, texto }        → força resposta JSON mesmo com stream pedido (proxy antigo)
"use strict";

function criarIAFake(opts) {
  opts = opts || {};
  const fila = [];
  const chamadas = [];
  let padrao = opts.padrao !== undefined ? opts.padrao : "Resposta padrão da IA.";

  function textoDasMensagens(msgs) {
    return (msgs || []).map(m => typeof m.content === "string" ? m.content
      : (m.content || []).map(c => c.text || (c.image_url ? "[imagem]" : "")).join("\n")).join("\n");
  }
  function sse(texto, { corte, silencio, signal } = {}) {
    const enc = new TextEncoder();
    const partes = [];
    if (!silencio) {
      const tam = Math.max(1, Math.ceil(texto.length / 3));
      for (let i = 0; i < texto.length; i += tam) partes.push(texto.slice(i, i + tam));
    }
    let i = 0;
    return new ReadableStream({
      pull(ctrl) {
        if (i < partes.length) {
          ctrl.enqueue(enc.encode("data: " + JSON.stringify({ choices: [{ delta: { content: partes[i++] } }] }) + "\n\n"));
          return;
        }
        if (corte) { ctrl.error(new TypeError("network error")); return; }
        if (silencio) {
          return new Promise((_, rej) => {
            const abortar = () => { const e = new Error("The operation was aborted."); e.name = "AbortError"; ctrl.error(e); rej(e); };
            if (signal && signal.aborted) abortar(); else if (signal) signal.addEventListener("abort", abortar);
          });
        }
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
  }
  function abortavel(signal) {
    return new Promise((_, rej) => {
      const abortar = () => { const e = new Error("The operation was aborted."); e.name = "AbortError"; rej(e); };
      if (signal && signal.aborted) abortar(); else if (signal) signal.addEventListener("abort", abortar);
    });
  }

  async function fetchFake(url, init) {
    init = init || {};
    let body;
    try { body = JSON.parse(init.body || "{}"); } catch (_) { body = {}; }
    const headers = Object.assign({}, init.headers || {});
    const chamada = { url: String(url), headers, body, prompt: textoDasMensagens(body.messages), stream: body.stream === true };
    chamadas.push(chamada);
    await Promise.resolve();
    let item = fila.length ? fila.shift() : padrao;
    if (typeof item === "function") item = item(chamada);
    if (item == null) item = "";
    if (typeof item === "string") item = { texto: item };

    if (item.rede) throw new TypeError("Failed to fetch");
    if (item.pendurar) return abortavel(init.signal);
    if (item.status && item.status >= 400) {
      return new Response(JSON.stringify({ error: { message: item.mensagem || "" } }), { status: item.status, headers: { "content-type": "application/json" } });
    }
    if (item.corpoInvalido) return new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "application/json" } });
    const texto = item.texto != null ? String(item.texto) : (item.corte || "");
    if (chamada.stream && !item.json) {
      return new Response(sse(texto, { corte: item.corte != null, silencio: item.silencio, signal: init.signal }),
        { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: texto } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return {
    fetch: fetchFake,
    chamadas,
    /** Enfileira respostas (consumidas em ordem). */
    fila(...itens) { fila.push(...itens); return this; },
    /** Resposta usada quando a fila está vazia. */
    padrao(item) { padrao = item; return this; },
    pendentes() { return fila.length; },
    ultimoPrompt() { return chamadas.length ? chamadas[chamadas.length - 1].prompt : ""; },
  };
}

module.exports = { criarIAFake };
