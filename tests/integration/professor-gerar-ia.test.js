// Professor: gerar exercícios com IA (substituir/acumular, parser, erros, prompt).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, erroIA, ultimoToast, F } = require("../support/professor-helpers");

const EXPL = "Tudo bem errar! Veja no conteúdo da lição por que esta é a resposta certa.";
// 5 itens com formatos variados (tipos, níveis, resposta por texto/letra) + 10 válidos = 15
const MISTOS = [
  { nivel: "fácil", tipo: "multipla_escolha", enunciado: "Qual é a vogal?", opcoes: ["B", "C", "A", "D"], resposta_correta: "A", explicacao: EXPL },
  { nivel: "Intermediário", tipo: "verdadeiro_falso", enunciado: "Dois mais dois é quatro?", resposta_correta: "Verdadeiro", explicacao: EXPL },
  { nivel: "dificil", tipo: "verdadeiro_falso", enunciado: "Três mais três é sete?", resposta_correta: "falso", explicacao: EXPL },
  { nivel: "dificil", tipo: "completar_lacunas", enunciado: "O dobro de 4 é ___", resposta_correta: "8", explicacao: EXPL },
  { nivel: "facil", tipo: "multipla_escolha", enunciado: "Letra da opção correta", opcoes: ["x", "y", "z", "w"], resposta_correta: "C", explicacao: EXPL },
];
const RESP_MISTA = F.json(MISTOS.concat(F.questoesIA(10)));
// geração incompleta: itens inválidos no meio (o antigo parser os descartava e aceitava o resto)
const RESP_INCOMPLETA = F.json(MISTOS.concat([
  { nivel: "facil", tipo: "multipla_escolha", enunciado: "Opção única", opcoes: ["só uma"], resposta_correta: "só uma", explicacao: EXPL },
  { tipo: "multipla_escolha", opcoes: ["a", "b"] },
]));

function cards(h) { return [...h.document.querySelectorAll(".ex-edit-card")]; }

test("gerar (substituir): troca os exercícios do editor pelos da IA, mapeando tipos/níveis/resposta", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  const c = cards(h);
  assert.equal(c.length, 15, "exatamente a quantidade pedida");
  assert.equal(c[0].querySelector("select").value, "mc");
  assert.equal(c[0].querySelectorAll("select")[1].value, "intermediario", "a lição não tem fáceis: 'fácil' da IA vira intermediária");
  const pick = card => [...card.querySelectorAll(".opt-row .pick")].findIndex(b => /58cc02/.test(b.getAttribute("style")));
  assert.equal(pick(c[0]), 2, "resposta por texto → índice da opção 'A'");
  assert.equal(c[1].querySelector("select").value, "vf"); assert.equal(pick(c[1]), 0);
  assert.equal(c[1].querySelectorAll("select")[1].value, "intermediario");
  assert.equal(pick(c[2]), 1, "falso → índice 1");
  assert.equal(c[3].querySelector("select").value, "fill");
  assert.equal(pick(c[4]), 2, "letra C → índice 2");
  assert.match(ultimoToast(h), /15 exercícios \(.*\)! Revise e salve\./);
  assert.equal(h.store.escritas("licoes").length, 0, "não grava até o professor salvar");
  h.fechar();
});

test("gerar: geração incompleta (itens inválidos, menos de 15) esgota as 3 tentativas e NÃO troca os exercícios atuais", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila(RESP_INCOMPLETA, RESP_INCOMPLETA, RESP_INCOMPLETA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  assert.equal(h.ia.chamadas.length, 3, "até 3 tentativas");
  assert.equal(cards(h).length, 3, "os 3 exercícios atuais continuam");
  assert.match(erroIA(h), /\(5 aprovadas\)\. Os exercícios atuais foram mantidos\. Tentativa 1 \(15 pedidas, 5 aprovadas\): foram rejeitadas 2 questões: questão 6 por resposta ou alternativas inválidas; questão 7 por enunciado inválido\. Além disso, a IA enviou 8 questões a menos que o pedido\./);
  h.fechar();
});

test("gerar: explicações geradas junto vão ao Firestore ao salvar (só das questões não editadas)", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  h.App.setExEnun(0, "Qual destas é uma vogal? (editada)"); // o professor mexe na 1ª
  await h.clicar(/Salvar lição/);
  const d = h.store.doc("licoes", "L1");
  assert.equal(d.exercicios.length, 15);
  const ids = d.exercicios.map(e => e.id);
  assert.equal(Object.keys(d.explicacoes).length, 14, "a questão editada fica sem a explicação antiga");
  assert.equal(d.explicacoes[ids[0]], undefined);
  assert.equal(d.explicacoes[ids[1]], EXPL);
  assert.ok(Object.keys(d.explicacoes).every(k => ids.includes(k)), "nenhuma explicação órfã");
  h.fechar();
});

test("gerar (acumular): soma aos exercícios atuais", async () => {
  const h = await abrirProfessor({ editar: "L1", local: { estudamais_ia_modo_v1: "acumular" } });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  assert.equal(cards(h).length, 3 + 15);
  h.fechar();
});

test("configuração ⚙️: alterna substituir/acumular e persiste no localStorage", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await h.clicar(h.document.querySelector('[title="Configurar"]'));
  h.campo("iaModo").value = "acumular"; h.App.setModoIA("acumular");
  assert.equal(h.window.localStorage.getItem("estudamais_ia_modo_v1"), "acumular");
  h.fechar();
});

test("prompt: descrição e material chegam ao plano/conteúdo; o de exercícios traz faixa etária, conteúdo estudado e regras", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L1: F.licao({ materialNomes: ["apostila.txt"], materialTipos: ["text/plain"], materialTexto: "[apostila.txt]\nMaterial secreto do professor" }) } }, editar: "L1" });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  assert.match(h.preparo.de("analise")[0].prompt, /Material secreto do professor/);
  assert.match(h.preparo.de("plano")[0].prompt, /Somar é juntar quantidades/);
  const p = h.ia.ultimoPrompt();
  assert.match(p, /3º ano do Ensino Fundamental I/);
  assert.match(p, /aproximadamente 8 anos/);
  assert.match(p, /exatamente 15 exercícios/);
  assert.match(p, /CONTEÚDO DE ESTUDO QUE O ALUNO LEU/);
  assert.match(p, /NUNCA a letra/);
  const c = h.ia.chamadas[0];
  assert.equal(c.body.model, "gpt-4o-mini");
  assert.equal(c.headers.Authorization, "Bearer sk-teste-NAO-REAL");
  h.fechar();
});

test("disciplina Inglês acrescenta o bloco de língua estrangeira", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L9: F.licao({ disciplina: "ing", titulo: "Animals" }) } } });
  h.App.teacherSelectSubj("ing"); await h.estabilizar();
  h.App.editLesson("L9"); await h.estabilizar();
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  assert.match(h.ia.ultimoPrompt(), /língua inglesa/);
  assert.match(h.ia.ultimoPrompt(), /Para o tema "Animals"/);
  h.fechar();
});

test("proxy configurado: chama o proxy sem enviar a chave", async () => {
  const seed = F.banco({ config: { openai: { apiKey: "sk-nao-deve-sair", proxyUrl: "https://proxy.exemplo.workers.dev" } } });
  const h = await abrirProfessor({ seed, editar: "L1" });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  const c = h.ia.chamadas[0];
  assert.equal(c.url, "https://proxy.exemplo.workers.dev");
  assert.equal(c.headers.Authorization, undefined);
  assert.doesNotMatch(JSON.stringify(c), /sk-nao-deve-sair/);
  h.fechar();
});

const ERROS = [
  ["401", { status: 401 }, /Erro 401 — Chave da API inválida\./],
  ["429 limite", { status: 429 }, /Erro 429 — Limite de uso atingido/],
  ["503 indisponível", { status: 503, mensagem: "Service Unavailable" }, /Erro 503 — Service Unavailable/],
  ["rede", { rede: true }, /Falha na chamada à OpenAI/],
  ["JSON malformado", "[{ isto não é json", /15 questões válidas após 3 tentativas \(0 aprovadas\).*Tentativa 1 \(15 pedidas, 0 aprovadas\): a IA enviou 15 questões a menos que o pedido/],
  ["array vazio", "[]", /15 questões válidas após 3 tentativas \(0 aprovadas\).*Tentativa 1 \(15 pedidas, 0 aprovadas\): a IA enviou 15 questões a menos que o pedido/],
  ["corpo inválido (JSON quebrado)", { corpoInvalido: true, json: true }, /chegou incompleta/],
  ["stream cortado", { corte: "[{\"enun" }, /interrompida no meio/],
];
for (const [nome, item, re] of ERROS) {
  test(`gerar: erro da IA (${nome}) mostra mensagem e mantém os exercícios atuais`, async () => {
    const h = await abrirProfessor({ editar: "L1" });
    h.ia.fila(item);
    await h.clicar(/Gerar 15 Exercícios com IA/);
    assert.match(erroIA(h), re);
    assert.equal(cards(h).length, 3);
    assert.ok(h.tem(/Gerar 15 Exercícios com IA/), "painel volta ao normal (sem loading)");
    h.fechar();
  });
}

test("gerar: timeout (IA não começa a responder em 45s) → mensagem de demora", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila({ pendurar: true });
  h.App.gerarExerciciosIA(); await h.estabilizar();
  assert.match(h.texto(), /Gerando 15 exercícios com IA/);
  assert.equal(h.tem(/Gerar 15 Exercícios com IA/), false, "botão some durante o loading");
  await h.avancar(46000);
  assert.match(erroIA(h), /demorou demais/);
  assert.equal(cards(h).length, 3);
  h.fechar();
});

test("gerar: sem chave → botão desabilitado e aviso; sem texto → aviso", async () => {
  const h = await abrirProfessor({ semChave: true, editar: "L1" });
  assert.equal(h.botao(/Gerar 15 Exercícios com IA/).disabled, true);
  assert.match(h.texto(), /Chave da IA não configurada/);
  h.App.gerarExerciciosIA(); await h.estabilizar();
  assert.match(erroIA(h), /IA não configurada/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
  const h2 = await abrirProfessor({ editar: "L1" });
  await h2.preencher("lTexto", "  ");
  h2.App.gerarExerciciosIA(); await h2.estabilizar();
  assert.match(erroIA(h2), /Escreva o texto explicativo ou importe um documento/);
  assert.equal(h2.ia.chamadas.length, 0);
  h2.fechar();
});

test("testar conexão com a IA: sucesso e falha curta/longa", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await h.clicar(h.document.querySelector('[title="Configurar"]'));
  h.ia.fila("ok", "x".repeat(1500));
  await h.clicar(/Testar conexão com a IA/);
  await h.aguardar(() => /✅/.test(h.texto()));
  assert.equal(h.ia.chamadas.length, 2);
  h.ia.fila("ok", { rede: true });
  await h.clicar(/Testar conexão com a IA/);
  await h.aguardar(() => /❌/.test(h.texto()));
  h.fechar();
});
