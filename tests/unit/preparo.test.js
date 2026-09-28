// Peças puras do PREPARO da lição: divisão em partes, fusão de notas, plano, alinhamento.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar-app");

const SUBJ = { mat: { id: "mat", nome: "Matemática" }, his: { id: "his", nome: "História" }, ing: { id: "ing", nome: "Inglês" } };
const ctx = () => carregar({
  funcoes: ["dividirEmBlocos", "mesclarTopicos", "validarPlano", "alinharExercicio", "topicoCoberto", "dividirSecoesMarkdown", "renderizarConteudo",
    "hashFontesLicao", "limitePalavrasConteudo", "parseConteudoCoberto", "situacaoFontes", "documentosAnalisados"],
  stubs: { subjById: id => SUBJ[id], Teacher: { upload: { ativo: false } } },
});
const j = v => JSON.parse(JSON.stringify(v));

test("dividirEmBlocos: partes ≤ limite, cobrem o texto INTEIRO e se sobrepõem", () => {
  const c = ctx();
  const texto = Array.from({ length: 900 }, (_, i) => `Frase ${i} sobre o assunto.`).join(" ") + " FIM";
  const partes = c.dividirEmBlocos(texto);
  assert.ok(partes.length >= 2);
  assert.ok(partes.every(p => p.length <= 12000));
  assert.ok(partes[0].startsWith("Frase 0 ") && partes[partes.length - 1].endsWith("FIM"), "começo e fim presentes");
  for (let k = 1; k < partes.length; k++) assert.ok(partes[k - 1].includes(partes[k].slice(0, 300)), "sobreposição com a parte anterior");
  // reconstrução: juntando as partes (descontando a sobreposição) volta ao texto inteiro
  let rec = partes[0];
  for (let k = 1; k < partes.length; k++) { const ini = rec.lastIndexOf(partes[k].slice(0, 200)); rec = rec.slice(0, ini) + partes[k]; }
  assert.equal(rec, texto);
  assert.deepEqual(j(c.dividirEmBlocos("   ")), []);
  assert.deepEqual(j(c.dividirEmBlocos("curto")), ["curto"]);
});

test("mesclarTopicos: junta o mesmo tópico (normalizado) sem repetir itens; mantém tópicos diferentes", () => {
  const c = ctx();
  const r = c.mesclarTopicos(
    c.mesclarTopicos([], [{ topico: "Máquinas a vapor", conceitos: ["caldeira", "pistão"], textos: ["Texto A"] }]),
    [{ topico: "maquinas a VAPOR", conceitos: ["Caldeira", "trem"] }, { topico: "Cidades", fatos: ["êxodo rural"] }, { topico: "" }, null]);
  assert.equal(r.length, 2);
  assert.deepEqual(j(r[0].conceitos), ["caldeira", "pistão", "trem"]);
  assert.deepEqual(j(r[0].textos), ["Texto A"]);
  assert.equal(r[1].topico, "Cidades");
});

test("validarPlano: exige tópicos com origem, objetivos ligados, descrição considerada e documentos aproveitados", () => {
  const c = ctx();
  const L = { texto: "Uma descrição longa com bastante coisa para ensinar aos alunos hoje.", materialNomes: ["a.pdf"],
    materialNotas: [{ status: "ok", topicos: [{ topico: "X" }] }] };
  const ok = { suficiente: true, topicos: [{ id: "T1", topico: "A", fontes: ["descricao"] }, { id: "T2", topico: "B", fontes: ["[doc1]"] }], objetivos: [{ id: "O1", texto: "Fazer", topicos: ["T1", "T2"] }] };
  assert.equal(c.validarPlano(ok, L).ok, true);
  assert.equal(c.validarPlano(null, L).erro, "a IA não devolveu um plano em JSON");
  assert.equal(c.validarPlano({ suficiente: false, motivo: "vazio" }, L).definitivo, true);
  assert.match(c.validarPlano({ topicos: [], objetivos: [] }, L).erro, /nenhum tópico/);
  assert.match(c.validarPlano({ topicos: [{ id: "T1", topico: "A", fontes: ["inventada"] }], objetivos: [{ texto: "x", topicos: ["T1"] }] }, L).erro, /sem origem/);
  assert.match(c.validarPlano(Object.assign({}, ok, { objetivos: [{ texto: "x", topicos: ["T9"] }] }), L).erro, /objetivos/);
  assert.match(c.validarPlano(Object.assign({}, ok, { topicos: [ok.topicos[1]] }), L).erro, /nenhum tópico veio da descrição/);
  const semDoc = c.validarPlano(Object.assign({}, ok, { topicos: [ok.topicos[0]], objetivos: [{ id: "O1", texto: "x", topicos: ["T1"] }] }), L);
  assert.match(semDoc.erro, /ignorou \[doc1\] a\.pdf/);
  // descrição curta (< 8 palavras) não precisa virar tópico
  assert.equal(c.validarPlano(Object.assign({}, ok, { topicos: [ok.topicos[1]], objetivos: [{ id: "O1", texto: "x", topicos: ["T2"] }] }), Object.assign({}, L, { texto: "Ver apostila." })).ok, true);
});

test("alinharExercicio: seção indicada válida, inferida pelo conteúdo, resposta presente, conta curta e texto de apoio; o resto é 'não ensinado'", () => {
  const c = ctx();
  const conteudo = {
    plano: { topicos: [{ id: "T1", topico: "Máquinas", fontes: ["doc1"] }, { id: "T2", topico: "Vocabulário", fontes: ["descricao"] }], objetivos: [{ id: "O1", texto: "Explicar", topicos: ["T1"] }, { id: "O2", texto: "Traduzir", topicos: ["T2"] }] },
    secoes: [{ id: "S1", titulo: "Máquinas a vapor", topicos: ["T1"], texto: "As máquinas a vapor mudaram as fábricas." }, { id: "S2", titulo: "Palavras", topicos: ["T2"], texto: "sol = sun, gato = cat." }],
  };
  const q = (enunciado, certa, extra) => Object.assign({ tipo: "mc", enunciado, opcoes: [certa, "x", "y", "z"], correta: 0 }, extra);
  const a = c.alinharExercicio(q("O que as máquinas a vapor mudaram?", "as fábricas", { _rastreio: { secao: "S1", objetivo: "O1" } }), conteudo, "his");
  assert.deepEqual(j(a.rastreio), { secao: "S1", topico: "T1", objetivo: "O1", fontes: ["doc1"], verificado: true });
  const inf = c.alinharExercicio(q("Onde as máquinas a vapor trabalhavam?", "nas fábricas"), conteudo, "his");
  assert.equal(inf.rastreio.secao, "S1", "sem indicação: acha a seção que ensina");
  const refErrada = c.alinharExercicio(q("O que as máquinas a vapor mudaram?", "as fábricas", { _rastreio: { secao: "S2" } }), conteudo, "his");
  assert.equal(refErrada.rastreio.secao, "S1", "indicação que não ensina é corrigida pela seção certa");
  assert.equal(c.alinharExercicio(q("What is 'sol' in English?", "sun"), conteudo, "ing").rastreio.secao, "S2", "resposta curta presente na seção");
  const conta = c.alinharExercicio(q("Quanto é 3 x 4?", "12"), conteudo, "mat");
  assert.equal(conta.ok, true); assert.equal(conta.rastreio.verificado, false, "conta curta: não verificável por palavras");
  const leitura = c.alinharExercicio(q("Who rides the bike?", "Tom", { textoApoio: "Tom rides his red bike to the park." }), conteudo, "ing");
  assert.equal(leitura.ok, true); assert.equal(leitura.rastreio.verificado, false, "informação no texto de apoio");
  assert.equal(c.alinharExercicio(q("Qual é a fórmula da fotossíntese das plantas?", "glicose"), conteudo, "his").ok, false);
  assert.equal(c.alinharExercicio(q("Qualquer coisa sobre planetas distantes", "Júpiter"), { secoes: [] }, "his").ok, true, "sem conteúdo (legado): não bloqueia");
});

test("topicoCoberto e dividirSecoesMarkdown", () => {
  const c = ctx();
  const secoes = [{ id: "S1", titulo: "Máquinas", topicos: ["T1"], texto: "Caldeira e pistão." }];
  assert.equal(c.topicoCoberto({ id: "T1", topico: "Máquinas a vapor", conceitos: ["caldeira"] }, secoes), true);
  assert.equal(c.topicoCoberto({ id: "T2", topico: "Cidades", conceitos: ["êxodo"] }, secoes), false, "tópico sem seção");
  assert.equal(c.topicoCoberto({ id: "T1", topico: "Economia", conceitos: ["inflação"] }, secoes), false, "seção marcada, mas não ensina");
  const md = c.dividirSecoesMarkdown("Texto antes.\n## Um\nA\n### sub\nB\n## Dois\nC");
  assert.deepEqual(j(md.map(s => [s.id, s.titulo, s.texto])), [["S1", "Introdução", "Texto antes."], ["S2", "Um", "A\n### sub\nB"], ["S3", "Dois", "C"]]);
});

test("renderizarConteudo, parseConteudoCoberto e limite de palavras por tópico", () => {
  const c = ctx();
  const plano = { topicos: [{ id: "T1" }, { id: "T2" }] };
  const p = c.parseConteudoCoberto(JSON.stringify({ secoes: [{ id: "S1", titulo: "A", topicos: ["T1", "T9"], texto: "x" }, { titulo: "", texto: "y" }], verificacao: ["q?"], resumo_final: ["r"] }), plano, "");
  assert.equal(p.secoes.length, 1, "seção sem título descartada");
  assert.deepEqual(j(p.secoes[0].topicos), ["T1"], "tópico inexistente descartado");
  assert.equal(c.renderizarConteudo(p), "## A\nx\n\n## Verifique se você entendeu\n- q?\n\n## Resumo\n- r");
  assert.equal(c.parseConteudoCoberto("não é json", plano), null);
  assert.equal(c.limitePalavrasConteudo(8, 1), 350);
  assert.equal(c.limitePalavrasConteudo(8, 5), 1100);
  assert.equal(c.limitePalavrasConteudo(15, 40), 3000, "teto");
});

test("hashFontesLicao muda quando qualquer fonte muda (descrição, documento, escopo, disciplina)", () => {
  const c = ctx();
  const base = () => ({ titulo: "T", texto: "Descrição", ano: "3º ano", nivel: "fund1", materialNomes: ["a"], materialNotas: [{ hash: "h1", status: "ok" }] });
  const h0 = c.hashFontesLicao(base(), "his");
  assert.equal(c.hashFontesLicao(base(), "his"), h0, "determinístico");
  for (const mudar of [L => { L.texto += "!"; }, L => { L.materialNotas[0].hash = "h2"; }, L => { L.ano = "4º ano"; }, L => { L.materialNomes.push("b"); }]) {
    const L = base(); mudar(L);
    assert.notEqual(c.hashFontesLicao(L, "his"), h0);
  }
  assert.notEqual(c.hashFontesLicao(base(), "mat"), h0);
});
