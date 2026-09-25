// Suíte OPCIONAL: chama a OpenAI de verdade com os prompts reais do app e valida só
// requisitos OBJETIVOS da resposta (estrutura, exemplos, tamanho, idioma, formato JSON).
// Desligada por padrão: só registra testes se OPENAI_API_KEY_TESTE estiver definida.
//   OPENAI_API_KEY_TESTE=sk-... npm run test:ai-real
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("../unit/carregar-app");

const CHAVE = process.env.OPENAI_API_KEY_TESTE;
const SUBJ = { mat: { id: "mat", nome: "Matemática" } };
const PURAS = ["norm", "uid", "tipoLabel", "nivelDificuldadeLabel", "contarPorDificuldade", "normalizarNivelDif", "acharIndiceCorreto",
  "sanitizarControlesJson", "jsonParseTolerante", "parseExerciciosIA", "similaridadeEnunciados", "validarExerciciosRegenerados",
  "ehLinguaEstrangeira", "blocoLinguaEstrangeira", "montarPromptResumo", "montarPromptRegenerarExercicios"];

async function chamar(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + CHAVE },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
    signal: AbortSignal.timeout(90000),
  });
  assert.equal(r.status, 200, "OpenAI respondeu " + r.status);
  const j = await r.json();
  return j.choices[0].message.content;
}

if (!CHAVE) {
  console.log("tests/opcional: OPENAI_API_KEY_TESTE não definida — suíte da IA real não registrada.");
} else {
  const ctx = carregar({ funcoes: PURAS, constantes: ["REGEN_SIMILAR_ANTIGA", "REGEN_SIMILAR_NOVA", "LINGUAS_ESTRANGEIRAS"], stubs: {
    subjById: id => SUBJ[id], nomeNivel: () => "Ensino Fundamental I",
    descreverPublicoLicao: () => ({ ano: "3º ano", nivelId: "fund1", idade: 8, frase: "Adapte a linguagem para um aluno do 3º ano, com 8 anos." }),
  } });
  const licao = { titulo: "Adição com reserva", texto: "Na adição com reserva, quando a soma das unidades passa de 9, levamos 1 dezena para a coluna das dezenas.",
    exercicios: [{ id: "e1", tipo: "mc", nivel: "facil", enunciado: "Quanto é 27 + 15?", opcoes: ["42", "32", "312", "43"], correta: 0 }],
    materialTexto: "" };

  test("IA real: texto de estudo tem estrutura didática objetiva", { timeout: 120000 }, async () => {
    const texto = await chamar(ctx.montarPromptResumo(licao, { ano: "3º ano", nivelNome: "Ensino Fundamental I", idade: 8, frase: "" }, "mat"));
    assert.ok((texto.match(/^##\s+/gm) || []).length >= 3, "títulos ##");
    assert.ok((texto.match(/exemplo/gi) || []).length >= 2, "≥2 exemplos");
    assert.match(texto, /cuidado/i, "seção de erros comuns");
    const palavras = texto.split(/\s+/).filter(Boolean).length;
    assert.ok(palavras <= 350 * 1.4, `tamanho aceitável (${palavras} palavras)`);
    assert.match(texto, /\b(você|para|quando|número)\b/i, "português");
    assert.doesNotMatch(texto, /\b42\b/, "não revela a resposta do exercício");
  });

  test("IA real: regenerar exercícios devolve JSON que passa na validação estrita", { timeout: 120000 }, async () => {
    const atuais = [1, 2, 3].map(i => ({ id: "e" + i, tipo: "mc", nivel: "facil", enunciado: `Quanto é ${i}7 + ${i}5?`, opcoes: ["a", "b", "c", "d"], correta: 0 }));
    const texto = await chamar(ctx.montarPromptRegenerarExercicios(Object.assign({}, licao, { nivel: "fund1", ano: "3º ano" }), atuais, 3, "", "mat"));
    const rej = [];
    const r = ctx.validarExerciciosRegenerados(ctx.parseExerciciosIA(texto, { estrito: true, rejeitados: rej }), atuais, 3, rej);
    assert.ok(r.ok, r.erro);
    assert.equal(r.exercicios.length, 3);
  });
}
