/* ============================================================
   EstudaMais — Proxy da OpenAI (Cloudflare Worker)
   ------------------------------------------------------------
   Por que existe:
   - Mantém a chave da OpenAI NO SERVIDOR (Secret do Worker), nunca no
     navegador nem no Firestore.
   - Devolve cabeçalhos CORS corretos INCLUSIVE em erros (a OpenAI não
     envia CORS nas respostas de erro, o que fazia o navegador bloquear).

   O app (index.html) faz POST para a URL deste Worker com o MESMO corpo
   que mandaria à OpenAI: { model, messages, temperature }. O Worker
   adiciona o Authorization e repassa para a OpenAI.

   Variáveis (no painel do Worker → Settings → Variables):
   - OPENAI_API_KEY  (Secret, obrigatório): sua chave sk-...
   - ALLOWED_ORIGIN  (texto, opcional): origem permitida; padrão "*".
     Recomendado: "https://brenosc2012-dot.github.io"
   ============================================================ */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODELO_PADRAO = "gpt-4o-mini";

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    // Preflight
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")
      return resp({ error: { message: "Use POST." } }, 405, cors);
    if (!env.OPENAI_API_KEY)
      return resp({ error: { message: "OPENAI_API_KEY não configurada no Worker." } }, 500, cors);

    let body;
    try { body = await request.json(); }
    catch { return resp({ error: { message: "JSON inválido." } }, 400, cors); }

    // Repassa só os campos esperados (evita abuso de outros parâmetros)
    const payload = {
      model: typeof body.model === "string" ? body.model : MODELO_PADRAO,
      messages: Array.isArray(body.messages) ? body.messages : [],
      temperature: typeof body.temperature === "number" ? body.temperature : 0.7
    };
    // streaming: o app pede `stream:true` para receber o texto aos poucos (respostas
    // longas não dependem mais de a conexão aguentar uma espera única e silenciosa)
    const ehStream = body.stream === true;
    if (ehStream) payload.stream = true;

    let r;
    try {
      r = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + env.OPENAI_API_KEY
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return resp({ error: { message: "Falha ao contatar a OpenAI: " + (e && e.message) } }, 502, cors);
    }

    // streaming: repassa o corpo em fluxo (sem bufferizar), preservando o SSE
    if (ehStream && r.ok && r.body) {
      return new Response(r.body, {
        status: r.status,
        headers: {
          ...cors,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    }

    // devolve a resposta da OpenAI como veio, agora COM CORS
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};

function resp(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
