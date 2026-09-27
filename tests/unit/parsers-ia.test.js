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
  "contarPorDificuldade", "acharIndiceCorreto", "compararQuestoes", "validarExerciciosRegenerados",
  "parseJsonObjIA", "parseHistoriaIA", "normalizarHistoria", "detectarCenario", "mapearExerciciosInterp"];
const CONSTS = [];
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
  // posição = ordem na resposta da IA (a partir de 1) + código da categoria + texto do motivo
  assert.deepEqual(j(rej.map(r => `${r.pos}|${r.codigo}|${r.texto}`)), [
    "1|resposta|V/F sem resposta válida", "2|formato|lacuna sem ___ no enunciado", "3|resposta|lacuna sem resposta",
    "4|resposta|alternativas incompletas", "5|resposta|alternativas incompletas", "6|resposta|alternativas repetidas",
    "7|resposta|resposta correta ausente ou ambígua", "9|enunciado|sem enunciado",
  ]);
  assert.equal(rej[0].enunciado, "Q1", "guarda o enunciado (curto) para o prompt de reposição");
  assert.equal(out[0]._pos, 8, "a questão aceita guarda a posição original (8), não a posição depois dos descartes");
});

test("parseExerciciosIA (estrito): opções que só diferem por acento/caixa contam como repetidas", () => {
  const c = novo();
  const rej = [];
  const out = c.parseExerciciosIA(JSON.stringify([{ tipo: "multipla_escolha", enunciado: "Q", opcoes: ["Á", "A", "b"], resposta_correta: "a" }]), { estrito: true, rejeitados: rej });
  assert.equal(out.length, 0);
  assert.match(rej[0].texto, /repetidas|ambígua/);
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
test("compararQuestoes: idêntica, reformulação, só números, mesmo tema com outra informação, negação e outro texto", () => {
  const c = novo();
  const q = (enunciado, certa, extra) => Object.assign({ tipo: "mc", enunciado, opcoes: [certa, "x", "y", "z"], correta: 0 }, extra);
  const tipo = (a, b) => c.compararQuestoes(a, b).tipo;
  assert.equal(tipo(q("Qual é a capital do Brasil?", "Brasília"), q("qual é a CAPITAL do brasil", "Brasília")), "identica");
  assert.equal(tipo(q("Qual é a palavra em inglês para 'maçã'?", "apple"), q("Como se diz 'maçã' em inglês?", "apple")), "superficial", "reformulação");
  assert.equal(tipo(q("Maria tinha 10 figurinhas e ganhou 20. Quantas tem agora?", "30"), q("Maria tinha 12 figurinhas e ganhou 25. Quantas tem agora?", "37")), "superficial", "só números");
  assert.equal(tipo(q("Qual é a palavra em inglês para 'pé'?", "foot"), q("Qual é a palavra em inglês para 'maçã'?", "apple")), "diferente", "mesmo molde, outra palavra (falso positivo antigo: 0,80)");
  assert.equal(tipo(q("Quanto é 3 x 4?", "12"), q("Quanto é 5 x 6?", "30")), "diferente", "exercícios de conta com poucas palavras");
  assert.equal(tipo(q("Qual destas letras é uma vogal?", "A"), q("Qual destas letras não é uma vogal?", "B")), "diferente", "negação conta");
  assert.equal(tipo(q("Qual é a ideia principal do texto?", "x", { textoApoio: "Texto sobre gatos domésticos." }), q("Qual é a ideia principal do texto?", "y", { textoApoio: "Texto sobre rios." })), "diferente", "outro texto de apoio");
  const T = { textoApoio: "Anna walks to school. Her favorite subject is Science." };
  assert.equal(tipo(q("What is Anna's favorite subject?", "Science", T), q("Which subject does Anna like the most?", "Science", T)), "semelhante", "mesmo texto e mesma resposta");
  assert.equal(tipo(q("Qual é uma característica das cidades espontâneas?", "crescem sem planejamento"), q("Qual é uma função das cidades?", "moradia")), "diferente", "mesmo tema, informação diferente");
  assert.equal(tipo(q("Qual é a palavra em inglês para 'pé'? (parte do corpo)", "foot"), q("Qual é a palavra em inglês para 'pé'?", "foot")), "semelhante", "mesma resposta + conteúdo contido (dica extra)");
  assert.equal(tipo(q("Qual é o maior planeta do sistema solar?", "Júpiter"), q("Qual planeta tem a Grande Mancha Vermelha?", "Júpiter")), "diferente", "mesma resposta, perguntas diferentes");
  assert.equal(tipo(q("Quanto é 3 + 4?", "7"), q("Quanto é 5 + 2?", "7")), "diferente", "contas diferentes com o mesmo resultado");
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

test("validarExerciciosRegenerados: mensagem traz TODOS os motivos agrupados, contagem consistente e o que faltou", () => {
  const c = novo();
  // o caso relatado: 15 pedidas, 13 recebidas, 2 recusadas → antes a mensagem citava só 2 motivos para 4 faltando
  const rej = [{ pos: 12, codigo: "resposta", texto: "alternativas repetidas" }, { pos: 14, codigo: "formato", texto: "lacuna sem ___" }];
  const r = c.validarExerciciosRegenerados([], [], 5, rej);
  assert.equal(r.ok, false);
  assert.equal(r.recebidas, 2); assert.equal(r.faltaram, 3);
  assert.equal(r.erro, "0 de 5 questões válidas — foram rejeitadas 2 questões: questão 12 por resposta ou alternativas inválidas; questão 14 por formato inválido. Além disso, a IA enviou 3 questões a menos que o pedido");
  assert.equal(c.validarExerciciosRegenerados(null, null, 1, null).erro, "0 de 1 questões válidas — a IA enviou 1 questão a menos que o pedido");
  // várias questões no mesmo motivo e uma questão com dois motivos
  const base = { tipo: "mc", opcoes: ["a", "b", "c"], correta: 0, _explicacao: "Explicação com mais de vinte caracteres." };
  const atual = { enunciado: "Qual é a capital do Brasil?", tipo: "mc", opcoes: ["Brasília", "b", "c"], correta: 0 };
  const novos = [
    Object.assign({}, base, { _pos: 9, enunciado: "Qual é a capital do Brasil?", opcoes: ["Brasília", "b", "c"] }),
    Object.assign({}, base, { _pos: 10, enunciado: "qual é a CAPITAL do brasil", opcoes: ["Brasília", "x", "y"] }),
    Object.assign({}, base, { _pos: 11, enunciado: "Qual é a capital do Brasil?", opcoes: ["Brasília", "b", "c"], _explicacao: "" }),
  ];
  const r2 = c.validarExerciciosRegenerados(novos, [atual], 3, []);
  assert.equal(r2.rejeicoes.length, 3);
  assert.equal(r2.rejeicoes[2].codigos.join(), "explicacao,repetida_atual", "questão 11 tem dois motivos");
  assert.match(r2.erro, /^0 de 3 questões válidas — foram rejeitadas 3 questões: questões 9, 10 e 11 por semelhança com exercícios atuais; questão 11 por falta de explicação$/);
});

test("validarExerciciosRegenerados: rejeita enunciado curto, tipo inválido, sem correta e sem explicação", () => {
  const c = novo();
  const base = { id: "a", tipo: "mc", enunciado: "Enunciado suficientemente longo", opcoes: ["a", "b", "c"], correta: 0, _explicacao: "Explicação com mais de vinte caracteres." };
  const casos = [
    [Object.assign({}, base, { enunciado: "Curto" }), /questão 1 por enunciado inválido/],
    [Object.assign({}, base, { tipo: "ordenar" }), /questão 1 por tipo de questão não suportado/],
    [Object.assign({}, base, { correta: 5 }), /questão 1 por resposta ou alternativas inválidas/],
    [Object.assign({}, base, { _explicacao: "curta" }), /questão 1 por falta de explicação/],
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
