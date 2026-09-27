// Regras puras das questões de interpretação (texto de apoio) e das fontes da lição.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar-app");

const SUBJ = { mat: { id: "mat", nome: "Matemática" }, ing: { id: "ing", nome: "Inglês" }, his: { id: "his", nome: "História" } };
const ctx = () => carregar({
  funcoes: ["citaTexto", "idiomaProvavel", "compartilhaConteudo", "problemaTextoApoio", "relacionadaAsFontes", "motivoSemContexto",
    "fontesDaLicao", "blocoFontesIA", "regrasFidelidadeIA", "regrasInterpretacaoIA", "parseExerciciosIA", "validarExerciciosRegenerados",
    "exerciciosVisiveis", "exemploJsonExercicios"],
  stubs: { subjById: id => SUBJ[id] },
});
const ANNA = "Anna wakes up early every morning. She has breakfast with her family and then walks to school.";
const leitura = extra => Object.assign({ id: "x1", tipo: "mc", enunciado: "How does Anna go to school?", opcoes: ["By bus", "On foot", "By car", "By train"], correta: 1, textoApoio: ANNA }, extra);

test("citaTexto: reconhece referências a um texto em inglês e português, sem falso positivo em perguntas comuns", () => {
  const c = ctx();
  for (const e of ["According to the text, who is Anna?", "In the text, what time is it?", "Read the passage and answer.", "What does the story say?",
    "De acordo com o texto, quem é Ana?", "Segundo o trecho, onde fica?", "O que o texto diz sobre a água?", "No poema, o autor fala de quê?", "Leia o texto abaixo."])
    assert.equal(c.citaTexto({ enunciado: e }), true, e);
  for (const e of ["Quanto é 2 + 2?", "Qual é a tradução de apple?", "What is the capital of France?", "Texting is fun?", "O contexto histórico da época"])
    assert.equal(c.citaTexto({ enunciado: e }), false, e);
  assert.equal(c.citaTexto({ enunciado: "Who is Anna?", instrucao: "Read the text and answer." }), true, "instrução também conta");
});

test("idiomaProvavel: pt / en / ? (indeterminado para textos curtos)", () => {
  const c = ctx();
  assert.equal(c.idiomaProvavel(ANNA), "en");
  assert.equal(c.idiomaProvavel("Ana acorda cedo e toma café com a família antes de ir para a escola."), "pt");
  assert.equal(c.idiomaProvavel("Science"), "?");
});

test("problemaTextoApoio: aceita interpretação completa; ignora questão comum sem texto", () => {
  const c = ctx();
  assert.equal(c.problemaTextoApoio(leitura(), { subjId: "ing", idade: 11 }), "");
  assert.equal(c.problemaTextoApoio({ tipo: "mc", enunciado: "Qual é a tradução de dog?", opcoes: ["cão", "gato"], correta: 0 }, { subjId: "ing" }), "");
});

test("problemaTextoApoio: recusa texto ausente, curto, longo, fora do idioma, sem relação e resposta na instrução", () => {
  const c = ctx();
  const ing = { subjId: "ing", idade: 8 }; // 8 anos: 80 palavras × 1,5 = 120
  assert.match(c.problemaTextoApoio(leitura({ textoApoio: "", enunciado: "According to the text, how does Anna go?" }), ing), /texto que não veio/);
  assert.match(c.problemaTextoApoio(leitura({ textoApoio: "", _exigeApoio: true }), ing), /texto que não veio/);
  assert.match(c.problemaTextoApoio(leitura({ textoApoio: "Anna walks." }), ing), /curto demais/);
  assert.match(c.problemaTextoApoio(leitura({ textoApoio: (ANNA + " ").repeat(8) }), ing), /longo demais \(\d+ palavras; máximo 120\)/);
  assert.match(c.problemaTextoApoio(leitura({ textoApoio: "Ana acorda cedo todos os dias e vai para a escola a pé com a família." }), ing), /fora do idioma esperado/);
  assert.equal(c.problemaTextoApoio(leitura({ textoApoio: "Ana acorda cedo todos os dias e vai para a escola a pé com a família.", enunciado: "Translate: how does Anna go to school?" }), ing), "", "tradução permite o outro idioma");
  assert.match(c.problemaTextoApoio(leitura({ enunciado: "What color is the planet Mars?", opcoes: ["Red", "Blue", "Green", "Pink"] }), ing), /sem relação com o texto/);
  assert.match(c.problemaTextoApoio(leitura({ instrucao: "Read: Anna goes on foot." }), ing), /entrega a resposta/);
  // disciplina em português: texto e pergunta em português
  const his = { subjId: "his", idade: 12 };
  assert.match(c.problemaTextoApoio(leitura(), his), /fora do idioma esperado/);
  assert.equal(c.problemaTextoApoio({ tipo: "vf", opcoes: ["Verdadeiro", "Falso"], correta: 0, enunciado: "Pedro Álvares Cabral chegou ao Brasil em 1500?",
    textoApoio: "Em 1500, a esquadra comandada por Pedro Álvares Cabral chegou ao litoral da Bahia." }, his), "");
});

test("parseExerciciosIA: 'interpretacao' vira mc/vf/lacuna com textoApoio e instrução; aceita nomes em inglês (supportText, question...)", () => {
  const c = ctx();
  const txt = JSON.stringify([
    { tipo: "interpretacao", instrucao: "Read the text.", texto_apoio: ANNA, enunciado: "How?", opcoes: ["a", "b", "c", "d"], resposta_correta: "b", explicacao: "Porque sim, veja o texto." },
    { type: "reading_comprehension", instruction: "Read the text and answer the question.", supportText: ANNA, question: "Anna walks to school.", correctAnswer: "true", explanation: "Está na segunda frase do texto." },
    { tipo: "interpretacao", texto_apoio: ANNA, enunciado: "Anna has breakfast with her ___.", resposta_correta: "family" },
  ]);
  const out = c.parseExerciciosIA(txt, { estrito: true, rejeitados: [] });
  assert.equal(out.map(e => e.tipo).join(), "mc,vf,fill", "'family' (começa com f) é lacuna, não V/F");
  assert.ok(out.every(e => e.textoApoio === ANNA && e._exigeApoio === true));
  assert.equal(out[0].instrucao, "Read the text.");
  assert.equal(out[1].instrucao, "Read the text and answer the question.");
  assert.equal(out[1].enunciado, "Anna walks to school.");
  assert.equal(out[1]._explicacao, "Está na segunda frase do texto.");
  assert.equal(out[1].correta, 0);
});

test("validarExerciciosRegenerados: várias perguntas com o mesmo texto; limpa campos temporários; recusa só a questão incompleta", () => {
  const c = ctx();
  const E = "Tudo bem errar! A resposta está no texto que você leu.";
  const exs = [
    leitura({ id: "a", _explicacao: E, _exigeApoio: true }),
    leitura({ id: "b", enunciado: "Who does Anna have breakfast with?", opcoes: ["Friends", "Her family", "Teacher", "Alone"], _explicacao: E, _exigeApoio: true }),
    leitura({ id: "c", enunciado: "According to the text, when does Anna wake up?", textoApoio: "", _explicacao: E }),
  ];
  const r = c.validarExerciciosRegenerados(exs, [], 2, [], { subjId: "ing", idade: 11 });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.exercicios.map(e => e.id).join(), "a,b");
  assert.ok(r.exercicios.every(e => e.textoApoio === ANNA && !("_exigeApoio" in e) && !("_explicacao" in e)));
  const r3 = c.validarExerciciosRegenerados(exs, [], 3, [], { subjId: "ing", idade: 11 });
  assert.equal(r3.ok, false);
  assert.match(r3.erro, /2 de 3 questões válidas — questão 3: a pergunta depende de um texto que não veio/);
});

test("relacionadaAsFontes: recusa questão fora das fontes (disciplinas de texto); não se aplica a Matemática/Inglês nem a fontes curtas", () => {
  const c = ctx();
  const fontes = "A Revolução Industrial começou na Inglaterra no século XVIII, com máquinas a vapor, fábricas e trabalho assalariado nas cidades. ".repeat(3);
  const dentro = { enunciado: "Onde começou a Revolução Industrial?", opcoes: ["Inglaterra", "França", "Japão", "Brasil"], correta: 0 };
  const fora = { enunciado: "Qual é o maior planeta do sistema solar?", opcoes: ["Júpiter", "Terra", "Marte", "Vênus"], correta: 0 };
  assert.equal(c.relacionadaAsFontes(dentro, { subjId: "his", fontes }), true);
  assert.equal(c.relacionadaAsFontes(fora, { subjId: "his", fontes }), false);
  assert.equal(c.relacionadaAsFontes(fora, { subjId: "mat", fontes }), true, "Matemática fica de fora da heurística");
  assert.equal(c.relacionadaAsFontes(fora, { subjId: "ing", fontes }), true, "língua estrangeira fica de fora");
  assert.equal(c.relacionadaAsFontes(fora, { subjId: "his", fontes: "curta" }), true, "fontes curtas: sem base para comparar");
});

test("motivoSemContexto: reconhece as duas formas da resposta controlada e ignora textos normais", () => {
  const c = ctx();
  assert.equal(c.motivoSemContexto("CONTEXTO_INSUFICIENTE: o documento está vazio"), "o documento está vazio");
  assert.equal(c.motivoSemContexto('{"erro":"CONTEXTO_INSUFICIENTE","motivo":"só há uma pergunta"}'), "só há uma pergunta");
  assert.equal(c.motivoSemContexto("CONTEXTO_INSUFICIENTE"), "sem detalhes");
  assert.equal(c.motivoSemContexto("## Resumo normal\nTexto de estudo."), null);
  assert.equal(c.motivoSemContexto("x".repeat(900) + "CONTEXTO_INSUFICIENTE"), null, "resposta longa não é a marca controlada");
});

test("fontesDaLicao/blocoFontesIA: texto do professor + documentos, com marcações quando faltam", () => {
  const c = ctx();
  assert.equal(c.fontesDaLicao({ texto: "", materialTexto: "" }).suficiente, false);
  assert.equal(c.fontesDaLicao({ texto: "", materialTexto: "[a.pdf]\nConteúdo do documento" }).suficiente, true);
  const b = c.blocoFontesIA(c.fontesDaLicao({ texto: "Texto do prof", materialTexto: "[a.pdf]\nDoc" }));
  assert.ok(b.indexOf("[TEXTO DO PROFESSOR — fonte principal]\nTexto do prof") >= 0);
  assert.ok(b.indexOf("\n[a.pdf]\nDoc") > b.indexOf("Texto do prof"), "professor antes dos documentos");
  assert.match(c.blocoFontesIA(c.fontesDaLicao({ texto: "T", materialTexto: "" })), /\(nenhum documento importado\)/);
  assert.match(c.regrasFidelidadeIA("ing"), /ficam em inglês/);
  assert.match(c.regrasFidelidadeIA("his"), /traduza\/adapte para o português/);
  assert.match(c.regrasInterpretacaoIA("ing", 8), /até 80 palavras/);
  assert.match(c.exemploJsonExercicios("ing"), /"texto_apoio": "Anna wakes up/);
});

test("exerciciosVisiveis: tira só a pergunta que cita um texto ausente; lições de interpretação (Português) ficam intactas", () => {
  const c = ctx();
  const exs = [{ id: 1, enunciado: "Quanto é 2+2?" }, { id: 2, enunciado: "According to the text, who?" }, { id: 3, enunciado: "According to the text, why?", textoApoio: ANNA }];
  assert.deepEqual(c.exerciciosVisiveis({ exercicios: exs }).map(e => e.id), [1, 3]);
  assert.deepEqual(c.exerciciosVisiveis({ tipo: "interpretacao_texto", exercicios: exs }).map(e => e.id), [1, 2, 3]);
});
