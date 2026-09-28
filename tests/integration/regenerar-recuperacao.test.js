// Regenerar exercícios: recuperação automática das questões inválidas (pede só as que faltam),
// detecção de duplicidade por conteúdo+resposta, mensagens consistentes e logs técnicos.
// Cenário base = o caso relatado: lição com 15 questões de vocabulário de Inglês.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const { abrirProfessor, erroIA, ultimoToast, F } = require("../support/professor-helpers");

const EXPL = "Tudo bem errar! Revise o vocabulário da lição: esta é a tradução correta.";
const PALAVRAS_ATUAIS = [["maçã", "apple"], ["arroz", "rice"], ["ovo", "egg"], ["peixe", "fish"], ["leite", "milk"], ["pão", "bread"], ["suco", "juice"],
  ["queijo", "cheese"], ["carne", "meat"], ["bolo", "cake"], ["água", "water"], ["banana", "banana"], ["uva", "grape"], ["milho", "corn"], ["feijão", "beans"]];
const PALAVRAS_NOVAS = [["pé", "foot"], ["mão", "hand"], ["casa", "house"], ["livro", "book"], ["mesa", "table"], ["cadeira", "chair"], ["porta", "door"],
  ["janela", "window"], ["cama", "bed"], ["escola", "school"], ["gato", "cat"], ["cachorro", "dog"], ["carro", "car"], ["sol", "sun"], ["lua", "moon"],
  ["flor", "flower"], ["árvore", "tree"], ["rio", "river"], ["chuva", "rain"], ["neve", "snow"]];
const niveis = ["facil", "intermediario", "dificil"];
const exAtual = ([pt, en], i) => ({ id: "a" + i, tipo: "mc", nivel: niveis[Math.floor(i / 5)], enunciado: `Qual é a palavra em inglês para '${pt}'?`,
  opcoes: [en, en + "s", "the " + en, en + "y"], correta: 0 });
const q = ([pt, en], i, extra) => Object.assign({ nivel: niveis[Math.floor(i / 5) % 3], tipo: "multipla_escolha",
  enunciado: `Qual é a palavra em inglês para '${pt}'?`, opcoes: [en, en + "s", "the " + en, en + "y"], resposta_correta: en, explicacao: EXPL }, extra);
const novas = (de, ate) => PALAVRAS_NOVAS.slice(de, ate).map((p, i) => q(p, de + i));

const seedIng = extra => F.banco(Object.assign({
  professores: { p1: F.professor({ disciplinas: ["ing"], anos: ["3º ano"], turmas: ["A"] }) },
  licoes: { L1: F.licao({ disciplina: "ing", titulo: "Food vocabulary", conteudo: "Vocabulário: comidas e objetos em inglês.", exercicios: PALAVRAS_ATUAIS.map(exAtual) }) },
  progresso: { a1_L1: { alunoId: "a1", licaoId: "L1", acertos: 12, erros: 3, total: 15, percentualAcertos: 80, concluido: true } },
}, extra));
// o conteúdo de estudo preparado ensina o vocabulário cobrado (regra: só se cobra o que foi ensinado)
const VOCAB_ING = PALAVRAS_ATUAIS.concat(PALAVRAS_NOVAS).map(([pt, en]) => `${pt} = ${en}`).join(", ") + ". Maria comprou maçãs e peras na feira: frutas.";
async function abrir(o) {
  const h = await abrirProfessor(Object.assign({ seed: seedIng(), preparo: { extra: VOCAB_ING } }, o));
  h.App.teacherSelectSubj("ing"); await h.estabilizar();
  h.App.editLesson("L1"); await h.estabilizar();
  return h;
}
const copia = v => JSON.parse(JSON.stringify(v));
const regenerar = h => h.clicar(/Regenerar exercícios com IA/);

// ---------------------------------------------------------------------------------------------
test("15 válidas na 1ª tentativa → 1 chamada, grava exatamente 15, histórico dos alunos intacto", async () => {
  const h = await abrir();
  try {
    h.ia.fila(F.json(novas(0, 15)));
    await regenerar(h);
    assert.equal(h.ia.chamadas.length, 1);
    const d = h.store.doc("licoes", "L1");
    assert.equal(d.exercicios.length, 15);
    assert.equal(d.exerciciosVersao, 1);
    assert.match(ultimoToast(h), /15 exercícios novos salvos/);
    assert.deepEqual(copia(h.store.doc("progresso", "a1_L1")), copia(seedIng().progresso.a1_L1), "progresso do aluno intacto");
    assert.ok(d.exercicios.every(e => !("_pos" in e) && !("_explicacao" in e) && !("_exigeApoio" in e)), "sem campos temporários");
  } finally { h.fechar(); }
});

test("CASO RELATADO: 13 recebidas (11 válidas, 9 e 10 parecidas com atuais) → pede só as 4 que faltam, aprova e grava 15", async () => {
  const h = await abrir();
  try {
    // posições 9 e 10: reformulações de questões atuais ("maçã" e "arroz" com outro molde)
    const r1 = novas(0, 8).concat([
      q(["maçã", "apple"], 8, { enunciado: "Como se diz 'maçã' em inglês?" }),
      q(["arroz", "rice"], 9, { enunciado: "Como se escreve 'arroz' em inglês?" }),
    ], novas(8, 11)); // total 13
    let telaDurante = "";
    h.ia.fila(F.json(r1), ch => { telaDurante = h.texto(); return F.json(novas(11, 15)); });
    await regenerar(h);
    assert.equal(h.ia.chamadas.length, 2);
    // progresso mostrado durante a 2ª tentativa
    assert.match(telaDurante, /11 de 15 questões foram validadas\. Estamos gerando 4 novas questões para substituir as que não foram aprovadas\./);
    // a 2ª chamada pede SÓ as 4 que faltam, com aprovadas, rejeitadas e motivos
    const p2 = h.ia.chamadas[1].prompt;
    assert.match(p2, /REPOSIÇÃO — TENTATIVA 2 DE 3/);
    assert.match(p2, /Já foram aprovadas 11 questões\. Gere agora EXATAMENTE 4 questões NOVAS/);
    assert.match(p2, /QUESTÕES JÁ APROVADAS \(não repetir\):\n1\. Qual é a palavra em inglês para 'pé'\? → resposta: foot/);
    assert.match(p2, /QUESTÕES REJEITADAS NA TENTATIVA ANTERIOR[^\n]*\n- "Como se diz 'maçã' em inglês\?" — reformulação superficial de uma questão atual \("Qual é a palavra em inglês para 'maçã'\?"\)/);
    assert.match(p2, /Dificuldade das que faltam: /);
    const d = h.store.doc("licoes", "L1");
    assert.equal(d.exercicios.length, 15, "persistiu o conjunto completo");
    assert.equal(new Set(d.exercicios.map(e => e.enunciado)).size, 15, "sem repetição");
    assert.ok(!d.exercicios.some(e => /Como se (diz|escreve) '(maçã|arroz)'/.test(e.enunciado)), "as reformulações ficaram de fora");
    assert.equal(Object.keys(d.explicacoes).length, 15);
    assert.equal(erroIA(h), "");
  } finally { h.fechar(); }
});

test("tentativas esgotadas → nada gravado; mensagem lista TODAS as rejeições de cada tentativa, numeradas a partir de 1", async () => {
  const h = await abrir();
  try {
    const antes = copia(h.store.dados);
    const r1 = novas(0, 11).concat([
      q(["maçã", "apple"], 11, { enunciado: "Como se diz 'maçã' em inglês?" }),       // 12: parecida com atual
      q(["mão", "hand"], 12, { enunciado: "Como se diz 'mão' em inglês?" }),          // 13: repete a nova nº 2
      q(["lua", "moon"], 13, { resposta_correta: "sol" }),                             // 14: resposta inválida
      q(["sol", "sun"], 14, { enunciado: "According to the text, what is 'sol'?" }),  // 15: sem texto de apoio
    ]);
    h.ia.fila(F.json(r1), "[{ quebrado", { json: true, texto: "" });
    await regenerar(h);
    assert.equal(h.ia.chamadas.length, 3);
    assert.deepEqual(copia(h.store.dados), antes, "banco intacto");
    const m = erroIA(h);
    assert.equal(m, "⚠️ Não foi possível gerar 15 questões válidas após 3 tentativas (11 aprovadas). Os exercícios atuais foram mantidos. " +
      "Tentativa 1 (15 pedidas, 11 aprovadas): foram rejeitadas 4 questões: questão 12 por semelhança com exercícios atuais; questão 13 por repetição entre as novas questões; " +
      "questão 14 por resposta ou alternativas inválidas; questão 15 por ausência de texto de apoio. " +
      "Tentativa 2 (4 pedidas, 0 aprovadas): a IA enviou 4 questões a menos que o pedido. " +
      "Tentativa 3 (4 pedidas, 0 aprovadas): a IA enviou 4 questões a menos que o pedido.");
    assert.equal(h.ia.chamadas.length, 3);
  } finally { h.fechar(); }
});

test("duplicidade: idêntica, reformulação e 'só trocou números' são barradas; mesmo tema com outra informação é aceito (falso positivo antigo)", async () => {
  const h = await abrir({ seed: seedIng({ licoes: { L1: F.licao({ disciplina: "ing", titulo: "Food vocabulary", conteudo: "Vocabulário e contas simples.",
    exercicios: PALAVRAS_ATUAIS.slice(0, 14).map(exAtual).concat([{ id: "a14", tipo: "mc", nivel: "dificil",
      enunciado: "Maria comprou 3 maçãs e 2 peras na feira. Quantas frutas ela comprou?", opcoes: ["5", "6", "4", "7"], correta: 0 }]) }) } }) });
  try {
    const r = novas(0, 11).concat([
      q(["arroz", "rice"], 11),                                                                        // 12: idêntica à atual nº 2
      q(["ovo", "egg"], 12, { enunciado: "Como se diz 'ovo' em inglês?" }),                            // 13: reformulação da atual nº 3
      q(["x", "9"], 13, { enunciado: "Maria comprou 5 maçãs e 4 peras na feira. Quantas frutas ela comprou?", opcoes: ["9", "8", "10", "7"], resposta_correta: "9" }), // 14: só números (compara com a 15ª atual)
      q(["pé", "foot"], 14, { enunciado: "Qual é a palavra em inglês para 'pé'? (parte do corpo)" }), // 15: repete a nova nº 1
    ]);
    h.ia.fila(F.json(r), F.json(novas(11, 15)));
    await regenerar(h);
    const reg = h.logs.map(l => l.match(/exercicios\.tentativa (.*)/)).filter(Boolean).map(m => JSON.parse(m[1]))[0];
    assert.deepEqual(reg.rejeicoes.map(x => `${x.posicao}:${x.motivos.join("+")}`), ["12:repetida_atual", "13:repetida_atual", "14:repetida_atual", "15:duplicada"]);
    assert.equal(reg.validas, 11, "'pé', 'mão', 'casa'… (mesmo molde, outra palavra) foram aceitas");
    assert.equal(h.store.doc("licoes", "L1").exercicios.length, 15);
  } finally { h.fechar(); }
});

test("compara com TODAS as questões atuais (inclusive a última) e aceita a mesma pergunta sobre OUTRO texto de apoio", async () => {
  const TEXTO_A = "Tom has a red bike. He rides it to the park every Sunday with his sister.";
  const TEXTO_B = "Lucy likes to paint. She paints flowers and trees in her small garden.";
  const atuais = PALAVRAS_ATUAIS.slice(0, 14).map(exAtual).concat([{ id: "a14", tipo: "mc", nivel: "dificil", instrucao: "Read the text and answer the question.", textoApoio: TEXTO_A,
    enunciado: "What is the main idea of the text?", opcoes: ["Tom's bike rides", "Cooking", "School", "Rain"], correta: 0 }]);
  const h = await abrir({ seed: seedIng({ licoes: { L1: F.licao({ disciplina: "ing", titulo: "Food vocabulary", conteudo: "Vocabulário e leitura.", exercicios: atuais }) } }) });
  try {
    const leitura = (texto, certa, i) => q(["-", certa], i, { tipo: "interpretacao", instrucao: "Read the text and answer the question.", texto_apoio: texto,
      enunciado: "What is the main idea of the text?", opcoes: [certa, "Cooking", "School", "Rain"], resposta_correta: certa });
    const r = novas(0, 13).concat([leitura(TEXTO_A, "Tom's bike rides", 13), leitura(TEXTO_B, "Lucy's painting", 14)]);
    h.ia.fila(F.json(r), F.json(novas(13, 14)));
    await regenerar(h);
    const reg = h.logs.map(l => l.match(/exercicios\.tentativa (.*)/)).filter(Boolean).map(m => JSON.parse(m[1]))[0];
    assert.deepEqual(reg.rejeicoes.map(x => `${x.posicao}:${x.motivos.join("+")}`), ["14:repetida_atual"], "mesmo texto da 15ª atual = repetida; outro texto = nova");
    const d = h.store.doc("licoes", "L1");
    assert.ok(d.exercicios.some(e => e.textoApoio === TEXTO_B));
    assert.ok(!d.exercicios.some(e => e.textoApoio === TEXTO_A));
  } finally { h.fechar(); }
});

test("IA devolve MAIS questões que o necessário (na reposição também) → usa só as que faltam", async () => {
  const h = await abrir();
  try {
    h.ia.fila(F.json(novas(0, 13).concat([q(["maçã", "apple"], 13)])), F.json(novas(13, 20)));
    await regenerar(h);
    assert.equal(h.ia.chamadas.length, 2);
    assert.match(h.ia.chamadas[1].prompt, /EXATAMENTE 2 questões NOVAS/);
    assert.equal(h.store.doc("licoes", "L1").exercicios.length, 15);
  } finally { h.fechar(); }
});

for (const [nome, falha, re] of [
  ["timeout", { pendurar: true }, /demorou demais/],
  ["limite de uso (429)", { status: 429 }, /Limite de uso atingido/],
  ["indisponível (503)", { status: 503, mensagem: "overloaded" }, /Erro 503 — overloaded/],
]) {
  test(`falha da IA (${nome}) na 2ª tentativa → nada gravado, mensagem de erro e exercícios mantidos`, async () => {
    const h = await abrir();
    try {
      const antes = copia(h.store.dados);
      h.ia.fila(F.json(novas(0, 12)), falha);
      await h.clicar(/Regenerar exercícios com IA/);
      if (falha.pendurar) await h.avancar(60000);
      assert.deepEqual(copia(h.store.dados), antes);
      assert.match(erroIA(h), re);
      assert.match(erroIA(h), /Os exercícios atuais foram mantidos\./);
      assert.equal(h.document.querySelector(".ia-progresso"), null, "aviso de progresso some ao terminar");
      assert.ok(h.tem(/Regenerar exercícios com IA/), "painel volta ao normal");
    } finally { h.fechar(); }
  });
}

test("falha ao gravar depois da recuperação → rollback: banco, editor e histórico intactos", async () => {
  const h = await abrir();
  try {
    const antes = copia(h.store.dados);
    h.store.falhar({ op: "commit", erro: new Error("rede caiu ao gravar") });
    h.ia.fila(F.json(novas(0, 12)), F.json(novas(12, 15)));
    await regenerar(h);
    assert.equal(h.ia.chamadas.length, 2, "recuperou as 3 que faltavam");
    assert.deepEqual(copia(h.store.dados), antes, "commit falhou: nada aplicado");
    assert.match(erroIA(h), /rede caiu ao gravar.*Os exercícios atuais foram mantidos/);
    const enunEditor = [...h.document.querySelectorAll('.ex-edit-card input[oninput*="setExEnun"]')].map(i => i.value);
    assert.equal(enunEditor[0], "Qual é a palavra em inglês para 'maçã'?", "editor com os exercícios antigos");
    assert.ok(h.logs.some(l => /regenerar\.mantido/.test(l)));
  } finally { h.fechar(); }
});

test("cliques repetidos durante a recuperação não disparam outra regeneração", async () => {
  const h = await abrir();
  try {
    let segunda = null;
    h.ia.fila(F.json(novas(0, 12)), ch => { segunda = h.App.regenerarExerciciosIA(); return F.json(novas(12, 15)); });
    await regenerar(h);
    await segunda; await h.estabilizar();
    assert.equal(h.ia.chamadas.length, 2, "o clique no meio não gerou nova chamada");
    assert.equal(h.store.doc("licoes", "L1").exerciciosVersao, 1, "uma única gravação");
  } finally { h.fechar(); }
});

test("logs técnicos: contagens, posições, motivos e similaridade — sem prompt, documento, chave ou dados de aluno", async () => {
  const h = await abrir();
  try {
    h.ia.fila(F.json(novas(0, 12).concat([q(["maçã", "apple"], 12, { enunciado: "Como se diz 'maçã' em inglês?" })])), F.json(novas(12, 15)));
    await regenerar(h);
    const t = h.logs.filter(l => /\[EstudaMais\] exercicios\.tentativa/.test(l)).map(l => JSON.parse(l.slice(l.indexOf("{"))));
    assert.equal(t.length, 2);
    assert.deepEqual({ ...t[0], rejeicoes: undefined }, { licaoId: "L1", tentativa: 1, solicitadas: 15, recebidas: 13, validas: 12, invalidas: 1, faltaramNaResposta: 2, rejeicoes: undefined });
    assert.equal(t[0].rejeicoes[0].posicao, 13);
    assert.deepEqual(t[0].rejeicoes[0].motivos, ["repetida_atual"]);
    assert.equal(t[0].rejeicoes[0].similaridade, 1);
    assert.match(t[0].rejeicoes[0].idTemp, /^id/);
    assert.deepEqual({ ...t[1], rejeicoes: undefined }, { licaoId: "L1", tentativa: 2, solicitadas: 3, recebidas: 3, validas: 3, invalidas: 0, faltaramNaResposta: 0, rejeicoes: undefined });
    assert.ok(h.logs.some(l => /exercicios\.aprovados \{"licaoId":"L1","solicitadas":15,"tentativas":2\}/.test(l)));
    assert.ok(h.logs.some(l => /regenerar\.gravado \{"licaoId":"L1","exercicios":15,"tentativas":2\}/.test(l)));
    const tudo = h.logs.join("\n");
    for (const proibido of ["sk-teste-NAO-REAL", "FONTES DA LIÇÃO", "Vocabulário: comidas", "Ana Souza", "senha", "apple"]) assert.ok(!tudo.includes(proibido), "log não contém: " + proibido);
  } finally { h.fechar(); }
});

test("aluno sem permissão não dispara a regeneração (nenhuma chamada nem escrita)", async () => {
  const prof = await abrir();
  const aluno = await abrirApp({ store: prof.firebase, relogio: prof.relogio, local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" } });
  try {
    const antes = prof.store.log.length;
    await aluno.App.regenerarExerciciosIA(); await aluno.estabilizar();
    assert.equal(aluno.ia.chamadas.length, 0);
    assert.equal(prof.store.log.length, antes);
  } finally { aluno.fechar(); prof.fechar(); }
});

test("REGRESSÃO: regras publicadas bloqueiam uma coleção do batch (permission-denied) → nada muda e a mensagem diz o que fazer", async () => {
  const h = await abrir();
  try {
    const antes = copia(h.store.dados);
    const negado = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    h.store.falhar({ op: "commit", erro: negado });
    h.ia.fila(F.json(novas(0, 15)));
    await regenerar(h);
    assert.deepEqual(copia(h.store.dados), antes, "batch atômico: nenhuma parte aplicada");
    assert.equal(erroIA(h), "⚠️ O banco de dados recusou a gravação: as regras publicadas no Firebase não permitem esta operação. O Administrador precisa publicar o arquivo firestore.rules do projeto (Firebase Console → Firestore → Regras). Nada foi alterado. Os exercícios atuais foram mantidos.");
  } finally { h.fechar(); }
});
