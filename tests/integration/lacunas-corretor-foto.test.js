// Corretor de provas — modo AUTOMÁTICO (foto): seleção/compressão de fotos, leitura das
// marcações pela IA (visão), tela de confirmação e correção determinística em JS.
// jsdom não decodifica imagens: substituímos window.Image (o app usa o global na hora da
// chamada) por uma imagem falsa com onload assíncrono.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, F } = require("../support/professor-helpers");

function seed() {
  return F.banco({
    alunos: { a1: F.aluno() },
    correcoes: {
      // correção antiga com respostas por CONTEÚDO (exercita a revalidação por conteúdo)
      C1: { professorId: "p1", alunoNome: "Ana Souza", disciplina: "mat", notaFinal: 0, notaMaxima: 10, conceito: "Insuficiente", dataStr: "01/03/2026",
        questoes: [
          { numero: 1, status: "incorreta", respostaAluno: "B) 3/4", respostaCorreta: "3/4", pontuacao: 0, pontuacaoMaxima: 5 },
          { numero: 2, status: "correta", respostaAluno: "C) 1/3", respostaCorreta: "1/2", pontuacao: 5, pontuacaoMaxima: 5 },
        ] },
    },
  });
}
/** Instala a Image falsa. `falhar` → onerror. Registra os src recebidos. */
function instalarImagem(h, { largura = 2400, altura = 1200, falhar = false } = {}) {
  const srcs = [];
  class ImagemFalsa {
    constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null; }
    set src(v) {
      srcs.push(v); this._src = v;
      Promise.resolve().then(() => {
        if (falhar) { if (this.onerror) this.onerror(new Error("decode")); return; }
        this.width = largura; this.height = altura; if (this.onload) this.onload();
      });
    }
    get src() { return this._src; }
  }
  h.window.Image = ImagemFalsa;
  return srcs;
}
const foto = (h, nome) => new h.window.File(["fake-jpeg-" + nome], nome, { type: "image/jpeg" });
/** Simula o <input type=file> (o app só lê .files e zera .value). */
async function selecionar(h, arquivos) {
  const input = { files: arquivos, value: "C:\\fakepath\\x.jpg" };
  h.App.onSelecionarFotoProva(input);
  await h.aguardar(() => true);
  await h.estabilizar(40);
  return input;
}
/** Abre o corretor já no modo automático, 4 questões, gabarito A B C D, aluno a1. */
async function abrirAuto(o) {
  const h = await abrirProfessor(Object.assign({ seed: seed() }, o || {}));
  await h.clicar(/Corretor/);
  h.App.setNumQuestoes(4);
  h.App.setCorretorCampo("alunoId", "a1");
  h.App.setCorretorModo("auto");
  ["A", "B", "C", "D"].forEach((x, i) => h.App.setGabaritoResp(i, x));
  h.App.corretorAvancarGabarito();
  await h.estabilizar();
  return h;
}
const leituras = (marcas, conf) => JSON.stringify({ leituras: marcas.map((m, i) => ({ questao: i + 1, alternativa_marcada: m, confianca: (conf && conf[i]) || "alta", observacao: "círculo " + m + " preenchido" })) });

test("corretor foto: comprime (redimensiona ≤1024), mostra miniaturas, limite de 3 fotos e remover", async () => {
  const h = await abrirAuto();
  try {
    assert.match(h.texto(), /Modo automático/);
    assert.ok(h.botao(/Ler marcações com IA/).disabled, "sem foto o botão fica desabilitado");
    const criados = [];
    const orig = h.document.createElement.bind(h.document);
    h.document.createElement = tag => { const el = orig(tag); if (tag === "canvas") criados.push(el); return el; };
    instalarImagem(h, { largura: 2400, altura: 1200 });
    const input = await selecionar(h, [foto(h, "a.jpg"), foto(h, "b.jpg")]);
    assert.equal(input.value, "", "o input é limpo para permitir escolher a mesma foto de novo");
    assert.match(h.texto(), /2\/3 foto\(s\)/);
    assert.equal(h.document.querySelectorAll(".corretor-thumb img").length, 2);
    assert.equal(criados[0].width, 1024, "lado maior reduzido para 1024");
    assert.equal(criados[0].height, 512, "proporção mantida");
    await selecionar(h, [foto(h, "c.jpg"), foto(h, "d.jpg")]); // só cabe 1
    assert.match(h.texto(), /3\/3 foto\(s\)/);
    await selecionar(h, [foto(h, "e.jpg")]);
    assert.match(h.toasts.join("|"), /Máximo de 3 fotos por correção/);
    h.App.removerFotoProva(0); await h.estabilizar();
    assert.match(h.texto(), /2\/3 foto\(s\)/);
    assert.equal(h.botao(/Ler marcações com IA/).disabled, false);
    assert.deepEqual(h.errosJs(), []);
  } finally { h.fechar(); }
});

test("corretor foto: imagem ilegível (onerror) avisa e não adiciona", async () => {
  const h = await abrirAuto();
  try {
    instalarImagem(h, { falhar: true });
    await selecionar(h, [foto(h, "ruim.jpg")]);
    assert.match(h.toasts.join("|"), /Não consegui ler essa imagem/);
    assert.equal(h.document.querySelectorAll(".corretor-thumb").length, 0);
  } finally { h.fechar(); }
});

test("corretor automático: IA lê as marcações → confirmação (professor corrige) → nota calculada pelo JS", async () => {
  const h = await abrirAuto();
  try {
    const srcs = instalarImagem(h, { largura: 800, altura: 600 });
    await selecionar(h, [foto(h, "prova.jpg")]);
    // leitura: A, B, D, nenhuma (Q3 com confiança baixa); depois feedback das erradas
    h.ia.fila(leituras(["A", "B", "D", "nenhuma"], ["alta", "alta", "baixa", "media"]),
      JSON.stringify({ porQuestao: { "3": "C é a certa." }, feedbackGeral: "Revise a questão 3.", pontosForca: [], pontosMelhoria: [] }));
    await h.clicar(/Ler marcações com IA/);
    await h.aguardar(() => /Confirme as marcações lidas/.test(h.texto()), { msg: "tela de confirmação" });
    // contrato da chamada de visão: imagem pré-processada em alta resolução + prompt de leitura óptica
    const msg = h.ia.chamadas[0].body.messages[0];
    const imgs = msg.content.filter(c => c.type === "image_url");
    assert.equal(imgs.length, 1);
    assert.equal(imgs[0].image_url.detail, "high");
    assert.match(msg.content.find(c => c.type === "text").text, /leitura óptica.*são 4 questões/s);
    assert.ok(srcs.length >= 2, "a foto passa pelo pré-processamento (contraste/binarização)");
    const t = h.texto();
    assert.match(t, /Confiança: 2 alta · 1 média · 1 baixa/);
    assert.match(t, /círculo D preenchido/, "observação aparece nas questões de confiança não-alta");
    // professor corrige a Q4 (a IA não viu marcação) para C e confirma
    h.App.setRespAluno(3, "C"); await h.estabilizar();
    await h.clicar(/Confirmar e calcular nota/);
    await h.estabilizar();
    const r = h.texto();
    assert.match(r, /Resultado da Correção/);
    assert.match(r, /5\.0\s*NOTA/, "2 de 4 certas (A, B) → 5.0");
    assert.match(r, /50%\s*ACERTOS/);
    assert.match(r, /Questão 3.*Aluno marcou: D.*Resposta correta: C/);
    await h.aguardar(() => /Revise a questão 3/.test(h.texto()), { msg: "feedback da IA" });
    assert.equal(h.ia.chamadas.length, 2);
    assert.equal(Object.keys(h.store.dados.correcoes).length, 1, "nada salvo sem o professor pedir");
  } finally { h.fechar(); }
});

test("corretor automático: muitas leituras com baixa confiança oferecem 'Tentar novamente com mais contraste'", async () => {
  const h = await abrirAuto();
  try {
    instalarImagem(h);
    await selecionar(h, [foto(h, "escura.jpg")]);
    h.ia.fila(leituras(["A", "B", "C", "D"], ["baixa", "baixa", "baixa", "alta"]), leituras(["A", "B", "C", "D"]));
    await h.clicar(/Ler marcações com IA/);
    await h.aguardar(() => /3 questões com baixa confiança/.test(h.texto()));
    await h.clicar(/Tentar novamente com mais contraste/);
    await h.aguardar(() => /Confiança: 4 alta/.test(h.texto()), { msg: "releitura" });
    assert.equal(h.ia.chamadas.length, 2);
    await h.clicar(/Confirmar e calcular nota/);
    assert.match(h.texto(), /10\.0\s*NOTA/);
    assert.equal(h.ia.chamadas.length, 2, "tudo certo: não pede feedback à IA");
  } finally { h.fechar(); }
});

test("corretor automático: erros de leitura voltam à tela da foto com mensagem (sem questões, JSON ruim, rede, timeout)", async () => {
  const casos = [
    [JSON.stringify({ leituras: [] }), /Não consegui identificar questões nesta imagem/],
    ["isto não é json", /Não consegui identificar questões/],
    [{ rede: true }, /Falha ao contatar a IA/],
    [{ status: 429, mensagem: "rate" }, /difícil de ler/],
  ];
  for (const [resp, re] of casos) {
    const h = await abrirAuto();
    try {
      instalarImagem(h);
      await selecionar(h, [foto(h, "p.jpg")]);
      h.ia.fila(resp);
      await h.clicar(/Ler marcações com IA/);
      await h.aguardar(() => re.test(h.texto()), { msg: String(re) });
      assert.match(h.texto(), /Modo automático/, "volta à etapa da foto");
      assert.equal(h.document.querySelectorAll(".corretor-thumb").length, 1, "a foto continua lá");
    } finally { h.fechar(); }
  }
  // timeout de 45s com loading rotativo (mensagens trocam a cada 2s)
  const h = await abrirAuto();
  try {
    instalarImagem(h);
    await selecionar(h, [foto(h, "p.jpg")]);
    h.ia.fila({ pendurar: true });
    await h.clicar(/Ler marcações com IA/);
    await h.estabilizar();
    assert.match(h.texto(), /Analisando a imagem/);
    await h.avancar(2000);
    assert.match(h.document.getElementById("corretorMsg").textContent, /Identificando as questões/);
    await h.aguardar(() => /demorou demais/.test(h.texto()), { max: 60000, passo: 1000, msg: "timeout" });
  } finally { h.fechar(); }
});

test("corretor automático: sem foto ou sem chave de IA não chama a IA", async () => {
  let h = await abrirAuto();
  try {
    h.App.corrigirProva(); await h.estabilizar();
    assert.match(h.texto(), /Adicione a foto da prova/);
    assert.equal(h.ia.chamadas.length, 0);
  } finally { h.fechar(); }
  h = await abrirAuto({ semChave: true });
  try {
    instalarImagem(h);
    await selecionar(h, [foto(h, "p.jpg")]);
    assert.match(h.texto(), /Configure a chave da IA/);
    h.App.corrigirProva(); await h.estabilizar();
    assert.equal(h.ia.chamadas.length, 0);
  } finally { h.fechar(); }
});

test("histórico: abrir correção antiga revalida por CONTEÚDO da resposta (não pelo rótulo)", async () => {
  const h = await abrirProfessor({ seed: seed() });
  try {
    await h.clicar(/Corretor/);
    await h.estabilizar();
    h.App.abrirCorrecao("C1"); await h.estabilizar();
    const t = h.texto();
    // Q1: "B) 3/4" × "3/4" → correta (conteúdo igual); Q2: "C) 1/3" × "1/2" → incorreta
    assert.match(t, /5\.0\s*NOTA/);
    assert.match(t, /Questão 1.*CORRETA/);
    assert.match(t, /Questão 2.*INCORRETA/);
  } finally { h.fechar(); }
});
