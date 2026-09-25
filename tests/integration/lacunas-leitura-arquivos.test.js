// Caminhos de ERRO de leitura de arquivos/imagens (FileReader/Image), estilos de voz e o
// descarte de exercícios que a IA mande junto na etapa 1 da interpretação de texto.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor } = require("../support/professor-helpers");
const A = require("../support/aluno-helpers");

/** FileReader que falha para os nomes indicados (em qualquer modo de leitura). */
function readerQueFalha(h, nomes) {
  const Real = h.window.FileReader;
  const falha = (r, f) => { if (nomes.includes(f.name)) { Promise.resolve().then(() => { if (r.onerror) r.onerror(); }); return true; } return false; };
  h.window.FileReader = class extends Real {
    readAsText(f) { if (!falha(this, f)) super.readAsText(f); }
    readAsDataURL(f) { if (!falha(this, f)) super.readAsDataURL(f); }
    readAsArrayBuffer(f) { if (!falha(this, f)) super.readAsArrayBuffer(f); }
  };
}
async function importar(h, arquivos) {
  const input = h.document.querySelector("input[type=file]");
  Object.defineProperty(input, "files", { value: arquivos, configurable: true });
  input.dispatchEvent(new h.window.Event("change"));
  await h.estabilizar(60);
}
const nomesMaterial = h => [...h.document.querySelectorAll("#materialLista .t-lesson-row .t")].map(e => e.textContent);

test("material: falha de leitura de PDF (ArrayBuffer) e de imagem (DataURL) não anexa e não chama o OCR", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  try {
    readerQueFalha(h, ["apostila.pdf", "foto.png"]);
    await importar(h, [
      new h.window.File(["%PDF"], "apostila.pdf", { type: "application/pdf" }),
      new h.window.File(["PNG"], "foto.png", { type: "image/png" }),
    ]);
    const t = h.toasts.join("|");
    assert.match(t, /Não foi possível extrair texto de "apostila\.pdf"/);
    assert.match(t, /Não foi possível extrair texto de "foto\.png"/);
    assert.deepEqual(nomesMaterial(h), []);
    assert.equal(h.ia.chamadas.length, 0, "sem dataURL não há chamada de OCR");
    assert.deepEqual(h.errosJs(), []);
  } finally { h.fechar(); }
});

async function corretorAuto(h) {
  await h.clicar(/Corretor/);
  h.App.setNumQuestoes(2);
  h.App.setCorretorCampo("alunoId", "a1");
  h.App.setCorretorModo("auto");
  ["A", "B"].forEach((x, i) => h.App.setGabaritoResp(i, x));
  h.App.corretorAvancarGabarito(); await h.estabilizar();
}
test("corretor: foto que o FileReader não consegue ler é recusada com aviso", async () => {
  const h = await abrirProfessor({});
  try {
    await corretorAuto(h);
    readerQueFalha(h, ["prova.jpg"]);
    h.App.onSelecionarFotoProva({ files: [new h.window.File(["x"], "prova.jpg", { type: "image/jpeg" })], value: "" });
    await h.estabilizar(40);
    assert.match(h.toasts.join("|"), /Não consegui ler essa imagem/);
    assert.equal(h.document.querySelectorAll(".corretor-thumb").length, 0);
  } finally { h.fechar(); }
});

test("corretor: se o pré-processamento não decodifica a imagem, envia a foto ORIGINAL à IA", async () => {
  const h = await abrirProfessor({});
  try {
    await corretorAuto(h);
    // 1ª imagem (compressão) decodifica; as seguintes (pré-processamento) falham
    let n = 0;
    h.window.Image = class {
      set src(v) {
        this._src = v; const i = n++;
        Promise.resolve().then(() => { if (i === 0) { this.width = 100; this.height = 100; this.onload(); } else this.onerror(); });
      }
    };
    h.App.onSelecionarFotoProva({ files: [new h.window.File(["x"], "prova.jpg", { type: "image/jpeg" })], value: "" });
    await h.aguardar(() => /1\/3 foto/.test(h.texto()));
    const original = h.document.querySelector(".corretor-thumb img").getAttribute("src");
    h.ia.fila(JSON.stringify({ leituras: [{ questao: 1, alternativa_marcada: "A", confianca: "alta" }, { questao: 2, alternativa_marcada: "B", confianca: "alta" }] }));
    await h.clicar(/Ler marcações com IA/);
    await h.aguardar(() => /Confirme as marcações lidas/.test(h.texto()));
    const img = h.ia.chamadas[0].body.messages[0].content.find(c => c.type === "image_url");
    assert.equal(img.image_url.url, original);
  } finally { h.fechar(); }
});

test("cada estilo de voz aplica seu rate/pitch e sua frase de acerto na leitura", async () => {
  const esperado = {
    podcast: [0.95, 1.0, /Isso aí! Resposta correta!/],
    audiolivro: [0.75, 1.05, /^Correto\.$/],
    robo: [0.9, 0.7, /Bip bip! Resposta correta detectada!/],
    rapido: [1.2, 1.0, /^Correto!$/],
    contadora: [0.7, 1.3, /Uau! Que aluno incrível!/],
  };
  for (const [estilo, [rate, pitch, frase]] of Object.entries(esperado)) {
    const h = await A.iniciarClassico({ local: { audioConfig: JSON.stringify({ estilo, estiloManual: true }) } });
    try {
      await h.clicar(/Ouvir a pergunta/);
      // estilos com frase de abertura (Contadora) só falam o enunciado depois que ela termina
      for (let i = 0; i < 3 && !h.fala.faladas.some(x => /Quanto é/.test(x.text)); i++) { h.fala.synth.terminar(); await h.avancar(500); }
      const u = h.fala.faladas.find(x => /Quanto é/.test(x.text));
      assert.ok(u, estilo + ": enunciado falado");
      assert.ok(Math.abs(u.rate - rate) < 1e-9, `${estilo}: rate ${u.rate}`);
      assert.equal(u.pitch, pitch, estilo + ": pitch");
      await A.acertar(h);
      assert.match(h.fala.textos().pop(), frase, estilo + ": frase de acerto");
    } finally { h.fechar(); }
  }
});

test("interpretação: exercícios que a IA mande já na etapa 1 (texto) são descartados — as questões vêm das etapas 2 e 3", async () => {
  const h = await abrirProfessor({});
  try {
    h.App.teacherSelectSubj("por"); await h.estabilizar();
    await h.clicar(/Criar nova lição/);
    await h.clicar(h.document.querySelectorAll(".tipo-card")[1]);
    await h.preencher("itTema", "amizade");
    await h.preencher("itGenero", "Fábula");
    const etapa1 = JSON.stringify({ titulo_texto: "O Sapo", genero: "Fábula", texto: "Era uma vez um sapo.",
      exercicios: [{ tipo: "multipla_escolha", enunciado: "Pergunta intrusa da etapa 1?", opcoes: ["a", "b"], resposta_correta: "a" }] });
    h.ia.fila(etapa1, { status: 503 });
    await h.clicar(/Gerar texto e exercícios/);
    assert.equal(h.campo("lTextoGerado").value, "Era uma vez um sapo.");
    assert.doesNotMatch(h.texto(), /Pergunta intrusa/);
    assert.match(h.texto(), /O texto foi gerado, mas as questões não/);
  } finally { h.fechar(); }
});
