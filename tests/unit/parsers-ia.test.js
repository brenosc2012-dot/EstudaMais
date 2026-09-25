// Unitários + CONTRATO das respostas da IA: o que o app aceita/rejeita/normaliza para
// exercícios, histórias (Modo História) e texto de interpretação, e a validação estrita
// da regeneração de exercícios.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar-app");
const F = require("../support/fixtures");

const j = v => JSON.parse(JSON.stringify(v));
const FUNCS = ["norm", "uid", "sanitizarControlesJson", "jsonParseTolerante", "parseExerciciosIA", "normalizarNivelDif",
  "contarPorDificuldade", "acharIndiceCorreto", "similaridadeEnunciados", "validarExerciciosRegenerados",
  "parseJsonObjIA", "parseHistoriaIA", "normalizarHistoria", "detectarCenario", "mapearExerciciosInterp"];
const CONSTS = ["REGEN_SIMILAR_ANTIGA", "REGEN_SIMILAR_NOVA"];
const novo = () => carregar({ funcoes: FUNCS, constantes: CONSTS });

// ---------------- JSON tolerante ----------------
test("sanitizarControlesJson: escapa \\n, \\r e \\t crus só DENTRO de strings", () => {
  const c = novo();
  assert.equal(c.sanitizarControlesJson('{"a":"l1\nl2\tx\r"}\n'), '{"a":"l1\\nl2\\tx\\r"}\n');
  assert.equal(c.sanitizarControlesJson('{"a":"aspas \\" e \n"}'), '{"a":"aspas \\" e \\n"}');
});

test("jsonParseTolerante: aceita JSON normal e com quebras cruas; lixo → undefined", () => {
  const c = novo();
  assert.deepEqual(j(c.jsonParseTolerante('{"x":1}')), { x: 1 });
  assert.deepEqual(j(c.jsonParseTolerante('{"t":"par1\n\npar2"}')), { t: "par1\n\npar2" });
  assert.equal(c.jsonParseTolerante("não é json"), undefined);
  assert.equal(c.jsonParseTolerante(""), undefined);
});

// ---------------- exercícios (contrato) ----------------
test("parseExerciciosIA: mapeia os 3 tipos, nível, cercas ```json e texto em volta", () => {
  const c = novo();
  const txt = "Claro! Aqui está:\n```json\n" + JSON.stringify([
    { nivel: "Fácil", tipo: "multipla_escolha", enunciado: "2+2?", opcoes: ["3", "4", "5", "6"], resposta_correta: "4" },
    { nivel: "INTERMEDIÁRIO", tipo: "verdadeiro_falso", enunciado: "O céu é azul?", resposta_correta: "Verdadeiro" },
    { nivel: "difícil", tipo: "completar_lacunas", enunciado: "A ___ é redonda.", resposta_correta: "Terra" },
  ]) + "\n```\nBons estudos!";
  const out = j(c.parseExerciciosIA(txt));
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(e => [e.tipo, e.nivel]), [["mc", "facil"], ["vf", "intermediario"], ["fill", "dificil"]]);
  assert.equal(out[0].correta, 1);
  assert.deepEqual(out[1].opcoes, ["Verdadeiro", "Falso"]); assert.equal(out[1].correta, 0);
  assert.equal(out[2].resposta, "Terra");
  out.forEach(e => assert.match(e.id, /^id/));
});

test("parseExerciciosIA: resposta por letra, 'falso'/'false', V/F abreviado e tipo vf", () => {
  const c = novo();
  const out = j(c.parseExerciciosIA(JSON.stringify([
    { tipo: "multipla_escolha", enunciado: "Q", opcoes: ["a", "b", "c", "d"], resposta_correta: "C" },
    { tipo: "vf", enunciado: "Q2", resposta_correta: "false" },
    { tipo: "verdadeiro_falso", enunciado: "Q3", resposta_correta: "F" },
    { tipo: "verdadeiro_falso", enunciado: "Q4", resposta_correta: true },
  ])));
  assert.deepEqual(out.map(e => e.correta), [2, 1, 1, 0]);
});

test("parseExerciciosIA: descarta itens sem enunciado e MC com <2 opções; lixo/vazio → []", () => {
  const c = novo();
  const out = j(c.parseExerciciosIA(JSON.stringify([
    { tipo: "multipla_escolha", opcoes: ["a", "b"], resposta_correta: "a" },
    { tipo: "multipla_escolha", enunciado: "Só uma", opcoes: ["a"], resposta_correta: "a" },
    null,
    { tipo: "desconhecido", enunciado: "Vira MC", opcoes: ["x", "y"], resposta_correta: "y" },
  ])));
  assert.equal(out.length, 1); assert.equal(out[0].tipo, "mc"); assert.equal(out[0].correta, 1);
  assert.deepEqual(j(c.parseExerciciosIA("")), []);
  assert.deepEqual(j(c.parseExerciciosIA(null)), []);
  assert.deepEqual(j(c.parseExerciciosIA("{ malformado ")), []);
  assert.deepEqual(j(c.parseExerciciosIA('{"nao":"array"}')), []);
});

test("parseExerciciosIA: enunciado com HTML fica como texto (o app escapa ao renderizar)", () => {
  const c = novo();
  const out = j(c.parseExerciciosIA(JSON.stringify([{ tipo: "completar_lacunas", enunciado: "<img src=x onerror=alert(1)> ___", resposta_correta: "<b>x</b>" }])));
  assert.equal(out[0].enunciado, "<img src=x onerror=alert(1)> ___");
  assert.equal(out[0].resposta, "<b>x</b>");
});

test("parseExerciciosIA (estrito): anota o motivo de cada item rejeitado", () => {
  const c = novo();
  const rej = [];
  const out = c.parseExerciciosIA(JSON.stringify([
    { tipo: "verdadeiro_falso", enunciado: "Q1", resposta_correta: "talvez" },
    { tipo: "completar_lacunas", enunciado: "Sem lacuna", resposta_correta: "x" },
    { tipo: "completar_lacunas", enunciado: "Com ___", resposta_correta: " " },
    { tipo: "multipla_escolha", enunciado: "Q4", opcoes: ["a", "b"], resposta_correta: "a" },
    { tipo: "multipla_escolha", enunciado: "Q5", opcoes: ["a", "b", "c", "d", "e", "f", "g"], resposta_correta: "a" },
    { tipo: "multipla_escolha", enunciado: "Q6", opcoes: ["a", "A", "c"], resposta_correta: "c" },
    { tipo: "multipla_escolha", enunciado: "Q7", opcoes: ["a", "b", "c"], resposta_correta: "z" },
    { tipo: "multipla_escolha", enunciado: "Q8", opcoes: ["a", "b", "c", "d"], resposta_correta: "B", explicacao: "  ok  " },
    {},
  ]), { estrito: true, rejeitados: rej });
  assert.equal(out.length, 1);
  assert.equal(out[0].correta, 1, "letra válida quando nenhum texto casa");
  assert.equal(out[0]._explicacao, "ok");
  assert.deepEqual(j(rej), [
    "questão 1: V/F sem resposta válida", "questão 2: lacuna sem ___ no enunciado", "questão 3: lacuna sem resposta",
    "questão 4: alternativas incompletas", "questão 5: alternativas incompletas", "questão 6: alternativas repetidas",
    "questão 7: resposta correta ausente ou ambígua", "questão 9: sem enunciado",
  ]);
});

test("parseExerciciosIA (estrito): opções que só diferem por acento/caixa contam como repetidas", () => {
  const c = novo();
  const rej = [];
  const out = c.parseExerciciosIA(JSON.stringify([{ tipo: "multipla_escolha", enunciado: "Q", opcoes: ["Á", "A", "b"], resposta_correta: "a" }]), { estrito: true, rejeitados: rej });
  assert.equal(out.length, 0);
  assert.match(rej[0], /repetidas|ambígua/);
});

test("acharIndiceCorreto: texto exato > letra > contém; nada casa → 0; null → 0", () => {
  const c = novo();
  const op = ["Brasil", "Argentina", "Chile"];
  assert.equal(c.acharIndiceCorreto(op, "argentina"), 1);
  assert.equal(c.acharIndiceCorreto(op, "c"), 2);
  assert.equal(c.acharIndiceCorreto(op, "Chil"), 2);
  assert.equal(c.acharIndiceCorreto(op, "Peru"), 0);
  assert.equal(c.acharIndiceCorreto(op, null), 0);
  assert.equal(c.acharIndiceCorreto(op, "Z"), 0, "letra fora da lista");
});

test("normalizarNivelDif / contarPorDificuldade", () => {
  const c = novo();
  assert.equal(c.normalizarNivelDif("FÁCIL"), "facil");
  assert.equal(c.normalizarNivelDif("Intermediária"), "intermediario");
  assert.equal(c.normalizarNivelDif("difícil"), "dificil");
  assert.equal(c.normalizarNivelDif("médio"), "");
  assert.equal(c.normalizarNivelDif(undefined), "");
  assert.deepEqual(j(c.contarPorDificuldade([{ nivel: "facil" }, { nivel: "facil" }, { nivel: "dificil" }, { nivel: "x" }])), { facil: 2, intermediario: 0, dificil: 1 });
  assert.deepEqual(j(c.contarPorDificuldade(null)), { facil: 0, intermediario: 0, dificil: 0 });
});

// ---------------- regeneração: validação ----------------
test("similaridadeEnunciados: idênticos = 1; só números mudando ≠ duplicata; vazios", () => {
  const c = novo();
  assert.equal(c.similaridadeEnunciados("Qual é a capital do Brasil?", "qual é a CAPITAL do brasil"), 1);
  assert.ok(c.similaridadeEnunciados("Quanto é 3 x 4?", "Quanto é 5 x 6?") < 0.5);
  assert.equal(c.similaridadeEnunciados("", ""), 1);
  assert.equal(c.similaridadeEnunciados("?", "!"), 0, "sem palavras e textos diferentes");
  assert.equal(c.similaridadeEnunciados("abc", ""), 0);
});

test("validarExerciciosRegenerados: ok com exatamente n; excedentes descartados; ids das explicações batem", () => {
  const c = novo();
  const rej = [];
  const novos = c.parseExerciciosIA(F.json(F.questoesIA(5)), { estrito: true, rejeitados: rej });
  const r = c.validarExerciciosRegenerados(novos, [{ enunciado: "Pergunta antiga bem diferente sobre geografia" }], 4, rej);
  assert.equal(r.ok, true);
  assert.equal(r.exercicios.length, 4);
  assert.equal(Object.keys(r.explicacoes).sort().join(), r.exercicios.map(e => e.id).sort().join());
  r.exercicios.forEach(e => assert.equal("_explicacao" in e, false));
});

test("validarExerciciosRegenerados: falta de questões → erro com até 3 motivos + contagem do resto", () => {
  const c = novo();
  const rej = ["questão 9: x", "questão 10: y", "questão 11: z", "questão 12: w"];
  const r = c.validarExerciciosRegenerados([], [], 3, rej);
  assert.equal(r.ok, false);
  assert.equal(r.erro, "0 de 3 questões válidas — questão 9: x; questão 10: y; questão 11: z; +1");
  assert.equal(c.validarExerciciosRegenerados(null, null, 1, null).erro, "0 de 1 questões válidas");
});

test("validarExerciciosRegenerados: rejeita enunciado curto, tipo inválido, sem correta e sem explicação", () => {
  const c = novo();
  const base = { id: "a", tipo: "mc", enunciado: "Enunciado suficientemente longo", opcoes: ["a", "b", "c"], correta: 0, _explicacao: "Explicação com mais de vinte caracteres." };
  const casos = [
    [Object.assign({}, base, { enunciado: "Curto" }), /curto demais/],
    [Object.assign({}, base, { tipo: "ordenar" }), /tipo não suportado/],
    [Object.assign({}, base, { correta: 5 }), /sem resposta correta/],
    [Object.assign({}, base, { _explicacao: "curta" }), /sem explicação/],
  ];
  for (const [ex, re] of casos) {
    const r = c.validarExerciciosRegenerados([ex], [], 1, []);
    assert.equal(r.ok, false); assert.match(r.erro, re);
  }
  assert.equal(c.validarExerciciosRegenerados([base], [], 1, []).ok, true);
  const fill = { id: "f", tipo: "fill", enunciado: "Complete a frase com ___", resposta: "x", _explicacao: "Explicação com mais de vinte caracteres." };
  assert.equal(c.validarExerciciosRegenerados([fill], [], 1, []).ok, true, "lacuna não exige 'correta'");
});

// ---------------- história (contrato) ----------------
test("parseHistoriaIA: extrai o objeto de texto com cercas/ruído; inválido → null", () => {
  const c = novo();
  const h = { titulo: "A Missão", cenario: "Espaço", protagonista: "Lia", capitulos: [{ narrativa_intro: "i\ncom quebra", narrativa_acerto: "a", narrativa_erro: "e" }] };
  assert.deepEqual(j(c.parseHistoriaIA("Aqui vai:\n```json\n" + JSON.stringify(h).replace("\\n", "\n") + "\n```")), h);
  assert.equal(c.parseHistoriaIA(""), null);
  assert.equal(c.parseHistoriaIA("sem json"), null);
  assert.equal(c.parseHistoriaIA("{ quebrado"), null);
});

test("normalizarHistoria: garante campos e exatamente nQ capítulos (preenche e apara)", () => {
  const c = novo();
  const n = j(c.normalizarHistoria({ capitulos: [{ narrativa_intro: "1" }] }, 3));
  assert.equal(n.capitulos.length, 3);
  assert.equal(n.capitulos[0].narrativa_intro, "1");
  assert.equal(n.capitulos[2].questao_index, 2);
  for (const k of ["titulo", "cenario", "protagonista", "desfecho_heroi", "desfecho_aprendiz"]) assert.ok(n[k], k);
  assert.equal(j(c.normalizarHistoria({ capitulos: [{}, {}, {}, {}] }, 2)).capitulos.length, 2);
  assert.equal(j(c.normalizarHistoria(null, 1)).capitulos.length, 1);
  assert.equal(j(c.normalizarHistoria({ capitulos: "x", titulo: "T" }, 0)).titulo, "T");
});

test("detectarCenario: palavras-chave → cenário; nada casa → floresta", () => {
  const c = novo();
  assert.equal(c.detectarCenario("Uma nave rumo a outro PLANETA"), "espaco");
  assert.equal(c.detectarCenario("No fundo do oceano"), "mar");
  assert.equal(c.detectarCenario("O castelo do dragão"), "castelo");
  assert.equal(c.detectarCenario("cidade do futuro com robôs"), "cidade");
  assert.equal(c.detectarCenario("pirâmides do Egito"), "deserto");
  assert.equal(c.detectarCenario("floresta encantada"), "floresta");
  assert.equal(c.detectarCenario("sala de aula"), "floresta");
  assert.equal(c.detectarCenario(null), "floresta");
});

// ---------------- interpretação (contrato) ----------------
test("parseJsonObjIA: texto de interpretação com parágrafos crus é aceito; sem objeto → null", () => {
  const c = novo();
  const o = j(c.parseJsonObjIA('```json\n{"titulo_texto":"O Rio","genero":"conto","texto":"Parágrafo 1.\n\nParágrafo 2."}\n```'));
  assert.deepEqual(o, { titulo_texto: "O Rio", genero: "conto", texto: "Parágrafo 1.\n\nParágrafo 2." });
  assert.equal(c.parseJsonObjIA(null), null);
  // sem "{": devolve o que o JSON for; quem chama exige obj.texto e rejeita (gerarTextoInterpIA)
  const arr = c.parseJsonObjIA("[1,2]");
  assert.ok(!(arr && arr.texto));
});

test("mapearExerciciosInterp: reusa o parser; entrada inválida → []", () => {
  const c = novo();
  const out = j(c.mapearExerciciosInterp([{ tipo: "verdadeiro_falso", enunciado: "Q", resposta_correta: "verdadeiro" }]));
  assert.equal(out.length, 1); assert.equal(out[0].tipo, "vf");
  assert.deepEqual(j(c.mapearExerciciosInterp(undefined)), []);
});
