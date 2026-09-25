// Aluno: home, lista de lições (visibilidade por ano+turma), tela de estudo (resumo por IA e cache).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../support/aluno-helpers");
const { F } = A;

// ---------------- Home / lista ----------------
test("home: saudação, estatísticas, 9 disciplinas e contagem de lições visíveis", async () => {
  const h = await A.entrarAluno({});
  const t = h.texto();
  assert.match(t, /Olá, Ana Souza! 👋/);
  assert.match(t, /3º ano • Turma A/);
  for (const d of ["Matemática", "Português", "Artes", "Filosofia", "Redação", "Geografia", "História", "Ciências", "Inglês"]) assert.ok(t.includes(d), d);
  assert.match(t, /Matemática 0\/1 lição • 0 XP/);
  assert.match(t, /Português 0\/0 lições/);
  assert.match(t, /1 lições disponíveis/);
  assert.match(t, /🔥 1Ofensiva/, "primeiro acesso do dia inicia a ofensiva");
  h.fechar();
});

test("visibilidade estrita: só lições com ano E turma iguais aos do aluno (comparação normalizada)", async () => {
  const h = await A.entrarAluno({ seed: { licoes: {
    L1: F.licao({ titulo: "Visível" }),
    L2: F.licao({ titulo: "Turma minúscula com espaço", turma: " a " }),
    L3: F.licao({ titulo: "Outra turma", turma: "B" }),
    L4: F.licao({ titulo: "Outro ano", ano: "4º ano" }),
    L5: F.licao({ titulo: "Sem turma", turma: "" }),
    L6: F.licao({ titulo: "Sem ano", ano: "" }),
    L7: F.licao({ titulo: "Outro nível", nivel: "fund2" }),
    L8: F.licao({ titulo: "Sem nível (opcional)", nivel: "" }),
    L9: F.licao({ titulo: "Demo não aparece para real", isDemo: true }),
  } } });
  await h.clicar(/Matemática/);
  const t = h.texto();
  for (const ok of ["Visível", "Turma minúscula com espaço", "Sem nível (opcional)"]) assert.ok(t.includes(ok), ok);
  for (const no of ["Outra turma", "Outro ano", "Sem turma", "Sem ano", "Outro nível", "Demo não aparece"]) assert.ok(!t.includes(no), no);
  h.fechar();
});

test("lista: nº de exercícios (singular/plural), disciplina vazia e lição concluída", async () => {
  const aluno = F.aluno();
  aluno.disciplinas.mat.licoesConcluidas = ["L2"];
  const h = await A.entrarAluno({ seed: { alunos: { a1: aluno }, licoes: { L2: F.licao({ titulo: "Uma só", exercicios: [F.mc(1)] }) } } });
  assert.match(h.texto(), /Matemática 1\/2 lições/);
  await h.clicar(/Matemática/);
  assert.match(h.texto(), /Somas simples 3 exercícios/);
  assert.match(h.texto(), /Uma só 1 exercício • Concluída ✅/);
  await h.clicar("←");
  await h.clicar(/Português/);
  assert.match(h.texto(), /Nenhuma lição disponível ainda/);
  h.fechar();
});

test("lições em tempo real: lição criada em outro dispositivo aparece sem recarregar", async () => {
  const h = await A.entrarAluno({});
  assert.match(h.texto(), /Matemática 0\/1 lição/);
  await h.firebase.firestore().collection("licoes").doc("L2").set(F.licao({ titulo: "Nova ao vivo" }));
  await h.estabilizar();
  assert.match(h.texto(), /Matemática 0\/2 lições/);
  h.fechar();
});

// ---------------- Tela de estudo: resumo ----------------
test("resumo gerado pela IA: loading → texto formatado, salvo em licoes_geradas (resumo + exercícios)", async () => {
  const h2 = await A.entrarAluno({});
  await A.abrirLicao(h2);
  assert.equal(A.chamadasResumo(h2.ia), 1);
  const p = h2.ia.chamadas.find(c => /TEXTO DE ESTUDO/.test(c.prompt)).prompt;
  assert.match(p, /Tema: Somas simples/);
  assert.match(p, /Disciplina: Matemática/);
  assert.match(p, /Aluno: 3º ano do Ensino Fundamental I, aproximadamente 8 anos/);
  assert.match(p, /Somar é juntar quantidades\./);
  assert.match(h2.texto(), /✨ Gerado por IA/);
  assert.equal(h2.document.querySelectorAll(".resumo-titulo").length, 5);
  assert.ok(h2.html().includes("<b>juntar quantidades</b>"));
  assert.equal(h2.document.querySelectorAll(".resumo-topico").length, 4);
  const g = h2.store.dados.licoes_geradas.L1;
  assert.equal(g.resumo, F.RESUMO_DIDATICO);
  assert.equal(g.exercicios.length, 3);
  assert.equal(g.licaoId, "L1");
  h2.fechar();
});

test("loading 'Preparando seu resumo' enquanto a IA não responde; sair antes não re-renderiza o estudo", async () => {
  const h = await A.entrarAluno({ rotas: { resumo: { pendurar: true } } });
  await A.abrirLicao(h);
  assert.match(h.texto(), /Preparando seu resumo/);
  await h.clicar("←"); // volta para a lista
  await h.avancar(60000); // IA estoura o tempo
  assert.match(h.texto(), /Somas simples 3 exercícios/, "continua na lista");
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

test("cache em memória: reabrir a lição não chama a IA de novo", async () => {
  const h = await A.entrarAluno({});
  await A.abrirLicao(h);
  await h.clicar("←");
  await h.clicar(/Somas simples/);
  assert.equal(A.chamadasResumo(h.ia), 1);
  assert.match(h.texto(), /O que é somar\?/);
  h.fechar();
});

test("cache compartilhado (licoes_geradas) → usado sem chamar a IA", async () => {
  const h = await A.entrarAluno({ seed: { licoes_geradas: { L1: { licaoId: "L1", resumo: "Resumo do cache compartilhado." } } } });
  await A.abrirLicao(h);
  assert.match(h.texto(), /Resumo do cache compartilhado\./);
  assert.equal(A.chamadasResumo(h.ia), 0);
  h.fechar();
});

test("resumoIA legado no doc da lição → usado e migrado para licoes_geradas", async () => {
  const h = await A.entrarAluno({ seed: { licoes: { L1: F.licao({ resumoIA: "Resumo legado." }) } } });
  await A.abrirLicao(h);
  assert.match(h.texto(), /Resumo legado\./);
  assert.equal(A.chamadasResumo(h.ia), 0);
  assert.equal(h.store.dados.licoes_geradas.L1.resumo, "Resumo legado.");
  h.fechar();
});

test("sem chave neste aparelho → conteúdo do professor com aviso (sem chamadas)", async () => {
  const h = await A.entrarAluno({ semChave: true });
  await A.abrirLicao(h);
  assert.match(h.texto(), /Resumo automático indisponível/);
  assert.match(h.texto(), /Somar é juntar quantidades\./);
  assert.equal(h.ia.chamadas.length, 0);
  assert.equal((h.store.dados.licoes_geradas || {}).L1, undefined);
  h.fechar();
});

for (const [nome, item, avanco] of [["erro 500", { status: 500 }], ["rede", { rede: true }], ["vazio", ""], ["timeout", { pendurar: true }, 30000]]) {
  test(`IA do resumo falha (${nome}) → fallback para o conteúdo do professor, nada salvo`, async () => {
    const h = await A.entrarAluno({ rotas: { resumo: item } });
    await A.abrirLicao(h);
    if (avanco) await h.avancar(avanco);
    await h.aguardar(() => /Resumo automático indisponível/.test(h.texto()));
    assert.match(h.texto(), /Somar é juntar quantidades\./);
    assert.equal((h.store.dados.licoes_geradas || {}).L1, undefined);
    h.fechar();
  });
}

test("conteúdo inseguro vindo da IA é escapado (sem HTML/script injetado)", async () => {
  const h = await A.entrarAluno({ rotas: { resumo: "## <img src=x onerror=alert(1)>\n<script>window.__xss=1</script> **<b>oi</b>**" } });
  await A.abrirLicao(h);
  assert.equal(h.document.querySelector("#app img"), null);
  assert.equal(h.document.querySelector("#app script"), null);
  assert.ok(h.html().includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.equal(h.window.__xss, undefined);
  h.fechar();
});

test("botão 'Já estudei' só é liberado após 10s (contagem regressiva)", async () => {
  const h = await A.entrarAluno({});
  await A.abrirLicao(h);
  const btn = () => h.document.getElementById("btnEstudei");
  assert.equal(btn().disabled, true);
  assert.match(btn().textContent, /Aguarde 10s/);
  await h.avancar(3000);
  assert.match(btn().textContent, /Aguarde 7s/);
  await h.avancar(6000);
  assert.equal(btn().disabled, true, "9s: ainda bloqueado");
  await h.avancar(1000);
  assert.equal(btn().disabled, false);
  assert.match(btn().textContent, /Já estudei, quero responder!/);
  await h.clicar(/Já estudei/);
  assert.match(h.texto(), /Como você quer aprender hoje\?/);
  h.fechar();
});

test("lição sem exercícios: botão 'Sem exercícios — voltar' volta para a lista", async () => {
  const h = await A.entrarAluno({ seed: { licoes: { L1: F.licao({ exercicios: [] }) } } });
  await A.abrirLicao(h);
  await h.avancar(10000);
  await h.clicar(/Sem exercícios — voltar/);
  assert.match(h.texto(), /Somas simples 0 exercícios/);
  h.fechar();
});

test("material de apoio: nomes dos documentos listados na tela de estudo", async () => {
  const h = await A.entrarAluno({ seed: { licoes: { L1: F.licao({ materialNomes: ["apostila.pdf", "<b>x</b>.txt"], materialTipos: ["application/pdf", "text/plain"], materialTexto: "[apostila.pdf]\nconteúdo" }) } } });
  await A.abrirLicao(h);
  assert.match(h.texto(), /📚 Material de Apoio \(2\)/);
  assert.match(h.texto(), /apostila\.pdf/);
  assert.ok(h.html().includes("&lt;b&gt;x&lt;/b&gt;.txt"), "nome escapado");
  assert.match(h.ia.chamadas.find(c => /TEXTO DE ESTUDO/.test(c.prompt)).prompt, /MATERIAL DE APOIO ANEXADO PELO PROFESSOR:\n\[apostila\.pdf\]/);
  h.fechar();
});

// ---------------- Pré-geração de explicações ----------------
test("pré-geração: com chave gera e persiste a explicação de todas as questões ao abrir a lição", async () => {
  const h = await A.entrarAluno({ rotas: { preExplic: ch => "Pré: " + (ch.prompt.match(/Enunciado: (.*)/) || [])[1] } });
  await A.abrirLicao(h);
  await h.estabilizar();
  assert.equal(A.contar(h.ia, /pode errar a seguinte quest/), 3);
  const e = h.store.dados.licoes.L1.explicacoes;
  assert.equal(e.ex1, "Pré: Quanto é 1 + 1?");
  assert.equal(e.ex3, "Pré: Quanto é 3 + 3?");
  h.fechar();
});

test("pré-geração: não roda sem chave nem quando todas já têm explicação", async () => {
  let h = await A.entrarAluno({ semChave: true });
  await A.abrirLicao(h);
  assert.equal(A.contar(h.ia, /pode errar/), 0);
  h.fechar();
  h = await A.entrarAluno({ seed: { licoes: { L1: F.licao({ explicacoes: { ex1: "a", ex2: "b", ex3: "c" } }) } } });
  await A.abrirLicao(h);
  assert.equal(A.contar(h.ia, /pode errar/), 0);
  h.fechar();
});

test("pré-geração: falha em uma questão não impede as demais", async () => {
  let n = 0;
  const h = await A.entrarAluno({ rotas: { preExplic: () => (++n === 1 ? { status: 500 } : "ok " + n) } });
  await A.abrirLicao(h);
  await h.estabilizar();
  const e = h.store.dados.licoes.L1.explicacoes || {};
  assert.equal(Object.keys(e).length, 2);
  h.fechar();
});
