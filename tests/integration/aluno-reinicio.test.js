// PRIORITÁRIO — resposta incorreta: explicação da IA e reinício embaralhado da atividade.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

const ids = arr => arr.map(e => e.id).join(",");
const ordemBanco = h => ids(h.store.dados.licoes.L1.exercicios);

test("erro → pede a explicação à IA, mostra e persiste em licoes.explicacoes.{exId}", async () => {
  const h = await A.iniciarClassico({ rotas: { explic: "Tudo bem errar! 1 + 1 = 2 porque juntamos um com um." } });
  const ex = A.exercicioAtual(h);
  await A.errar(h);
  assert.match(h.texto(), /Ops! Resposta certa: 2/);
  assert.equal(A.chamadasExplic(h.ia), 0, "a explicação só é pedida após o feedback (950ms)");
  await A.esperarExplicacao(h);
  assert.equal(A.chamadasExplic(h.ia), 1);
  assert.match(h.ia.chamadas.find(c => /errou/.test(c.prompt)).prompt, /Enunciado: Quanto é 1 \+ 1\?[\s\S]*Resposta correta: 2/);
  assert.match(h.texto(), /juntamos um com um/);
  assert.match(h.texto(), /Resposta certa: 2/);
  assert.equal(h.store.dados.licoes.L1.explicacoes[ex.id], "Tudo bem errar! 1 + 1 = 2 porque juntamos um com um.");
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

test("explicação já salva no doc → usada sem chamar a IA", async () => {
  const exps = { ex1: "Explicação salva 1", ex2: "Explicação salva 2", ex3: "Explicação salva 3" };
  const h = await A.iniciarClassico({ seed: { licoes: { L1: F.licao({ explicacoes: exps }) } } });
  await A.errar(h);
  await A.esperarExplicacao(h);
  assert.match(h.texto(), /Explicação salva 1/);
  assert.equal(A.chamadasExplic(h.ia), 0);
  h.fechar();
});

test("sem chave de IA → mensagem padrão acolhedora com a resposta certa (sem chamadas)", async () => {
  const h = await A.iniciarClassico({ semChave: true });
  await A.errar(h);
  await A.esperarExplicacao(h);
  assert.match(h.texto(), /Tudo bem errar — é assim que a gente aprende!.*A resposta certa é "2"/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

for (const [nome, item, extra] of [
  ["erro de rede", { rede: true }],
  ["401 chave inválida", { status: 401, mensagem: "Incorrect API key" }],
  ["429 limite de uso", { status: 429 }],
  ["503 indisponível", { status: 503 }],
  ["resposta vazia", ""],
  ["corpo não-JSON", { corpoInvalido: true, json: true }],
  ["conexão cai no meio", { corte: "Tudo bem" }],
  ["timeout de 10s", { pendurar: true }, 10000],
]) {
  test(`explicação: ${nome} → mensagem de falha com a resposta certa, nada persistido`, async () => {
    const h = await A.iniciarClassico({ rotas: { explic: item } });
    await A.errar(h);
    await h.avancar(1000);
    if (extra) await h.avancar(extra);
    await A.esperarExplicacao(h);
    const t = h.texto();
    assert.match(t, /Não consegui gerar a explicação agora\. A resposta correta é "2"/);
    assert.equal((h.store.dados.licoes.L1.explicacoes || {}).ex1, undefined, "falha não persiste explicação");
    assert.ok(h.tem(/Entendi, recomeçar a atividade/), "botão de confirmar continua disponível");
    assert.deepEqual(h.errosJs(), []);
    h.fechar();
  });
}

test("reinício só acontece ao confirmar: antes disso nada muda", async () => {
  const h = await A.iniciarClassico({});
  await A.acertar(h);
  await h.clicar("Continuar");
  await A.errar(h); // erra a 2ª
  await A.esperarExplicacao(h);
  await h.avancar(60000); // esperar não reinicia sozinho
  assert.match(h.texto(), /Veja a explicação/);
  assert.match(h.texto(), /Revise a explicação e tente novamente\. A atividade será reiniciada com uma nova ordem de questões\./);
  assert.equal(h.store.escritas("progresso").length, 0);
  h.fechar();
});

test("após confirmar: volta à questão 1, zera tudo e embaralha (aleatoriedade injetada)", async () => {
  const h = await A.iniciarClassico({});
  const antes = ordemBanco(h);
  await A.acertar(h); await h.clicar("Continuar");  // 1 acerto (+10 XP)
  await A.errar(h);                                   // erro na 2ª (vida perdida)
  await A.esperarExplicacao(h);
  // Fisher–Yates com 3 itens: i=2 → j=floor(0*3)=0 ; i=1 → j=floor(0*2)=0  ⇒ [ex2, ex3, ex1]
  h.random.fila(0, 0);
  await h.clicar(/Entendi, recomeçar a atividade/);
  const t = h.texto();
  assert.match(t, /Questão 1 de 3/);
  assert.match(t, /✅ 0 acertos/);
  assert.equal(h.document.querySelector(".hearts").textContent, "❤️❤️❤️", "vidas restauradas");
  assert.equal(h.document.querySelector(".progress-fill").style.width, "0%");
  assert.equal(A.enunciado(h), "Quanto é 2 + 2?", "nova ordem começa por ex2");
  assert.equal(h.document.querySelectorAll("#optWrap .opt.selected, #optWrap .opt.wrong, #optWrap .opt.correct").length, 0, "sem resposta marcada");
  assert.match(h.toasts.join("|"), /Nova tentativa/);
  // percorre a nova tentativa inteira: todas as 3 questões, sem duplicar/perder
  const vistos = [];
  for (let i = 0; i < 3; i++) { vistos.push(A.exercicioAtual(h).id); await A.acertar(h); await h.clicar("Continuar"); }
  assert.deepEqual(vistos, ["ex2", "ex3", "ex1"]);
  assert.match(h.texto(), /Lição Concluída!.*Você acertou 3 de 3/);
  assert.equal(ordemBanco(h), antes, "ordem permanente no banco intacta");
  assert.equal(h.store.escritas("licoes").filter(l => l.dados && l.dados.exercicios).length, 0, "nenhuma escrita de exercícios");
  // XP da tentativa anterior foi descartado: só 3 acertos fáceis (30) + bônus 20
  assert.equal(h.store.dados.progresso.a1_L1.xpGanho, 30);
  assert.equal(h.store.dados.progresso.a1_L1.erros, 0);
  h.fechar();
});

test("aleatoriedade que repete a ordem anterior → ainda assim a nova ordem é diferente", async () => {
  const h = await A.iniciarClassico({});
  await A.errar(h);
  await A.esperarExplicacao(h);
  h.random.fila(...Array(20).fill(0.99)); // j=i sempre ⇒ identidade nas 10 tentativas
  await h.clicar(/Entendi, recomeçar a atividade/);
  const vistos = [];
  for (let i = 0; i < 3; i++) { vistos.push(A.exercicioAtual(h).id); await A.acertar(h); await h.clicar("Continuar"); }
  assert.deepEqual(vistos, ["ex2", "ex1", "ex3"], "troca as duas primeiras como último recurso");
  h.fechar();
});

test("lição com 1 questão: reinicia normalmente (mensagem sem 'nova ordem')", async () => {
  const h = await A.iniciarClassico({ seed: { licoes: { L1: F.licao({ exercicios: [F.mc(1)] }) } } });
  await A.errar(h);
  await A.esperarExplicacao(h);
  assert.match(h.texto(), /A atividade será reiniciada\./);
  assert.doesNotMatch(h.texto(), /nova ordem/);
  await h.clicar(/Entendi, recomeçar a atividade/);
  assert.match(h.texto(), /Questão 1 de 1/);
  assert.match(h.toasts.join("|"), /🔁 Nova tentativa!/);
  await A.acertar(h); await h.clicar("Continuar");
  assert.match(h.texto(), /Lição Concluída!/);
  h.fechar();
});

test("cliques repetidos em Verificar e em Entendi não duplicam requisições nem tentativas", async () => {
  const h = await A.iniciarClassico({});
  const ex = A.exercicioAtual(h);
  h.document.querySelectorAll("#optWrap .opt")[(ex.correta + 1) % 4].click();
  await h.estabilizar();
  const btn = h.botao("Verificar");
  btn.click(); btn.click(); btn.click(); // mesmo elemento clicado 3x rapidamente
  await h.avancar(1000);
  await A.esperarExplicacao(h);
  assert.equal(A.chamadasExplic(h.ia), 1, "uma única requisição de explicação");
  const entendi = h.botao(/Entendi, recomeçar a atividade/);
  entendi.click(); entendi.click();
  await h.estabilizar();
  assert.match(h.texto(), /Questão 1 de 3/);
  assert.equal(h.toasts.filter(t => /Nova tentativa/.test(t)).length, 1, "uma única nova tentativa");
  // App.continuarAposExplicacao fora da tela de explicação é ignorado
  await A.acertar(h);
  h.App.continuarAposExplicacao();
  await h.estabilizar();
  assert.match(h.texto(), /Questão 1 de 3/);
  assert.match(h.texto(), /✅ 1 acerto/);
  h.fechar();
});

test("sair da atividade durante a geração da explicação: explicação não aparece depois", async () => {
  const h = await A.iniciarClassico({ rotas: { explic: () => ({ pendurar: true }) } });
  await A.errar(h);
  await h.avancar(1000); // pedido enviado e pendente
  assert.equal(A.chamadasExplic(h.ia), 1);
  h.respostaConfirm(true);
  await h.clicar("✕"); // confirmQuit
  assert.match(h.texto(), /Somas simples/);
  await h.avancar(15000); // timeout da IA dispara
  assert.doesNotMatch(h.texto(), /Veja a explicação/);
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

test("cancelar a saída (confirm=false) mantém a atividade", async () => {
  const h = await A.iniciarClassico({});
  h.respostaConfirm(false);
  await h.clicar("✕");
  assert.match(h.texto(), /Questão 1 de 3/);
  assert.match(h.confirmacoes.pop(), /Deseja sair da atividade\?/);
  h.fechar();
});
