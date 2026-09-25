// Voz (TTS): lista de vozes do aparelho, escolha/teste de voz e de estilo, controle de
// velocidade, persona de Inglês, "ler resumo" e os controles do texto de interpretação.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

const cfg = h => JSON.parse(h.window.localStorage.getItem("audioConfig") || "{}");
const ultima = h => h.fala.faladas[h.fala.faladas.length - 1];

/** O getVoices() do navegador devolve sempre os MESMOS objetos de voz; o fake do harness
 *  cria objetos novos a cada chamada — fixamos a lista para o indexOf do app funcionar. */
function vozesEstaveis(h) {
  const lista = h.window.speechSynthesis.getVoices();
  h.window.speechSynthesis.getVoices = () => lista;
}
async function perfil(o) {
  const h = await A.entrarAluno(o || {});
  vozesEstaveis(h);
  h.App.openProfile(); await h.estabilizar();
  return h;
}

test("perfil: lista só as vozes pt-BR do aparelho; 'Usar' grava a voz e ela passa a ser usada nas leituras", async () => {
  const h = await perfil();
  try {
    const t = h.texto();
    assert.match(t, /Configurações de Áudio/);
    assert.match(t, /português do Brasil/); // "Google português do Brasil" sem o prefixo
    assert.match(t, /Maria/);
    assert.doesNotMatch(t, /US English/, "voz en-US fica fora quando há pt-BR");
    h.App.setAudioVoz(1); await h.estabilizar(); // 2ª voz pt-BR = Microsoft Maria
    assert.equal(cfg(h).vozNome, "Microsoft Maria");
    assert.equal(cfg(h).vozIndex, 1, "índice na lista GLOBAL de vozes");
    assert.match(h.texto(), /✅ Maria/);
    h.App.testarEstilo(); await h.estabilizar();
    assert.equal(ultima(h).voice.name, "Microsoft Maria");
    // índice inválido não muda nada
    h.App.setAudioVoz(99); await h.estabilizar();
    assert.equal(cfg(h).vozNome, "Microsoft Maria");
  } finally { h.fechar(); }
});

test("dropdown de voz (barra de leitura) grava a escolha SEM re-renderizar a tela", async () => {
  const h = await perfil();
  try {
    const antes = h.document.getElementById("app").firstElementChild;
    h.App.setAudioVozDropdown(0);
    assert.equal(cfg(h).vozNome, "Google português do Brasil");
    assert.equal(h.document.getElementById("app").firstElementChild, antes, "mesmo DOM (sem render)");
    h.App.setAudioVozDropdown(5); // inexistente
    assert.equal(cfg(h).vozNome, "Google português do Brasil");
  } finally { h.fechar(); }
});

test("testar voz: fala uma frase fixa com a voz escolhida e o rate do estilo × velocidade (limitado)", async () => {
  const h = await perfil({ local: { audioConfig: JSON.stringify({ estilo: "rapido", vel: 1.5 }) } });
  try {
    h.App.testarVoz(1);
    const u = ultima(h);
    assert.match(u.text, /Eu sou a sua voz de leitura/);
    assert.equal(u.voice.name, "Microsoft Maria");
    assert.equal(u.lang, "pt-BR");
    assert.ok(Math.abs(u.rate - 1.8) < 1e-9, "1.2 (Modo Rápido) × 1.5");
    const n = h.fala.faladas.length;
    h.App.testarVoz(42); // voz inexistente: não fala
    assert.equal(h.fala.faladas.length, n);
  } finally { h.fechar(); }
});

test("testar estilo: intro da persona + frase de exemplo (Robô), com pitch do estilo", async () => {
  const h = await perfil();
  try {
    h.App.setEstiloVoz("robo"); await h.estabilizar();
    h.App.testarEstilo(); await h.estabilizar();
    assert.match(ultima(h).text, /Bip bip\. Iniciando modo de estudo/);
    assert.equal(ultima(h).pitch, 0.7);
    h.fala.synth.terminar(); await h.avancar(300);
    assert.match(ultima(h).text, /Esta é a minha voz\. Vamos aprender juntos!/);
    h.App.setEstiloVoz("nao-existe"); await h.estabilizar();
    assert.equal(cfg(h).estilo, "robo", "estilo desconhecido é ignorado");
  } finally { h.fechar(); }
});

test("slider de velocidade: grava, mostra o valor e destaca o preset correspondente sem re-render", async () => {
  const h = await perfil();
  try {
    h.App.setVelocidadeSlider("1.3");
    assert.equal(cfg(h).vel, 1.3);
    assert.equal(h.document.getElementById("audioVelVal").textContent, "1.30");
    const ativos = [...h.document.querySelectorAll(".audio-seg .audio-opt.ativo")].map(b => b.getAttribute("data-vel"));
    assert.equal(ativos.length, 1);
    assert.equal(Number(ativos[0]), 1.3);
    h.App.setVelocidadeSlider("1.12"); // entre presets: nenhum destacado
    assert.equal(h.document.querySelectorAll(".audio-seg .audio-opt.ativo").length, 0);
  } finally { h.fechar(); }
});

test("vozes que chegam depois (onvoiceschanged) aplicam a voz salva nas próximas leituras", async () => {
  const h = await A.iniciarClassico({ local: { audioConfig: JSON.stringify({ vozNome: "Microsoft Maria" }) } });
  try {
    assert.equal(typeof h.window.speechSynthesis.onvoiceschanged, "function", "o app registra o evento");
    h.window.speechSynthesis.onvoiceschanged();
    await h.clicar(/Ouvir a pergunta/);
    assert.equal(ultima(h).voice.name, "Microsoft Maria");
  } finally { h.fechar(); }
});

test("persona de Inglês repete a palavra entre aspas para reforçar a pronúncia", async () => {
  const lic = F.licao({ disciplina: "ing", titulo: "Fruits", exercicios: [F.mc(1, { enunciado: 'Como se diz maçã? Dica: "apple"' })] });
  const h = await A.iniciarClassico({ seed: { licoes: { L1: lic } }, disc: /Inglês/, licao: /Fruits/ });
  try {
    assert.equal(cfg(h).estilo, "professora_ingles");
    await h.clicar(/Ouvir a pergunta/);
    const falas = h.fala.textos().join(" | ");
    assert.match(falas, /apple\.\.\. apple/);
    assert.doesNotMatch(falas, /"apple"/, "as aspas saem da fala");
  } finally { h.fechar(); }
});

test("lerResumo: 1º toque lê o resumo inteiro, 2º toque para", async () => {
  const h = await A.entrarAluno({});
  try {
    await A.abrirLicao(h);
    h.App.lerResumo(); await h.estabilizar();
    assert.match(ultima(h).text, /O que é somar\?/);
    assert.match(ultima(h).text, /Dica para lembrar/, "o texto todo em uma fala");
    assert.doesNotMatch(ultima(h).text, /##|\*\*/, "marcação não é falada");
    assert.equal(h.window.speechSynthesis.speaking, true);
    h.App.lerResumo(); await h.estabilizar();
    assert.equal(h.window.speechSynthesis.speaking, false);
  } finally { h.fechar(); }
});

test("interpretação: pausarTextoInterp/retomarTextoInterp/pararTextoInterp controlam o leitor", async () => {
  const TEXTO = "Primeiro parágrafo da fábula.\n\nSegundo parágrafo da fábula.";
  const lic = F.licao({ disciplina: "por", titulo: "Fábula", tipo: "interpretacao_texto", conteudo: TEXTO, textoGerado: TEXTO, tituloTexto: "Fábula", generoTextual: "Fábula" });
  const h = await A.entrarAluno({ seed: { licoes: { L1: lic } } });
  try {
    await h.clicar(/Português/); await h.clicar(/Fábula/);
    h.App.ouvirTextoInterp(); await h.estabilizar();
    h.fala.synth.terminar(); await h.avancar(300);
    assert.match(ultima(h).text, /Primeiro parágrafo/);
    // pausar só vale enquanto lê; pausar 2x não duplica
    h.App.pausarTextoInterp(); h.App.pausarTextoInterp(); await h.estabilizar();
    assert.equal(h.fala.synth.paused, true);
    assert.ok(h.tem(/Continuar/));
    h.App.retomarTextoInterp(); await h.estabilizar();
    assert.equal(h.fala.synth.paused, false);
    h.App.pararTextoInterp(); await h.estabilizar();
    assert.equal(h.document.querySelectorAll(".interp-par.lendo").length, 0);
    const n = h.fala.faladas.length;
    h.fala.synth.terminar(); await h.avancar(2000);
    assert.equal(h.fala.faladas.length, n, "parado: não continua para o próximo parágrafo");
    h.App.retomarTextoInterp(); // sem leitura ativa: nada acontece
    assert.equal(h.fala.faladas.length, n);
  } finally { h.fechar(); }
});
