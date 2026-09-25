// Professor: Modo História (toggle, gerar/regenerar, preview, erros) e
// Interpretação de Texto (3 etapas, falha parcial, regenerar texto/exercícios, publicar).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, ultimoToast, F } = require("../support/professor-helpers");

const HISTORIA = JSON.stringify({
  titulo: "A Floresta dos Números", cenario: "Uma floresta mágica", protagonista: "Zeca",
  capitulos: [{ narrativa_intro: "Cena 1", narrativa_acerto: "Boa!", narrativa_erro: "Ops" }, { narrativa_intro: "Cena 2", narrativa_acerto: "Boa!", narrativa_erro: "Ops" }],
  desfecho_heroi: "Venceu!", desfecho_aprendiz: "Aprendeu!",
});
const erroPainel = h => [...h.document.querySelectorAll(".ia-erro")].map(e => e.textContent.trim()).join(" | ");

// ---------------- Modo História ----------------
test("história: toggle habilitar/desabilitar é salvo com a lição", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  assert.ok(h.tem(/Modo História habilitado/));
  await h.clicar(/Modo História habilitado/);
  assert.ok(h.tem(/Modo História desabilitado/));
  await h.clicar(/Salvar lição/);
  assert.equal(h.store.doc("licoes", "L1").historiaHabilitada, false);
  h.fechar();
});

test("história: gerar grava historias_geradas com 1 capítulo por questão (completa os que faltam) e mostra preview", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila(HISTORIA);
  await h.clicar(/Gerar história/);
  const d = h.store.doc("historias_geradas", "L1");
  assert.equal(d.titulo, "A Floresta dos Números");
  assert.equal(d.capitulos.length, 3, "IA mandou 2, lição tem 3 → completa");
  assert.equal(d.capitulos[1].questao_index, 1);
  assert.equal(ultimoToast(h), "História criada e salva! 📖✅");
  assert.match(h.texto(), /História disponível: A Floresta dos Números/);
  assert.match(h.texto(), /3 capítulo\(s\)/);
  assert.ok(h.tem(/Regenerar história/));
  assert.match(h.ia.ultimoPrompt(), /EXATAMENTE 3 capítulos/);
  assert.match(h.ia.ultimoPrompt(), /0\. Quanto é 1 \+ 1\?/);
  h.fechar();
});

test("história: ao abrir a lição, a história salva aparece como preview", async () => {
  const h = await abrirProfessor({ extraSeed: { historias_geradas: { L1: { titulo: "Salva antes", protagonista: "Lia", cenario: "mar", capitulos: [{}, {}, {}] } } }, editar: "L1" });
  await h.estabilizar();
  assert.match(h.texto(), /História disponível: Salva antes/);
  h.fechar();
});

for (const [nome, item, re] of [
  ["JSON inválido", "não é json", /não retornou uma história válida/],
  ["sem capítulos", JSON.stringify({ titulo: "x", capitulos: [] }), /não retornou uma história válida/],
  ["429", { status: 429 }, /Limite de uso/],
  ["rede", { rede: true }, /Falha na chamada/],
]) {
  test(`história: erro (${nome}) mostra mensagem e não grava`, async () => {
    const h = await abrirProfessor({ editar: "L1" });
    h.ia.fila(item);
    await h.clicar(/Gerar história/);
    assert.match(erroPainel(h), re);
    assert.equal(h.store.doc("historias_geradas", "L1"), undefined);
    h.fechar();
  });
}

test("história: timeout de 60s → mensagem de demora; loading desabilita o botão", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila({ pendurar: true });
  h.App.regenerarHistoriaProf(); await h.estabilizar();
  assert.match(h.texto(), /Criando a aventura/);
  assert.equal(h.botao(/Gerar história/).disabled, true);
  await h.avancar(61000);
  assert.match(erroPainel(h), /demorou demais/);
  h.fechar();
});

test("história: pré-condições — lição não salva, sem exercícios, sem chave", async () => {
  let h = await abrirProfessor();
  await h.clicar(/Criar nova lição/);
  assert.match(h.texto(), /Salve a lição para gerar a história/);
  h.App.regenerarHistoriaProf(); await h.estabilizar();
  assert.equal(ultimoToast(h), "Salve a lição primeiro para gerar a história.");
  h.fechar();
  h = await abrirProfessor({ extraSeed: { licoes: { L1: F.licao({ exercicios: [] }) } }, editar: "L1" });
  h.App.regenerarHistoriaProf(); await h.estabilizar();
  assert.equal(ultimoToast(h), "Gere/adicione exercícios antes de criar a história.");
  h.fechar();
  h = await abrirProfessor({ semChave: true, editar: "L1" });
  assert.equal(h.botao(/Gerar história/).disabled, true);
  h.App.regenerarHistoriaProf(); await h.estabilizar();
  assert.match(erroPainel(h), /IA não configurada/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

// DEFEITO (regressão): a gravação da história não era aguardada — falha no Firestore
// ainda mostrava "História criada e salva!" e gerava rejeição não tratada.
test("história: falha ao gravar no Firestore não anuncia sucesso", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.store.falhar({ op: "set", colecao: "historias_geradas", erro: new Error("sem permissão") });
  h.ia.fila(HISTORIA);
  await h.clicar(/Gerar história/);
  assert.equal(h.store.doc("historias_geradas", "L1"), undefined);
  assert.notEqual(ultimoToast(h), "História criada e salva! 📖✅");
  assert.match(erroPainel(h), /sem permissão/);
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

// ---------------- Interpretação de texto ----------------
const TEXTO = JSON.stringify({ titulo_texto: "O Sapo Sábio", genero: "Fábula", texto: "Era uma vez um sapo.\nEle pensava muito." });
const bloco = (n, nivel, pref) => F.json(Array.from({ length: n }, (_, i) => ({ nivel, tipo: "multipla_escolha", enunciado: `${pref} pergunta ${i} sobre o sapo?`, opcoes: ["a", "b", "c", "d"], resposta_correta: "b" })));

async function abrirInterp(o) {
  const h = await abrirProfessor(o);
  h.App.teacherSelectSubj("por"); await h.estabilizar();
  await h.clicar(/Criar nova lição/);
  await h.clicar(h.document.querySelectorAll(".tipo-card")[1]); // "Interpretação de texto"
  await h.preencher("itTema", "amizade");
  await h.preencher("itGenero", "Fábula");
  await h.preencher("itTamanho", "curto");
  return h;
}

test("interpretação: seletor de tipo só existe em Português", async () => {
  const h = await abrirProfessor();
  await h.clicar(/Criar nova lição/);
  assert.equal(h.document.querySelectorAll(".tipo-card").length, 0);
  h.App.teacherSelectSubj("por"); await h.estabilizar();
  assert.equal(h.document.querySelectorAll(".tipo-card").length, 2);
  h.fechar();
});

test("interpretação: gera em 3 etapas (texto + 10 + 5), prompts corretos e publica", async () => {
  const h = await abrirInterp();
  h.App.toggleFocoInterp("personagens"); await h.estabilizar();
  h.ia.fila(TEXTO, bloco(10, "facil", "A"), bloco(5, "dificil", "B"));
  await h.clicar(/Gerar texto e exercícios/);
  assert.equal(h.ia.chamadas.length, 3);
  assert.match(h.ia.chamadas[0].prompt, /Fábula original sobre o tema 'amizade'/);
  assert.match(h.ia.chamadas[0].prompt, /150 a 200/);
  assert.match(h.ia.chamadas[0].prompt, /Personagens e características/);
  assert.match(h.ia.chamadas[1].prompt, /exatamente 10 questões/);
  assert.match(h.ia.chamadas[1].prompt, /Era uma vez um sapo/);
  assert.match(h.ia.chamadas[2].prompt, /exatamente 5 questões/);
  assert.equal(h.campo("lTextoGerado").value, "Era uma vez um sapo.\nEle pensava muito.");
  assert.match(h.texto(), /Exercícios de interpretação \(15\)/);
  assert.match(ultimoToast(h), /Texto e 15 exercícios gerados/);
  await h.clicar(/Publicar lição/);
  const [id, d] = Object.entries(h.store.colecao("licoes")).find(([k]) => k !== "L1");
  assert.ok(id);
  assert.equal(d.tipo, "interpretacao_texto");
  assert.equal(d.titulo, "O Sapo Sábio", "título vem do texto quando vazio");
  assert.equal(d.conteudo, d.textoGerado);
  assert.equal(d.generoTextual, "Fábula"); assert.equal(d.tema, "amizade");
  assert.equal(d.exercicios.length, 15);
  h.fechar();
});

test("interpretação: falha na etapa 3 preserva texto e as 10 questões já recebidas", async () => {
  const h = await abrirInterp();
  h.ia.fila(TEXTO, bloco(10, "facil", "A"), { status: 429 });
  await h.clicar(/Gerar texto e exercícios/);
  assert.match(erroPainel(h), /O texto e 10 questões foram gerados, mas faltaram as demais \(.*Limite de uso/);
  assert.match(h.texto(), /Exercícios de interpretação \(10\)/);
  assert.equal(h.campo("lTextoGerado").value.startsWith("Era uma vez"), true);
  h.fechar();
});

test("interpretação: falha na etapa 2 preserva o texto (sem questões) e orienta a regenerar", async () => {
  const h = await abrirInterp();
  h.ia.fila(TEXTO, "[]");
  await h.clicar(/Gerar texto e exercícios/);
  assert.match(erroPainel(h), /O texto foi gerado, mas as questões não/);
  assert.equal(h.botao(/Publicar lição/).disabled, false);
  await h.clicar(/Publicar lição/);
  assert.equal(ultimoToast(h), "Gere os exercícios de interpretação antes de publicar.");
  h.fechar();
});

test("interpretação: falha na etapa 1 (texto inválido) não altera nada", async () => {
  const h = await abrirInterp();
  h.ia.fila(JSON.stringify({ titulo_texto: "sem texto" }));
  await h.clicar(/Gerar texto e exercícios/);
  assert.match(erroPainel(h), /não retornou um texto válido/);
  assert.equal(h.ia.chamadas.length, 1);
  assert.equal(h.botao(/Publicar lição/).disabled, true);
  h.fechar();
});

test("interpretação: validações de tema e gênero", async () => {
  const h = await abrirProfessor();
  h.App.teacherSelectSubj("por"); await h.estabilizar();
  await h.clicar(/Criar nova lição/);
  h.App.setTipoLicao("interpretacao_texto"); await h.estabilizar();
  await h.clicar(/Gerar texto e exercícios/);
  assert.match(erroPainel(h), /Informe o tema do texto/);
  await h.preencher("itTema", "praia");
  await h.clicar(/Gerar texto e exercícios/);
  assert.match(erroPainel(h), /Escolha o gênero textual/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

test("interpretação: parser tolera quebras de linha cruas dentro do JSON do texto", async () => {
  const h = await abrirInterp();
  h.ia.fila('{"titulo_texto":"Poema","genero":"Poema","texto":"Linha 1\nLinha 2\n\nLinha 3"}', bloco(10, "facil", "A"), bloco(5, "dificil", "B"));
  await h.clicar(/Gerar texto e exercícios/);
  assert.equal(h.campo("lTextoGerado").value, "Linha 1\nLinha 2\n\nLinha 3");
  h.fechar();
});

test("interpretação: regenerar exercícios mantém o texto; regenerar texto pede confirmação", async () => {
  const h = await abrirInterp();
  h.ia.fila(TEXTO, bloco(10, "facil", "A"), bloco(5, "dificil", "B"));
  await h.clicar(/Gerar texto e exercícios/);
  await h.preencher("lTextoGerado", "Texto editado pelo professor.");
  h.ia.fila(bloco(10, "facil", "C"), bloco(5, "dificil", "D"));
  await h.clicar(/Regenerar exercícios \(mesmo texto\)/);
  assert.match(h.ia.ultimoPrompt(), /Texto editado pelo professor\./);
  assert.equal(h.campo("lTextoGerado").value, "Texto editado pelo professor.");
  assert.match(ultimoToast(h), /15 questões geradas/);
  h.respostaConfirm(false);
  const n = h.ia.chamadas.length;
  await h.clicar(/Regenerar texto/);
  assert.match(h.confirmacoes[h.confirmacoes.length - 1], /NOVA versão do texto/);
  assert.equal(h.ia.chamadas.length, n, "cancelar não chama a IA");
  h.fechar();
});

test("interpretação: regenerar exercícios com falha parcial informa quantas vieram", async () => {
  const h = await abrirInterp();
  h.ia.fila(TEXTO, bloco(10, "facil", "A"), bloco(5, "dificil", "B"));
  await h.clicar(/Gerar texto e exercícios/);
  h.ia.fila(bloco(10, "facil", "C"), { rede: true });
  await h.clicar(/Regenerar exercícios \(mesmo texto\)/);
  assert.match(erroPainel(h), /Vieram 10 questões; as demais falharam/);
  h.fechar();
});

test("interpretação: lista mostra badge, gênero e trecho do texto", async () => {
  const h = await abrirProfessor({ extraSeed: { licoes: { LI: F.licao({ disciplina: "por", tipo: "interpretacao_texto", titulo: "Leitura", textoGerado: "Era uma vez um sapo que pensava.", generoTextual: "Fábula", tema: "sapos" }) } } });
  h.App.teacherSelectSubj("por"); await h.estabilizar();
  assert.match(h.texto(), /📖 Interpretação/);
  assert.match(h.texto(), /Fábula • tema: sapos/);
  assert.match(h.texto(), /"Era uma vez um sapo que pensava\."/);
  h.fechar();
});
