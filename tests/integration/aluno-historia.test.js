// Aluno: Modo História (aventura gerada por IA sobre o motor de exercícios).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

function historiaIA(n, extra) {
  return JSON.stringify(Object.assign({
    titulo: "A Floresta dos Números", cenario: "Uma floresta mágica", protagonista: "Lulu",
    capitulos: Array.from({ length: n }, (_, i) => ({ narrativa_intro: `Cena ${i + 1}: Lulu encontra uma ponte.`, narrativa_acerto: `Acerto ${i + 1}: a ponte se abre!`, narrativa_erro: `Erro ${i + 1}: a ponte balança.` })),
    desfecho_heroi: "Lulu salvou a floresta!", desfecho_aprendiz: "Lulu aprendeu muito e vai voltar!",
  }, extra));
}
async function irParaModo(h) {
  await A.abrirLicao(h);
  await h.avancar(10000);
  await h.clicar(/Já estudei/);
}
async function abrir(rotas, extra) {
  const h = await A.entrarAluno(Object.assign({ rotas: Object.assign({ historia: historiaIA(3) }, rotas || {}) }, extra || {}));
  await irParaModo(h);
  return h;
}

test("gera a história pela IA, mostra o capítulo e salva em historias_geradas", async () => {
  const h = await abrir();
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  const t = h.texto();
  assert.match(t, /A Floresta dos Números/);
  assert.match(t, /Cena 1: Lulu encontra uma ponte\./);
  assert.match(t, /Quanto é 1 \+ 1\?/);
  assert.match(t, /\+15 XP/, "fácil 10 × 1,5");
  const p = h.ia.chamadas.find(c => /hist[oó]ria interativa/.test(c.prompt)).prompt;
  assert.match(p, /EXATAMENTE 3 capítulos/);
  const g = h.store.dados.historias_geradas.L1;
  assert.equal(g.titulo, "A Floresta dos Números");
  assert.equal(g.capitulos.length, 3);
  h.fechar();
});

test("loading com mensagens rotativas enquanto a IA gera", async () => {
  const h = await abrir({ historia: { pendurar: true } });
  await h.clicar(/Modo História/);
  assert.match(h.texto(), /Criando sua aventura/);
  assert.match(h.texto(), /Criando o cenário da aventura/);
  await h.avancar(3000);
  assert.match(h.texto(), /Apresentando os personagens/);
  h.fechar();
});

test("acertos: narrativa de acerto, avanço automático, desfecho HERÓI (>70%) com +50% XP", async () => {
  const h = await abrir();
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  for (let i = 1; i <= 3; i++) {
    await A.acertar(h);
    assert.match(h.texto(), new RegExp(`Incrível! Acerto ${i}: a ponte se abre!`));
    await h.avancar(2200);
  }
  const t = h.texto();
  assert.match(t, /Herói da Aventura!/);
  assert.match(t, /Lulu salvou a floresta!/);
  assert.match(t, /Você acertou 3 de 3 \(100%\)/);
  assert.match(t, /\+65XP/, "45 (3×15) + 20 de bônus");
  const p = h.store.dados.progresso.a1_L1;
  assert.equal(p.modo, "historia"); assert.equal(p.xpGanho, 45); assert.equal(p.percentualAcertos, 100);
  assert.equal(JSON.stringify(h.store.dados.alunos.a1.historiasCompletas), '["L1"]');
  h.fechar();
});

test("erro: narrativa de erro + explicação inline (sem trocar de tela); desfecho APRENDIZ (≤70%)", async () => {
  const h = await abrir({ explic: "Explicação curta da IA." });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  await A.errar(h);
  assert.match(h.texto(), /Erro 1: a ponte balança\./);
  await h.estabilizar();
  assert.match(h.texto(), /Mas não desanime! Explicação curta da IA\./);
  assert.doesNotMatch(h.texto(), /Veja a explicação/, "Modo História não usa a tela de explicação nem reinicia");
  await h.clicar(/Continuar a aventura/);
  assert.match(h.texto(), /Capítulo 2 de 3/);
  await A.acertar(h); await h.avancar(2200);
  await A.acertar(h); await h.avancar(2200);
  assert.match(h.texto(), /Grande Aprendiz!/);
  assert.match(h.texto(), /Lulu aprendeu muito e vai voltar!/);
  assert.match(h.texto(), /\(67%\)/);
  h.fechar();
});

test("ordem natural das questões (não ordena por dificuldade) no Modo História", async () => {
  const exs = [F.mc(1, { nivel: "dificil" }), F.mc(2, { nivel: "facil" }), F.mc(3, { nivel: "intermediario" })];
  const h = await abrir({}, { seed: { licoes: { L1: F.licao({ exercicios: exs }) } } });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  assert.equal(A.enunciado(h), "Quanto é 1 + 1?");
  h.fechar();
});

test("game over: 3 erros → 'Ver desfecho' → aventura interrompida, nada gravado", async () => {
  const h = await abrir({ explic: "dica" });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  for (let i = 0; i < 3; i++) {
    await A.errar(h);
    await h.estabilizar();
    if (i < 2) await h.clicar(/Continuar a aventura/);
  }
  await h.clicar(/Ver desfecho/);
  assert.match(h.texto(), /A aventura foi interrompida!/);
  assert.equal(h.store.escritas("progresso").length, 0);
  await h.clicar(/Recomeçar a aventura/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  assert.equal(A.contar(h.ia, /hist[oó]ria interativa/), 1, "recomeço reaproveita a história em memória");
  h.fechar();
});

test("cache: história no Firestore (historias_geradas) é usada sem chamar a IA", async () => {
  const cache = JSON.parse(historiaIA(3, { titulo: "Do cache" }));
  const h = await abrir({}, { seed: { historias_geradas: { L1: cache } } });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  assert.match(h.texto(), /Do cache/);
  assert.equal(A.contar(h.ia, /hist[oó]ria interativa/), 0);
  h.fechar();
});

test("história com menos capítulos que questões é completada (1 capítulo por questão)", async () => {
  const h = await abrir({ historia: historiaIA(1) });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  await A.acertar(h); await h.avancar(2200);
  assert.match(h.texto(), /Capítulo 2 de 3/);
  assert.match(h.texto(), /O desafio continua!/);
  h.fechar();
});

for (const [nome, item, avanco] of [["JSON malformado", "não é json {"], ["sem capítulos", JSON.stringify({ titulo: "x", capitulos: [] })], ["erro 429", { status: 429 }], ["timeout 60s", { pendurar: true }, 60000]]) {
  test(`falha na geração (${nome}) → tela de erro com 'Tentar novamente' e 'Usar Modo Clássico'`, async () => {
    const h = await abrir({ historia: item });
    await h.clicar(/Modo História/);
    if (avanco) await h.avancar(avanco);
    await h.aguardar(() => /A aventura demorou a chegar/.test(h.texto()));
    assert.equal((h.store.dados.historias_geradas || {}).L1, undefined);
    await h.clicar(/Usar Modo Clássico/);
    assert.match(h.texto(), /Questão 1 de 3/);
    h.fechar();
  });
}

test("falha e depois 'Tentar novamente' com sucesso", async () => {
  let n = 0;
  const h = await abrir({ historia: () => (++n === 1 ? { status: 500 } : historiaIA(3)) });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /A aventura demorou a chegar/.test(h.texto()));
  await h.clicar(/Tentar novamente/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  h.fechar();
});

test("sem IA configurada → aviso e cai direto no Modo Clássico", async () => {
  const h = await A.entrarAluno({ semChave: true });
  await irParaModo(h);
  await h.clicar(/Modo História/);
  assert.match(h.toasts.join("|"), /Modo História indisponível/);
  assert.match(h.texto(), /Questão 1 de 3/);
  h.fechar();
});

test("conquista 'Contador de Histórias' ao completar a 5ª aventura", async () => {
  const h = await abrir({}, { seed: { alunos: { a1: F.aluno({ historiasCompletas: ["x1", "x2", "x3", "x4"] }) } } });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  for (let i = 0; i < 3; i++) { await A.acertar(h); await h.avancar(2200); }
  assert.match(h.texto(), /Contador de Histórias/);
  assert.ok(h.store.dados.alunos.a1.medalhas.includes("contador"));
  h.fechar();
});

test("conteúdo inseguro na história gerada é escapado", async () => {
  const h = await abrir({ historia: historiaIA(3, { titulo: "<img src=x onerror=alert(1)>" }) });
  await h.clicar(/Modo História/);
  await h.aguardar(() => /Capítulo 1 de 3/.test(h.texto()));
  assert.equal(h.document.querySelector("#app img"), null);
  assert.ok(h.html().includes("&lt;img src=x"));
  h.fechar();
});
