// Aluno: leitura em voz alta (TTS) — questões, seleção, feedback, resumo, estilos, velocidade e auto-leitura.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

test("'Ouvir a pergunta': abertura da persona, enunciado, 'As opções são' e cada opção (com pausas)", async () => {
  const h = await A.iniciarClassico({});
  await h.clicar(/Ouvir a pergunta/);
  const f = h.fala;
  assert.match(f.textos().pop(), /^Muito bem! Agora veja esta questão:/);
  const lidos = [];
  for (let i = 0; i < 6; i++) { f.synth.terminar(); await h.avancar(1000); lidos.push(f.textos().pop()); }
  assert.match(lidos[0], /Quanto é 1 \+ 1\?/);
  assert.match(lidos[1], /As opções são:/);
  assert.match(lidos[2], /Opção A: 2/);
  assert.match(lidos[5], /Opção D: 5/);
  // clicar de novo enquanto fala → para
  await h.clicar(/Ouvir a pergunta|Parar/);
  h.fechar();
});

test("lacuna é lida como 'lacuna'; V/F pergunta se é verdadeira ou falsa", async () => {
  const h = await A.iniciarClassico({ seed: { licoes: { L1: F.licao({ exercicios: [F.fill(1, "x", { nivel: "facil" }), F.vf(2, 0, { nivel: "intermediario" })] }) } } });
  await h.clicar(/Ouvir a pergunta/);
  h.fala.synth.terminar(); await h.avancar(500);
  assert.match(h.fala.textos().pop(), /Complete a lacuna 1: lacuna/);
  await A.acertar(h); await h.clicar("Continuar");
  h.fala.synth.terminar(); await h.avancar(1000); // termina a frase "Muito bem!" (o botão alterna ouvir/parar)
  await h.clicar(/Ouvir a pergunta/);
  for (let i = 0; i < 2; i++) { h.fala.synth.terminar(); await h.avancar(1000); }
  assert.match(h.fala.textos().pop(), /A afirmação é verdadeira ou falsa\?/);
  h.fechar();
});

test("selecionar opção fala a escolha; acerto e erro têm frases da persona", async () => {
  const h = await A.iniciarClassico({});
  h.document.querySelectorAll("#optWrap .opt")[0].click();
  await h.estabilizar();
  assert.match(h.fala.textos().pop(), /Você escolheu a letra A: 2/);
  await h.clicar("Verificar");
  assert.match(h.fala.textos().pop(), /Muito bem! Você acertou!/);
  await h.clicar("Continuar");
  await A.errar(h);
  assert.match(h.fala.textos().pop(), /Quase lá! Veja a explicação\.\s+A resposta certa era: 4\./);
  h.fechar();
});

test("'Ouvir a explicação' lê a resposta certa e o texto", async () => {
  const h = await A.iniciarClassico({ rotas: { explic: "Explicação falada." } });
  await A.errar(h);
  await A.esperarExplicacao(h);
  h.fala.synth.terminar(); await h.avancar(1000); // fim do feedback falado do erro
  await h.clicar(/Ouvir a explicação/);
  assert.match(h.fala.textos().pop(), /A resposta certa é: 2/);
  h.fala.synth.terminar(); await h.avancar(800);
  assert.match(h.fala.textos().pop(), /Explicação falada\./);
  h.fechar();
});

test("'Ouvir o resumo' lê por parágrafo sem a marcação ## e **", async () => {
  const h = await A.entrarAluno({});
  await A.abrirLicao(h);
  await h.clicar(/Ouvir o resumo/);
  h.fala.synth.terminar(); await h.avancar(300); // intro → 1º parágrafo
  const t = h.fala.textos().pop();
  assert.match(t, /O que é somar\?/);
  assert.doesNotMatch(t, /##|\*\*/);
  assert.ok(h.document.getElementById("spar-0").classList.contains("lendo"));
  h.fechar();
});

test("estilo e velocidade: persistem no localStorage e mudam rate/pitch; velocidade é limitada a 0,5–1,5", async () => {
  const h = await A.iniciarClassico({});
  await h.clicar(/Estilo Robô|🤖/);
  const cfg = JSON.parse(h.window.localStorage.getItem("audioConfig"));
  assert.equal(cfg.estilo, "robo"); assert.equal(cfg.estiloManual, true);
  await h.clicar(/Velocidade rápido/);
  assert.equal(JSON.parse(h.window.localStorage.getItem("audioConfig")).vel, 1.3);
  h.App.setVelocidade(9);
  assert.equal(JSON.parse(h.window.localStorage.getItem("audioConfig")).vel, 1.5);
  h.App.setVelocidade(0.1);
  assert.equal(JSON.parse(h.window.localStorage.getItem("audioConfig")).vel, 0.5);
  h.App.setVelocidadeRapido(1.0);
  await h.clicar(/Ouvir a pergunta/);
  const u = h.fala.faladas[h.fala.faladas.length - 1];
  assert.ok(u.rate > 0.3 && u.rate <= 2);
  h.App.setEstiloVoz("inexistente"); // ignorado
  assert.equal(JSON.parse(h.window.localStorage.getItem("audioConfig")).estilo, "robo");
  h.fechar();
});

test("Inglês sugere o estilo 'Professora de Inglês' (se o aluno não escolheu manualmente)", async () => {
  const h = await A.entrarAluno({ seed: { licoes: { I1: F.licao({ disciplina: "ing", titulo: "Animals" }) } } });
  await h.clicar(/Inglês/);
  await h.clicar(/Animals/);
  assert.equal(JSON.parse(h.window.localStorage.getItem("audioConfig")).estilo, "professora_ingles");
  h.fechar();
  const h2 = await A.entrarAluno({ seed: { licoes: { I1: F.licao({ disciplina: "ing", titulo: "Animals" }) } }, local: { audioConfig: JSON.stringify({ estilo: "robo", estiloManual: true }) } });
  await h2.clicar(/Inglês/); await h2.clicar(/Animals/);
  assert.equal(JSON.parse(h2.window.localStorage.getItem("audioConfig")).estilo, "robo");
  h2.fechar();
});

test("auto-leitura: ligar no perfil faz a pergunta ser lida sozinha 1s depois de aparecer", async () => {
  const h = await A.entrarAluno({});
  await h.clicar(/Meu Perfil/);
  await h.clicar(/Ler perguntas sozinho: Desligado/);
  assert.equal(h.window.localStorage.getItem("estudamais_autoler_v1"), "1");
  assert.ok(h.tem(/Ler perguntas sozinho: Ligado/));
  await h.clicar("←");
  await A.abrirLicao(h);
  // auto-leitura do resumo: contagem de 2s e leitura
  assert.match(h.texto(), /Iniciando leitura em 2/);
  await h.clicar(/Cancelar auto-leitura/);
  await A.irParaClassico(h);
  const n = h.fala.faladas.length;
  await h.avancar(1000);
  assert.ok(h.fala.faladas.length > n, "leu a pergunta sozinho");
  h.fechar();
});

test("sem suporte a voz no navegador: botões de ouvir não aparecem e nada quebra", async () => {
  const h = await A.entrarAluno({});
  delete h.window.speechSynthesis;
  await A.abrirLicao(h);
  assert.ok(!h.tem(/Ouvir o resumo/));
  await A.irParaClassico(h);
  assert.ok(!h.tem(/Ouvir a pergunta/));
  await A.acertar(h);
  assert.match(h.texto(), /Muito bem!/);
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});
