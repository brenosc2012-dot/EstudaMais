// Professor: gerar exercícios com IA (substituir/acumular, parser, erros, prompt).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, erroIA, ultimoToast, F } = require("../support/professor-helpers");

const RESP_MISTA = F.json([
  { nivel: "fácil", tipo: "multipla_escolha", enunciado: "Qual é a vogal?", opcoes: ["B", "C", "A", "D"], resposta_correta: "A" },
  { nivel: "Intermediário", tipo: "verdadeiro_falso", enunciado: "2+2=4?", resposta_correta: "Verdadeiro" },
  { nivel: "dificil", tipo: "verdadeiro_falso", enunciado: "3+3=7?", resposta_correta: "falso" },
  { nivel: "dificil", tipo: "completar_lacunas", enunciado: "O dobro de 4 é ___", resposta_correta: "8" },
  { nivel: "facil", tipo: "multipla_escolha", enunciado: "Letra da correta", opcoes: ["x", "y", "z", "w"], resposta_correta: "C" },
  { nivel: "facil", tipo: "multipla_escolha", enunciado: "Opção única", opcoes: ["só uma"], resposta_correta: "só uma" },
  { tipo: "multipla_escolha", opcoes: ["a", "b"] },
]);

function cards(h) { return [...h.document.querySelectorAll(".ex-edit-card")]; }

test("gerar (substituir): troca os exercícios do editor pelos da IA, mapeando tipos/níveis/resposta", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  const c = cards(h);
  assert.equal(c.length, 5, "descarta item sem enunciado e MC com < 2 opções");
  assert.equal(c[0].querySelector("select").value, "mc");
  assert.equal(c[0].querySelectorAll("select")[1].value, "facil");
  const pick = card => [...card.querySelectorAll(".opt-row .pick")].findIndex(b => /58cc02/.test(b.getAttribute("style")));
  assert.equal(pick(c[0]), 2, "resposta por texto → índice da opção 'A'");
  assert.equal(c[1].querySelector("select").value, "vf"); assert.equal(pick(c[1]), 0);
  assert.equal(c[1].querySelectorAll("select")[1].value, "intermediario");
  assert.equal(pick(c[2]), 1, "falso → índice 1");
  assert.equal(c[3].querySelector("select").value, "fill");
  assert.equal(pick(c[4]), 2, "letra C → índice 2");
  assert.match(ultimoToast(h), /5 exercícios \(2F\/1I\/2D\)! Revise e salve\./);
  assert.equal(h.store.escritas("licoes").length, 0, "não grava até o professor salvar");
  h.fechar();
});

test("gerar (acumular): soma aos exercícios atuais", async () => {
  const h = await abrirProfessor({ editar: "L1", local: { estudamais_ia_modo_v1: "acumular" } });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  assert.equal(cards(h).length, 3 + 5);
  h.fechar();
});

test("configuração ⚙️: alterna substituir/acumular e persiste no localStorage", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await h.clicar(h.document.querySelector('[title="Configurar"]'));
  h.campo("iaModo").value = "acumular"; h.App.setModoIA("acumular");
  assert.equal(h.window.localStorage.getItem("estudamais_ia_modo_v1"), "acumular");
  h.fechar();
});

test("prompt inclui conteúdo, material, faixa etária e regra de resposta por texto", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { L1: F.licao({ materialTexto: "[apostila.txt]\nMaterial secreto do professor" }) } }, editar: "L1" });
  h.ia.fila(RESP_MISTA);
  await h.clicar(/Gerar 15 Exercícios com IA/);
  const p = h.ia.ultimoPrompt();
  assert.match(p, /3º ano do Ensino Fundamental I/);
  assert.match(p, /aproximadamente 8 anos/);
  assert.match(p, /exatamente 15 exercícios/);
  assert.match(p, /Somar é juntar quantidades/);
  assert.match(p, /Material secreto do professor/);
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
  ["JSON malformado", "[{ isto não é json", /não retornou exercícios reconhecíveis/],
  ["array vazio", "[]", /não retornou exercícios reconhecíveis/],
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
  assert.match(erroIA(h2), /Escreva o conteúdo da lição/);
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
