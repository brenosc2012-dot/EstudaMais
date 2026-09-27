// Fontes da lição (texto do professor + documentos) na IA e questões de interpretação com
// texto de apoio: geração, validação, persistência, editor, tela do aluno e compatibilidade.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, erroIA, ultimoToast, F } = require("../support/professor-helpers");
const A = require("../support/aluno-helpers");

const TEXTO_ANNA = "Anna wakes up early every morning. She has breakfast with her family and then walks to school. Her favorite subject is Science.";
const EXPL = "Tudo bem errar! Releia o texto: a resposta está na segunda frase.";
const DOC_ING = "[routine.pdf]\n" + TEXTO_ANNA + "\n1. How does Anna go to school?";
const licaoIng = extra => F.licao(Object.assign({
  disciplina: "ing", titulo: "Daily routine",
  conteudo: "Nesta lição lemos textos curtos sobre a rotina diária (daily routine) e respondemos perguntas sobre eles.",
  materialNomes: ["routine.pdf"], materialTipos: ["application/pdf"], materialTexto: DOC_ING,
  exercicios: [F.mc(1), F.mc(2), F.mc(3)],
}, extra));
const seedIng = extra => F.banco({ professores: { p1: F.professor({ disciplinas: ["mat", "ing"] }) }, licoes: { L1: licaoIng(extra) } });

// 3 perguntas sobre o MESMO texto + 12 de vocabulário = 15
const VOCAB = ["apple", "house", "water", "green", "happy", "friend", "window", "orange", "teacher", "yellow", "mother", "garden"];
function leituraIA(i, extra) {
  const q = [
    ["How does Anna go to school?", ["By bus", "By car", "On foot", "By bicycle"], "On foot"],
    ["What is Anna's favorite subject?", ["Math", "Science", "Art", "History"], "Science"],
    ["Who does Anna have breakfast with?", ["Her friends", "Her teacher", "Her family", "Alone"], "Her family"],
  ][i];
  return Object.assign({ nivel: "intermediario", tipo: "interpretacao", instrucao: "Read the text and answer the question.", texto_apoio: TEXTO_ANNA,
    enunciado: q[0], opcoes: q[1], resposta_correta: q[2], explicacao: EXPL }, extra);
}
const vocabIA = (w, i) => ({ nivel: ["facil", "intermediario", "dificil"][i % 3], tipo: "multipla_escolha", enunciado: `Qual é a tradução de "${w}"?`,
  opcoes: [w + " (certa)", w + " (errada 1)", w + " (errada 2)", w + " (errada 3)"], resposta_correta: w + " (certa)", explicacao: EXPL });
const RESP_LEITURA = F.json([0, 1, 2].map(i => leituraIA(i)).concat(VOCAB.map(vocabIA)));

async function editarIng(o) {
  const h = await abrirProfessor(Object.assign({ seed: seedIng(o && o.licao) }, o));
  h.App.teacherSelectSubj("ing"); await h.estabilizar();
  h.App.editLesson("L1"); await h.estabilizar();
  return h;
}
const apoios = h => [...h.document.querySelectorAll('.ex-edit-card textarea[oninput*="setExApoio"]')].map(t => t.value);

// ======================= fontes enviadas à IA =======================
test("gerar exercícios: o texto explicativo E os documentos importados vão no prompt, com prioridade e regras de fidelidade", async () => {
  const h = await editarIng();
  try {
    h.ia.fila(RESP_LEITURA);
    await h.clicar(/Gerar 15 Exercícios com IA/);
    const p = h.ia.ultimoPrompt();
    assert.match(p, /\[TEXTO DO PROFESSOR — fonte principal\]\nNesta lição lemos textos curtos/);
    assert.match(p, /\[DOCUMENTOS IMPORTADOS PELO PROFESSOR[^\n]*\]\n\[routine\.pdf\]\nAnna wakes up early/);
    for (const re of [/NÃO invente fatos/, /siga o TEXTO DO PROFESSOR/, /Não crie exercícios sobre assuntos que não estejam nas fontes/,
      /o aluno NÃO vê os documentos/i, /"texto_apoio"/, /CONTEXTO_INSUFICIENTE/, /ficam em inglês/, /Read the text and answer the question\./])
      assert.match(p, re);
  } finally { h.fechar(); }
});

test("lição só com documentos (sem texto explicativo) gera normalmente; sem nenhuma fonte o botão fica desabilitado e nada é chamado", async () => {
  let h = await editarIng({ licao: { conteudo: "" } });
  try {
    assert.equal(h.botao(/Gerar 15 Exercícios com IA/).disabled, false);
    h.ia.fila(RESP_LEITURA);
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.match(h.ia.ultimoPrompt(), /o professor não escreveu texto explicativo: use os documentos/);
    assert.equal(apoios(h).length, 15);
  } finally { h.fechar(); }
  h = await editarIng({ licao: { conteudo: "", materialTexto: "", materialNomes: [], materialTipos: [] } });
  try {
    assert.equal(h.botao(/Gerar 15 Exercícios com IA/).disabled, true);
    assert.match(h.texto(), /Escreva o texto explicativo ou importe um documento antes de gerar/);
    h.App.gerarExerciciosIA(); h.App.regenerarConteudoIA(); h.App.regenerarExerciciosIA(); await h.estabilizar();
    assert.equal(h.ia.chamadas.length, 0);
  } finally { h.fechar(); }
});

test("regenerar exercícios e regenerar conteúdo usam as MESMAS fontes (texto do professor + documentos)", async () => {
  const h = await editarIng({ licao: { exercicios: [0, 1, 2].map(i => ({ id: "r" + i, tipo: "mc", nivel: "intermediario", instrucao: "Read the text and answer the question.", textoApoio: TEXTO_ANNA, enunciado: ["Where does Anna live?", "When does Anna wake up?", "What does Anna eat?"][i], opcoes: ["a", "b", "c", "d"], correta: 0 })) } });
  try {
    h.ia.fila(F.json([0, 1, 2].map(i => leituraIA(i))));
    await h.clicar(/Regenerar exercícios com IA/);
    const pEx = h.ia.ultimoPrompt();
    h.ia.fila(F.RESUMO_DIDATICO);
    await h.clicar(/Regenerar conteúdo com IA/);
    const pRes = h.ia.ultimoPrompt();
    for (const p of [pEx, pRes]) {
      assert.match(p, /\[TEXTO DO PROFESSOR — fonte principal\]\nNesta lição lemos textos curtos/);
      assert.match(p, /\[routine\.pdf\]\nAnna wakes up early/);
      assert.match(p, /REGRAS DE FIDELIDADE ÀS FONTES/);
    }
    assert.match(pEx, /Destas, 3 de interpretação de texto \(com "texto_apoio"\)/);
    assert.equal(h.store.doc("licoes", "L1").exercicios[0].textoApoio, TEXTO_ANNA, "regeneração gravou o texto de apoio");
  } finally { h.fechar(); }
});

// ======================= geração de interpretação =======================
test("gerar: questões de interpretação trazem o texto de apoio; várias perguntas usam o mesmo texto", async () => {
  const h = await editarIng();
  try {
    h.ia.fila(RESP_LEITURA);
    await h.clicar(/Gerar 15 Exercícios com IA/);
    const comTexto = apoios(h).filter(Boolean);
    assert.equal(comTexto.length, 3);
    assert.ok(comTexto.every(t => t === TEXTO_ANNA), "as 3 perguntas usam o mesmo texto");
    await h.clicar(/Salvar lição/);
    const exs = h.store.doc("licoes", "L1").exercicios;
    const leitura = exs.filter(e => e.textoApoio);
    assert.equal(leitura.length, 3);
    assert.equal(leitura[0].instrucao, "Read the text and answer the question.");
    assert.equal(leitura[0].tipo, "mc", "interpretação é gravada no formato suportado (mc) + textoApoio");
    assert.ok(exs.filter(e => !e.textoApoio).every(e => !("textoApoio" in e) && !("instrucao" in e)), "questões comuns não ganham campos vazios");
  } finally { h.fechar(); }
});

test("gerar: pergunta 'According to the text' SEM texto de apoio é recusada; geração incompleta não troca os exercícios", async () => {
  const semTexto = leituraIA(0, { tipo: "multipla_escolha", enunciado: "According to the text, how does Anna go to school?", texto_apoio: "" });
  const resp = F.json([semTexto, leituraIA(1), leituraIA(2)].concat(VOCAB.map(vocabIA)));
  const h = await editarIng();
  try {
    h.ia.fila(resp, resp);
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.ia.chamadas.length, 2);
    assert.match(erroIA(h), /14 de 15 questões válidas.*depende de um texto que não veio.*Os exercícios atuais foram mantidos/);
    assert.equal(apoios(h).length, 3, "editor continua com os 3 exercícios de antes");
  } finally { h.fechar(); }
});

for (const [nome, item, motivo] of [
  ["tipo interpretacao sem texto_apoio", leituraIA(0, { texto_apoio: "" }), /depende de um texto que não veio/],
  ["texto de apoio em português numa aula de Inglês", leituraIA(0, { texto_apoio: "Ana acorda cedo todos os dias. Ela toma café com a família e vai a pé para a escola." }), /fora do idioma esperado/],
  ["texto de apoio longo demais para a série", leituraIA(0, { texto_apoio: (TEXTO_ANNA + " ").repeat(12) }), /texto de apoio longo demais/],
  ["pergunta sem relação com o texto", leituraIA(0, { enunciado: "What color is the planet Mars?" }), /sem relação com o texto de apoio/],
  ["instrução que entrega a resposta", leituraIA(0, { instrucao: "Read the text: Anna goes On foot." }), /a instrução entrega a resposta/],
  ["alternativas duplicadas", leituraIA(0, { opcoes: ["On foot", "On foot", "By car", "By bus"] }), /alternativas repetidas/],
]) {
  test(`validação da interpretação: ${nome} → recusada`, async () => {
    const resp = F.json([item, leituraIA(1), leituraIA(2)].concat(VOCAB.map(vocabIA)));
    const h = await editarIng();
    try {
      h.ia.fila(resp, resp);
      await h.clicar(/Gerar 15 Exercícios com IA/);
      assert.match(erroIA(h), motivo);
      assert.equal(h.store.escritas().length, 0);
    } finally { h.fechar(); }
  });
}

test("contexto insuficiente: a IA responde de forma controlada → mensagem clara, sem nova tentativa, nada muda", async () => {
  const h = await editarIng();
  try {
    h.ia.fila('{"erro":"CONTEXTO_INSUFICIENTE","motivo":"o documento só tem uma pergunta, sem texto"}');
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.ia.chamadas.length, 1);
    assert.match(erroIA(h), /não têm conteúdo suficiente para gerar os exercícios \(o documento só tem uma pergunta, sem texto\)/);
    assert.equal(apoios(h).length, 3);
    h.store.semear(seedIng()); // (independente) resumo: mesma resposta controlada
    h.ia.fila("CONTEXTO_INSUFICIENTE: as fontes não explicam o tema");
    await h.clicar(/Regenerar conteúdo com IA/);
    assert.equal(h.ia.chamadas.length, 2, "texto de estudo também não repete");
    assert.match(erroIA(h), /não têm informação suficiente para o texto de estudo \(as fontes não explicam o tema\)/);
    assert.equal((h.store.dados.licoes_geradas || {}).L1, undefined);
  } finally { h.fechar(); }
});

// ======================= editor e salvar =======================
test("editor: pergunta que cita um texto sem texto de apoio mostra aviso e não deixa salvar; com texto, salva (aparado)", async () => {
  const h = await editarIng();
  try {
    h.App.setExEnun(0, "According to the text, where does Anna go?");
    h.App.addExercise(); await h.estabilizar(); // re-render mostra o aviso
    assert.match(h.texto(), /A pergunta cita um texto: preencha o "Texto de apoio"/);
    await h.clicar(/Salvar lição/);
    assert.match(ultimoToast(h), /Exercício 1: a pergunta cita um texto — preencha o "Texto de apoio"/);
    assert.equal(h.store.escritas("licoes").length, 0);
    h.App.removeExercise(3); await h.estabilizar();
    h.App.setExApoio(0, "  " + TEXTO_ANNA + "\n  ");
    h.App.setExInstrucao(0, "   ");
    await h.clicar(/Salvar lição/);
    const ex = h.store.doc("licoes", "L1").exercicios[0];
    assert.equal(ex.textoApoio, TEXTO_ANNA);
    assert.ok(!("instrucao" in ex), "instrução vazia não é gravada");
  } finally { h.fechar(); }
});

// ======================= tela do aluno =======================
const ALUNO_LEITURA = [
  { id: "t1", tipo: "mc", nivel: "facil", instrucao: "Read the text and answer the question.", textoApoio: "Line one of the story.\nLine two: Anna walks to school.",
    enunciado: "How does Anna go to school?", opcoes: ["By bus", "On foot", "By car", "By train"], correta: 1 },
  { id: "t2", tipo: "mc", nivel: "facil", enunciado: "Qual é a tradução de apple?", opcoes: ["maçã", "pera", "uva", "banana"], correta: 0 },
];
async function alunoNaLeitura(extra) {
  const seed = F.banco({ licoes: { L1: licaoIng(Object.assign({ exercicios: ALUNO_LEITURA }, extra)) } });
  const h = await A.entrarAluno({ seedCompleto: seed });
  await A.abrirLicao(h, /Inglês/, /Daily routine/);
  await A.irParaClassico(h);
  // posiciona na questão de leitura (a ordem é por dificuldade; ambas são fáceis → ordem original)
  return h;
}

test("aluno: instrução → texto de apoio (bloco destacado) → pergunta → alternativas, nessa ordem", async () => {
  const h = await alunoNaLeitura();
  try {
    const d = h.document;
    const ordem = [".q-instrucao", ".q-apoio", ".q-prompt", "#optWrap"].map(s => d.querySelector(s));
    assert.ok(ordem.every(Boolean), "todos os blocos existem");
    for (let i = 0; i < ordem.length - 1; i++)
      assert.ok(ordem[i].compareDocumentPosition(ordem[i + 1]) & h.window.Node.DOCUMENT_POSITION_FOLLOWING, `bloco ${i} antes do ${i + 1}`);
    const apoio = d.querySelector(".q-apoio");
    assert.equal(apoio.textContent, "Line one of the story.\nLine two: Anna walks to school.", "quebras de linha preservadas");
    assert.equal(apoio.getAttribute("lang"), "en");
    assert.equal(apoio.getAttribute("role"), "region");
    assert.equal(d.querySelector(".q-instrucao").textContent, "Read the text and answer the question.");
  } finally { h.fechar(); }
});

test("aluno: o texto continua visível ao escolher e na correção; questão comum não mostra bloco de texto", async () => {
  const h = await alunoNaLeitura();
  try {
    await A.acertar(h);
    assert.ok(h.document.querySelector(".q-apoio"), "texto visível junto do feedback");
    assert.match(h.texto(), /Muito bem/);
    await h.clicar(/Continuar/);
    assert.match(h.texto(), /Qual é a tradução de apple\?/);
    assert.equal(h.document.querySelector(".q-apoio"), null, "exercício sem texto de apoio: sem bloco");
    assert.equal(h.document.querySelector(".q-instrucao"), null);
  } finally { h.fechar(); }
});

test("aluno: texto de apoio sem instrução ganha o rótulo 'Read the text:'; leitura em voz alta lê o texto antes da pergunta", async () => {
  const exs = [Object.assign({}, ALUNO_LEITURA[0], { instrucao: undefined })];
  const h = await alunoNaLeitura({ exercicios: exs });
  try {
    assert.equal(h.document.querySelector(".q-instrucao").textContent, "Read the text:");
    h.App.lerQuestao(); await h.estabilizar();
    for (let i = 0; i < 6; i++) { h.fala.synth.terminar(); await h.avancar(1500); }
    const falas = h.fala.textos().join(" | ");
    assert.ok(falas.indexOf("Line two: Anna walks to school.") >= 0, "leu o texto");
    assert.ok(falas.indexOf("Line two: Anna walks to school.") < falas.indexOf("How does Anna go to school?"), "texto antes da pergunta");
  } finally { h.fechar(); }
});

test("aluno: conteúdo inseguro no texto de apoio/instrução é exibido como texto (sem HTML executável)", async () => {
  const exs = [Object.assign({}, ALUNO_LEITURA[0], { instrucao: '<img src=x onerror="window.__xss=1">Read:', textoApoio: "<script>window.__xss=2</script> Anna walks to school <b>fast</b>." })];
  const h = await alunoNaLeitura({ exercicios: exs });
  try {
    const app = h.document.getElementById("app");
    assert.equal(app.querySelector(".q-apoio script, .q-apoio b, .q-instrucao img"), null);
    assert.equal(h.window.__xss, undefined);
    assert.match(app.querySelector(".q-apoio").textContent, /<script>window\.__xss=2<\/script> Anna walks/);
  } finally { h.fechar(); }
});

test("compatibilidade: exercícios antigos (só enunciado) seguem funcionando; o que cita um texto ausente fica de fora da tentativa", async () => {
  const antigos = [
    { id: "o1", tipo: "mc", nivel: "facil", enunciado: "Qual é a tradução de dog?", opcoes: ["cachorro", "gato", "pato", "rato"], correta: 0 },
    { id: "o2", tipo: "mc", nivel: "facil", enunciado: "According to the text, what does Tom like?", opcoes: ["a", "b", "c", "d"], correta: 0 },
    { id: "o3", tipo: "vf", nivel: "facil", enunciado: "Cat significa gato.", opcoes: ["Verdadeiro", "Falso"], correta: 0 },
  ];
  const h = await alunoNaLeitura({ exercicios: antigos });
  try {
    assert.match(h.texto(), /Questão 1 de 2/, "a pergunta sem o texto não é apresentada");
    assert.doesNotMatch(h.texto(), /According to the text/);
    assert.equal(h.document.querySelector(".q-apoio"), null);
    await A.errar(h); await A.esperarExplicacao(h);
    await h.clicar(/recomeçar a atividade/);
    assert.match(h.texto(), /Questão 1 de 2/, "reinício também só com as questões respondíveis");
    assert.equal(h.store.doc("licoes", "L1").exercicios.length, 3, "nada é apagado do banco");
  } finally { h.fechar(); }
});

test("Modo História também mostra o texto de apoio antes da pergunta", async () => {
  const hist = { titulo: "A aventura", cenario: "floresta", protagonista: "Léo",
    capitulos: ALUNO_LEITURA.map((_, i) => ({ narrativa_intro: "Capítulo " + (i + 1), narrativa_acerto: "Boa!", narrativa_erro: "Ops." })),
    desfecho_heroi: "Venceu!", desfecho_aprendiz: "Aprendeu!" };
  const seed = F.banco({ licoes: { L1: licaoIng({ exercicios: ALUNO_LEITURA }) }, historias_geradas: { L1: hist } });
  const h = await A.entrarAluno({ seedCompleto: seed });
  try {
    await A.abrirLicao(h, /Inglês/, /Daily routine/);
    await h.avancar(10000); await h.clicar(/Já estudei/);
    await h.clicar(/Modo História/);
    await h.aguardar(() => /Desafio do Caminho/.test(h.texto()));
    const apoio = h.document.querySelector(".q-apoio"), prompt = h.document.querySelector(".q-prompt");
    assert.ok(apoio && prompt);
    assert.ok(apoio.compareDocumentPosition(prompt) & h.window.Node.DOCUMENT_POSITION_FOLLOWING);
  } finally { h.fechar(); }
});

// ======================= texto de estudo =======================
test("texto de estudo do aluno: prompt fundamentado nas fontes; sem nenhuma fonte, não chama a IA", async () => {
  let h = await A.entrarAluno({ seedCompleto: F.banco({ licoes: { L1: licaoIng({ exercicios: ALUNO_LEITURA }) } }) });
  try {
    await A.abrirLicao(h, /Inglês/, /Daily routine/);
    const p = h.ia.chamadas.find(c => /TEXTO DE ESTUDO/.test(c.prompt)).prompt;
    assert.match(p, /\[TEXTO DO PROFESSOR — fonte principal\]\nNesta lição lemos/);
    assert.match(p, /\[routine\.pdf\]\nAnna wakes up/);
    assert.match(p, /interpretação de texto: ensine como localizar informações/);
    assert.match(p, /Não copie documentos longos/);
    assert.match(p, /responda APENAS: CONTEXTO_INSUFICIENTE/);
    assert.doesNotMatch(p, /Line two: Anna walks to school/, "o texto de apoio das questões não vai ao resumo (não entrega respostas)");
  } finally { h.fechar(); }
  h = await A.entrarAluno({ seedCompleto: F.banco({ licoes: { L1: licaoIng({ conteudo: "", materialTexto: "", materialNomes: [], exercicios: ALUNO_LEITURA }) } }) });
  try {
    await A.abrirLicao(h, /Inglês/, /Daily routine/);
    assert.equal(A.chamadasResumo(h.ia), 0);
    assert.match(h.texto(), /O professor ainda não adicionou o conteúdo de estudo desta lição/);
  } finally { h.fechar(); }
});

test("texto de estudo do aluno: IA responde CONTEXTO_INSUFICIENTE → conteúdo do professor, 1 chamada, nada gravado", async () => {
  const h = await A.entrarAluno({ rotas: { resumo: "CONTEXTO_INSUFICIENTE: faltam explicações sobre o tema" } });
  try {
    await A.abrirLicao(h);
    assert.equal(A.chamadasResumo(h.ia), 1);
    assert.match(h.texto(), /Somar é juntar quantidades/);
    assert.equal((h.store.dados.licoes_geradas || {}).L1, undefined);
  } finally { h.fechar(); }
});

// ======================= documentos =======================
test("documento corrompido (DOCX que o leitor não abre) gera mensagem clara no painel e não entra nas fontes", async () => {
  const mammoth = { extractRawText: async () => { throw new Error("Corrupted zip"); } };
  const h = await editarIng({ mammoth });
  try {
    const input = h.document.querySelector("input[type=file]");
    const f = new h.window.File(["PK"], "aula.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    input.dispatchEvent(new h.window.Event("change"));
    await h.estabilizar(60);
    assert.match(h.texto(), /Não foram usados:.*❌ aula\.docx: arquivo corrompido ou ilegível/);
    assert.doesNotMatch(h.App && JSON.stringify(h.store.doc("licoes", "L1").materialNomes), /aula\.docx/);
  } finally { h.fechar(); }
});
