// PREPARO DA LIÇÃO: documentos lidos por inteiro → plano de cobertura → conteúdo de estudo →
// exercícios SÓ do conteúdo (cada questão ligada a uma seção/objetivo) → gravação.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const { abrirProfessor, erroIA, ultimoToast, F } = require("../support/professor-helpers");
const { planoPadrao, conteudoPadrao, VOCAB_TESTES } = require("../support/preparo-helpers");

const j = v => JSON.parse(JSON.stringify(v));
function arquivo(h, nome, conteudo, tipo) { return new h.window.File([conteudo], nome, { type: tipo || "text/plain" }); }
async function importar(h, arquivos) {
  const input = h.document.querySelector("input[type=file]");
  Object.defineProperty(input, "files", { value: arquivos, configurable: true });
  input.dispatchEvent(new h.window.Event("change"));
  await h.estabilizar(60);
}
const nova = () => ({ disciplina: "his", titulo: "Revolução Industrial", ano: "3º ano", turma: "A", nivel: "fund1" });
const DESCRICAO = "A Revolução Industrial começou na Inglaterra no século XVIII.\n\nAs máquinas a vapor mudaram o trabalho nas fábricas.\n\nÚLTIMA-FRASE-DA-DESCRIÇÃO: os trabalhadores passaram a morar nas cidades.";
const seedHis = extra => F.banco({ professores: { p1: F.professor({ disciplinas: ["his"] }) }, licoes: { L1: F.licao(Object.assign(nova(), { conteudo: DESCRICAO, exercicios: [] }, extra)) } });
// conteúdo simulado ensina o vocabulário das questões de teste
const EXTRA_HIS = VOCAB_TESTES + " " + DESCRICAO + " Palavras-chave: trabalho, trabalhadores, século, Revolução Industrial, Inglaterra, fábricas, cidades, máquinas, vapor.";
async function abrirHis(o) {
  o = o || {};
  const h = await abrirProfessor(Object.assign({ seed: seedHis(o.licao), preparo: Object.assign({ extra: EXTRA_HIS }, o.preparoExtra) }, o));
  h.App.teacherSelectSubj("his"); await h.estabilizar();
  h.App.editLesson("L1"); await h.estabilizar();
  return h;
}
// 15 questões sobre o que o conteúdo padrão ensina (VOCAB_TESTES + descrição)
const exQ = (enunciado, certa, i, extra) => Object.assign({ nivel: ["facil", "intermediario", "dificil"][Math.floor(i / 5)], tipo: "multipla_escolha", enunciado,
  opcoes: [certa, certa + " não", "outra coisa " + i, "nenhuma " + i], resposta_correta: certa, explicacao: "Tudo bem errar! Releia a seção do conteúdo de estudo." }, extra);
const LUGARES = ["Inglaterra", "fábricas", "cidades", "máquinas", "vapor"];
const QUINZE = () => Array.from({ length: 15 }, (_, i) => exQ(`Pergunta ${i + 1}: o que a lição diz sobre ${LUGARES[i % 5]} e ${["trabalho", "trabalhadores", "século", "Revolução", "Industrial"][Math.floor(i / 3) % 5]}?`, ["Inglaterra", "vapor", "cidades"][i % 3] + " " + i, i));

// ================================================================== fontes
test("descrição usada por INTEIRO (até a última frase) e todos os anexos processados antes do plano", async () => {
  const h = await abrirHis();
  try {
    await importar(h, [arquivo(h, "a.txt", "Documento A: tecelagem mecânica."), arquivo(h, "b.txt", "Documento B: carvão e ferro."), arquivo(h, "c.txt", "Documento C: jornadas de trabalho.")]);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    const analises = h.preparo.de("analise");
    assert.deepEqual(analises.map(c => c.prompt.match(/do documento "([^"]+)"/)[1]), ["a.txt", "b.txt", "c.txt"], "cada anexo analisado");
    const pp = h.preparo.de("plano")[0].prompt;
    assert.match(pp, /ÚLTIMA-FRASE-DA-DESCRIÇÃO: os trabalhadores passaram a morar nas cidades/, "descrição inteira no plano");
    assert.match(pp, /\[doc1\] a\.txt[\s\S]*\[doc2\] b\.txt[\s\S]*\[doc3\] c\.txt/);
    const topicos = h.App && j(h.store.dados) && null; // (plano só em memória até salvar)
    await h.clicar(/Salvar lição/);
    const c = j(h.store.doc("licoes_geradas", "L1"));
    assert.deepEqual(c.plano.topicos.map(t => t.fontes.join()), ["descricao", "doc1", "doc2", "doc3"], "todas as fontes viraram tópicos");
    assert.equal(topicos, null);
  } finally { h.fechar(); }
});

test("documento MAIOR que o limite de uma chamada: lido em partes com sobreposição, até o FIM (nada descartado)", async () => {
  const h = await abrirHis();
  try {
    const grande = Array.from({ length: 700 }, (_, i) => `Linha ${i} sobre a indústria têxtil e as máquinas.`).join("\n") + "\nMARCA-DO-FIM-DO-DOCUMENTO";
    await importar(h, [arquivo(h, "apostila.txt", grande)]);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    const partes = h.preparo.de("analise").map(c => c.prompt.match(/<<<\n([\s\S]*?)\n>>>/)[1]);
    assert.ok(partes.length >= 3, `em partes (${partes.length})`);
    assert.ok(partes.every(p => p.length <= 12000), "cada parte dentro do limite");
    assert.ok(partes[partes.length - 1].includes("MARCA-DO-FIM-DO-DOCUMENTO"), "o final do documento chegou à IA");
    assert.ok(partes[0].startsWith("Linha 0 "), "o começo também");
    const fimDe0 = partes[0].slice(-300);
    assert.ok(partes[1].includes(fimDe0.slice(-100)), "sobreposição entre partes consecutivas");
    assert.match(h.preparo.de("analise")[0].prompt, new RegExp(`PARTE 1 DE ${partes.length}`));
    assert.match(h.texto(), /apostila\.txt.*✅ analisado por inteiro: \d+ tópico\(s\) em \d+ partes/);
  } finally { h.fechar(); }
});

test("lição só com descrição (sem anexos): nenhuma análise de documento; plano vem da descrição", async () => {
  const h = await abrirHis();
  try {
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.preparo.de("analise").length, 0);
    assert.match(h.preparo.de("plano")[0].prompt, /NOTAS DOS DOCUMENTOS:\n\(nenhum documento\)/);
    assert.match(h.texto(), /Plano de cobertura: 1 tópico\(s\).*fontes usadas: descrição/);
    assert.equal(erroIA(h), "");
  } finally { h.fechar(); }
});

test("descrição curta + anexos: o conteúdo vem dos anexos (descrição curta não é obrigada a virar tópico)", async () => {
  const h = await abrirHis({ licao: { conteudo: "Ver apostila." } });
  try {
    await importar(h, [arquivo(h, "apostila.txt", "A Revolução Industrial começou na Inglaterra com máquinas a vapor nas fábricas e mudou as cidades.")]);
    // plano sem a descrição (só 2 palavras): aceito
    const soDocs = ch => { const p = JSON.parse(planoPadrao(ch)); p.topicos = p.topicos.filter(t => t.fontes[0] !== "descricao"); p.objetivos[0].topicos = p.topicos.map(t => t.id); return JSON.stringify(p); };
    h.preparo = require("../support/preparo-helpers").usarPreparo(h, { plano: soDocs, extra: EXTRA_HIS });
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.preparo.de("plano").length, 1);
    assert.equal(erroIA(h), "");
    assert.match(h.texto(), /fontes usadas: 1 de 1 documento\(s\)/);
  } finally { h.fechar(); }
});

test("plano que IGNORA a descrição ou um documento é pedido de novo, com o motivo", async () => {
  let n = 0;
  const semDescricaoNa1a = ch => { n++; const p = JSON.parse(planoPadrao(ch)); if (n === 1) { p.topicos = p.topicos.filter(t => t.fontes[0] !== "descricao"); p.objetivos[0].topicos = p.topicos.map(t => t.id); } return JSON.stringify(p); };
  const h = await abrirHis({ preparoExtra: { plano: semDescricaoNa1a } });
  try {
    await importar(h, [arquivo(h, "a.txt", "Fábricas e máquinas a vapor na Inglaterra.")]);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    const planos = h.preparo.de("plano");
    assert.equal(planos.length, 2);
    assert.match(planos[1].prompt, /CORRIJA O PLANO ANTERIOR: nenhum tópico veio da descrição do professor/);
    assert.equal(erroIA(h), "");
  } finally { h.fechar(); }
});

test("documento sem conteúdo útil no plano (mesmo após nova tentativa) → segue, mas o professor é avisado (não diz que usou todos)", async () => {
  const ignoraDoc2 = ch => { const p = JSON.parse(planoPadrao(ch)); p.topicos = p.topicos.filter(t => t.fontes[0] !== "doc2"); p.objetivos[0].topicos = p.topicos.map(t => t.id); return JSON.stringify(p); };
  const h = await abrirHis({ preparoExtra: { plano: ignoraDoc2 } });
  try {
    await importar(h, [arquivo(h, "util.txt", "Fábricas e máquinas a vapor na Inglaterra."), arquivo(h, "lista.txt", "Lista de presença da turma.")]);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.preparo.de("plano").length, 2);
    assert.match(h.texto(), /⚠️ Nenhum tópico veio de: lista\.txt \(a IA não encontrou conteúdo útil para a lição\)/);
    assert.match(h.texto(), /fontes usadas: descrição \+ 1 de 2 documento\(s\)/, "não anuncia o documento que ficou de fora");
  } finally { h.fechar(); }
});

test("documento que falhou na leitura: aviso no painel, fica fora das fontes e o resumo das fontes NÃO diz que usou todos", async () => {
  const mammoth = { extractRawText: async () => { throw new Error("Corrupted zip"); } };
  const h = await abrirHis({ mammoth });
  try {
    await importar(h, [arquivo(h, "bom.txt", "Máquinas a vapor nas fábricas da Inglaterra."), arquivo(h, "ruim.docx", "PK", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]);
    assert.match(h.texto(), /❌ ruim\.docx: arquivo corrompido ou ilegível/);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.preparo.de("analise").length, 1, "só o documento lido é analisado");
    assert.doesNotMatch(h.preparo.de("plano")[0].prompt, /ruim\.docx/);
    assert.match(h.texto(), /Documentos: 1 encontrado\(s\) • 1 analisado\(s\) por inteiro/);
  } finally { h.fechar(); }
});

test("geração bloqueada enquanto um documento ainda está sendo lido", async () => {
  let liberar;
  const pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(r => { liberar = () => r({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "Texto do PDF" }] }) }) }); }) }) };
  const h = await abrirHis({ pdfjsLib });
  try {
    const input = h.document.querySelector("input[type=file]");
    Object.defineProperty(input, "files", { value: [arquivo(h, "lento.pdf", "%PDF", "application/pdf")], configurable: true });
    input.dispatchEvent(new h.window.Event("change"));
    await h.estabilizar();
    assert.equal(h.botao(/Gerar 15 Exercícios com IA/).disabled, true, "botão desabilitado durante a leitura");
    assert.match(h.texto(), /Aguarde: documentos sendo processados/);
    h.App.gerarExerciciosIA(); h.App.regenerarConteudoIA(); await h.estabilizar();
    assert.match(h.toasts.join("|"), /Aguarde: ainda há documentos sendo processados/);
    assert.equal(h.preparo.chamadas.length + h.ia.chamadas.length, 0, "nada foi gerado");
    liberar(); await h.estabilizar(40);
    assert.equal(h.botao(/Gerar 15 Exercícios com IA/).disabled, false, "liberado ao terminar");
  } finally { h.fechar(); }
});

// ================================================================== ordem e alinhamento
test("ordem obrigatória: análise → plano → conteúdo → exercícios; exercícios recebem SÓ o conteúdo validado", async () => {
  const ordem = [];
  const reg = (t, f) => ch => { ordem.push(t); return f(ch); };
  const h = await abrirHis({ preparoExtra: { plano: reg("plano", planoPadrao), conteudo: reg("conteudo", ch => conteudoPadrao(ch, EXTRA_HIS)), analise: reg("analise", ch => require("../support/preparo-helpers").analisePadrao(ch)) } });
  try {
    await importar(h, [arquivo(h, "a.txt", "Fábricas e máquinas a vapor.")]);
    h.ia.fila(ch => { ordem.push("exercicios"); return F.json(QUINZE()); });
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.deepEqual(ordem, ["analise", "plano", "conteudo", "exercicios"]);
    const pEx = h.ia.ultimoPrompt();
    assert.match(pEx, /CONTEÚDO DE ESTUDO QUE O ALUNO LEU \(ÚNICA base das questões[^\n]*\n\[S1\] Tema da descrição \(tópicos T1\)/);
    assert.match(pEx, /OBJETIVOS DE APRENDIZAGEM\nO1: /);
    assert.doesNotMatch(pEx, /Fábricas e máquinas a vapor\.\n/, "trecho bruto do documento não vai para os exercícios");
  } finally { h.fechar(); }
});

test("matriz de rastreabilidade: cada exercício salvo aponta seção, tópico, objetivo e fontes (a IA indica; o app confere)", async () => {
  const h = await abrirHis();
  try {
    await importar(h, [arquivo(h, "a.txt", "Fábricas e máquinas a vapor na Inglaterra.")]);
    h.ia.fila(F.json(QUINZE().map((q, i) => Object.assign(q, { secao: i % 2 ? "S2" : "S1", objetivo: "O1" }))));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    await h.clicar(/Salvar lição/);
    const exs = j(h.store.doc("licoes", "L1").exercicios);
    assert.equal(exs.length, 15);
    for (const e of exs) {
      assert.ok(/^S[12]$/.test(e.rastreio.secao), "seção");
      assert.ok(/^T[12]$/.test(e.rastreio.topico), "tópico");
      assert.equal(e.rastreio.objetivo, "O1");
      assert.ok(e.rastreio.fontes.length, "fontes do tópico");
      assert.ok(!("_rastreio" in e), "campo temporário removido");
    }
    const c = j(h.store.doc("licoes_geradas", "L1"));
    assert.deepEqual(c.secoes.map(s => s.id), ["S1", "S2"], "o conteúdo que preparou os exercícios foi gravado junto");
    assert.match(c.resumo, /^## Tema da descrição/);
  } finally { h.fechar(); }
});

test("exercício sobre assunto NÃO ensinado é recusado; só ele é pedido de novo; o conjunto salvo é 100% alinhado", async () => {
  const h = await abrirHis();
  try {
    const r1 = QUINZE();
    r1[6] = exQ("Qual é a fórmula química da fotossíntese das plantas verdes?", "glicose e oxigênio", 6);
    r1[11] = exQ("Quem descobriu o continente da Oceania e a Austrália?", "navegadores europeus", 11);
    h.ia.fila(F.json(r1), F.json([exQ("O que as máquinas a vapor mudaram nas fábricas da Inglaterra?", "vapor extra", 6), exQ("Onde os trabalhadores passaram a morar?", "cidades extra", 11)]));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.ia.chamadas.length, 2);
    assert.match(h.ia.chamadas[1].prompt, /EXATAMENTE 2 questões NOVAS/);
    assert.match(h.ia.chamadas[1].prompt, /"Qual é a fórmula química da fotossíntese das plantas verdes\?" — [^\n]*o assunto não foi ensinado em nenhuma seção do conteúdo de estudo/);
    const enunciados = [...h.document.querySelectorAll('.ex-edit-card input[oninput*="setExEnun"]')].map(i => i.value);
    assert.equal(enunciados.length, 15);
    assert.ok(!enunciados.some(e => /fotossíntese|Oceania/.test(e)));
    const log = h.logs.map(l => l.match(/exercicios\.tentativa (.*)/)).filter(Boolean).map(m => JSON.parse(m[1]))[0];
    assert.deepEqual(log.rejeicoes.map(r => r.posicao), [7, 12]);
    assert.ok(log.rejeicoes.every(r => r.motivos.indexOf("nao_ensinado") >= 0), "motivo: assunto não ensinado (pode vir junto de 'fora das fontes')");
  } finally { h.fechar(); }
});

test("regenerar exercícios de lição sem conteúdo salvo: prepara o conteúdo e grava conteúdo + exercícios no MESMO batch", async () => {
  // lição salva, sem licoes_geradas; os exercícios atuais são contas (outro assunto das novas)
  const h = await abrirHis({ licao: { exercicios: Array.from({ length: 15 }, (_, i) => F.mc(i + 1, { nivel: ["facil", "intermediario", "dificil"][Math.floor(i / 5)] })) } });
  try {
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Regenerar exercícios com IA/);
    assert.deepEqual(h.preparo.chamadas.map(c => c.tipo), ["plano", "conteudo"]);
    const c = j(h.store.doc("licoes_geradas", "L1"));
    assert.ok(c.secoes.length && c.plano && c.resumo, "conteúdo gravado");
    assert.equal(c.exercicios.length, 15);
    const commits = h.store.log.filter(l => l.caminho === "licoes_geradas/L1").length;
    assert.equal(commits, 1, "uma gravação (batch) só");
  } finally { h.fechar(); }
});

// ================================================================== salvar, aluno, erros, segurança
test("salvar leva o conteúdo preparado; o aluno estuda EXATAMENTE esse conteúdo (sem nova chamada à IA)", async () => {
  const h = await abrirHis();
  try {
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    await h.clicar(/Salvar lição/);
    const c = j(h.store.doc("licoes_geradas", "L1"));
    const aluno = await abrirApp({ store: h.firebase, relogio: h.relogio, local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" }, ia: { padrao: "NÃO USAR" } });
    try {
      aluno.App.openSubject("his"); await aluno.estabilizar();
      aluno.App.openLesson("L1"); await aluno.estabilizar();
      assert.match(aluno.texto(), /Tema da descrição/);
      assert.ok(aluno.html().includes("Nesta seção você vai estudar"));
      assert.equal(aluno.ia.chamadas.filter(x => /TEXTO DE ESTUDO/.test(x.prompt)).length, 0);
    } finally { aluno.fechar(); }
    assert.ok(c.preparoHash);
  } finally { h.fechar(); }
});

test("se o professor muda a descrição depois de gerar, o conteúdo preparado deixa de valer: ao salvar, o cache é limpo", async () => {
  const h = await abrirHis();
  try {
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    await h.preencher("lTexto", DESCRICAO + " Parágrafo novo sobre ferrovias.");
    await h.clicar(/Salvar lição/);
    assert.equal(h.store.doc("licoes_geradas", "L1"), undefined, "conteúdo antigo não fica desencontrado das fontes");
  } finally { h.fechar(); }
});

for (const [nome, falha, re] of [
  ["plano: limite de uso (429)", { plano: { status: 429 } }, /Limite de uso atingido/],
  ["conteúdo: indisponível (503)", { conteudo: { status: 503, mensagem: "overloaded" } }, /Erro 503 — overloaded/],
  ["plano: JSON inválido 2x", { plano: "isto não é json" }, /Não foi possível montar o plano de cobertura da lição \(a IA não devolveu um plano em JSON\)/],
]) {
  test(`gerar: falha no preparo (${nome}) → mensagem clara; exercícios atuais e banco intactos; nenhum exercício é pedido`, async () => {
    const h = await abrirHis({ licao: { exercicios: [F.mc(1)] }, preparoExtra: falha });
    try {
      const antes = j(h.store.dados);
      await h.clicar(/Gerar 15 Exercícios com IA/);
      assert.match(erroIA(h), re);
      assert.equal(h.ia.chamadas.length, 0, "exercícios só depois do conteúdo validado");
      assert.equal(h.document.querySelectorAll(".ex-edit-card").length, 1);
      assert.deepEqual(j(h.store.dados), antes);
    } finally { h.fechar(); }
  });
}

test("lição antiga: texto salvo no teto de 60.000 caracteres → documento marcado como possivelmente incompleto (aviso para reimportar)", async () => {
  const texto = "[antigo.pdf]\n" + "Máquinas a vapor e fábricas. ".repeat(2100).slice(0, 59990);
  const h = await abrirHis({ licao: { materialNomes: ["antigo.pdf"], materialTipos: ["application/pdf"], materialTexto: texto } });
  try {
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.match(h.texto(), /⚠️ Texto possivelmente incompleto \(lição antiga\): antigo\.pdf — reimporte/);
    assert.match(h.preparo.de("plano")[0].prompt, /\[doc1\] antigo\.pdf \(texto possivelmente incompleto\)/);
  } finally { h.fechar(); }
});

test("divergência entre as fontes aparece para o professor (a descrição prevalece)", async () => {
  const comDiv = ch => { const p = JSON.parse(planoPadrao(ch)); p.divergencias = ["A descrição diz século XVIII; o documento diz século XIX"]; return JSON.stringify(p); };
  const h = await abrirHis({ preparoExtra: { plano: comDiv } });
  try {
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.match(h.texto(), /⚖️ Divergência entre as fontes: A descrição diz século XVIII; o documento diz século XIX — vale a descrição do professor\./);
  } finally { h.fechar(); }
});

test("segurança: nomes de tópicos vindos da IA/documentos são escapados no painel; logs sem texto das fontes", async () => {
  // nome de tópico com HTML no PLANO (o conteúdo usa títulos seguros; HTML no conteúdo é recusado à parte)
  const mau = ch => { const p = JSON.parse(planoPadrao(ch)); p.topicos[0].topico = '<img src=x onerror="window.__x=1">Tema da descrição'; return JSON.stringify(p); };
  const seguro = ch => conteudoPadrao({ prompt: ch.prompt.replace(/<img[^>]*>/g, "") }, EXTRA_HIS);
  const h = await abrirHis({ preparoExtra: { plano: mau, conteudo: seguro } });
  try {
    await importar(h, [arquivo(h, "a.txt", "SEGREDO-DO-DOCUMENTO fábricas.")]);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.document.querySelector(".preparo-painel img"), null);
    assert.equal(h.window.__x, undefined);
    assert.ok(h.html().includes("&lt;img src=x"));
    const logs = h.logs.join("\n");
    assert.match(logs, /preparo\.documento \{"licaoId":"L1","documento":1,"partes":1/);
    assert.match(logs, /preparo\.conteudo \{"licaoId":"L1","topicos":2/);
    assert.ok(!logs.includes("SEGREDO-DO-DOCUMENTO") && !logs.includes("ÚLTIMA-FRASE"), "sem conteúdo das fontes nos logs");
  } finally { h.fechar(); }
});

test("toast de sucesso só depois de todas as validações; conteúdo reaproveitado na 2ª geração (fontes iguais)", async () => {
  const h = await abrirHis();
  try {
    h.ia.fila(F.json(QUINZE()), F.json(QUINZE().map(q => Object.assign(q, { enunciado: q.enunciado.replace("Pergunta", "Outra pergunta") }))));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.match(ultimoToast(h), /15 exercícios/);
    const planos = h.preparo.de("plano").length;
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.preparo.de("plano").length, planos, "mesmas fontes: não prepara o conteúdo de novo");
  } finally { h.fechar(); }
});

// ================================================================== LaTeX do OCR (bug 25)
// Foto de prova de Matemática: o OCR devolve fórmulas em LaTeX e a IA as copia para o JSON
// da análise com barras simples ("\( \frac{0}{0} \)") → escape inválido → "resposta inválida".
const OCR_LATEX = String.raw`Questão 1. Expressão: \( \frac{0}{0} \) é indeterminada. Imprecisão: \( 7 \cdot 5 = 35 \). Água: \( H_2O \).`;
const analiseLatex = ch => String.raw`{"topicos":[{"topico":"Forma indeterminada","conceitos":["Expressão: \( \frac{0}{0} \)","\( 7 \cdot 5 = 35 \)"],"fatos":["\( H_2O \) é água"]}]}`;

test("análise de documento com LaTeX (OCR de foto de prova) é aceita; o prompt pede fórmulas sem LaTeX", async () => {
  const h = await abrirHis({ preparoExtra: { analise: analiseLatex } });
  try {
    await importar(h, [arquivo(h, "WhatsApp Image 2026-09-27 at 10.18.07.txt", OCR_LATEX)]);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(erroIA(h), "");
    assert.equal(h.preparo.de("analise").length, 1, "aceita de primeira (sem nova tentativa)");
    assert.match(h.preparo.de("analise")[0].prompt, /SEM LaTeX/);
    assert.ok(h.preparo.de("plano")[0].prompt.includes(String.raw`\( \frac{0}{0} \)`), "fórmula preservada nas notas");
    assert.match(ultimoToast(h), /15 exercícios/);
  } finally { h.fechar(); }
});

test("análise fora do formato: pede a MESMA parte mais uma vez (log só com contagens); persistindo → erro e nada gravado", async () => {
  let h = await abrirHis({ preparoExtra: { analise: ["Claro! Aqui estão os tópicos: frações e água.", analiseLatex] } });
  try {
    await importar(h, [arquivo(h, "prova.txt", OCR_LATEX)]);
    h.ia.fila(F.json(QUINZE()));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(erroIA(h), "");
    const an = h.preparo.de("analise");
    assert.equal(an.length, 2);
    assert.match(an[1].prompt, /PARTE 1 DE 1[\s\S]*a resposta anterior não era um JSON válido/);
    const logs = h.logs.join("\n");
    assert.match(logs, /preparo\.documento\.formato \{"licaoId":"L1","documento":1,"parte":1,"tentativa":1,"caracteres":\d+\}/);
    assert.ok(!logs.includes("frações e água") && !logs.includes("frac"), "log sem conteúdo");
  } finally { h.fechar(); }

  h = await abrirHis({ preparoExtra: { analise: "sem json" } });
  try {
    await importar(h, [arquivo(h, "prova.txt", OCR_LATEX)]);
    const antes = j(h.store.doc("licoes", "L1"));
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.equal(h.preparo.de("analise").length, 2, "2 tentativas no total");
    assert.match(erroIA(h), /Não foi possível analisar o documento "prova\.txt" \(resposta inválida da IA na parte 1\)\. Nada foi alterado/);
    assert.equal(h.preparo.de("plano").length, 0);
    assert.deepEqual(j(h.store.doc("licoes", "L1")), antes);
  } finally { h.fechar(); }
});
