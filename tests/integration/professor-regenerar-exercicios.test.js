// Professor: REGENERAR EXERCÍCIOS — confirmação, contexto, validação, atomicidade/rollback,
// histórico, órfãos, concorrência, erros da IA e permissões.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirApp } = require("../support/app");
const { abrirProfessor, erroIA, ultimoToast, F } = require("../support/professor-helpers");

const CONFIRM = "A regeneração substituirá os exercícios atuais por novas questões. As tentativas e respostas relacionadas poderão ser afetadas. Deseja continuar?";

function seed(extra) {
  return F.banco(Object.assign({
    licoes: {
      L1: F.licao({ explicacoes: { ex1: "explicação antiga 1", ex2: "explicação antiga 2" } }),
      L2: F.licao({ titulo: "Outra lição", exercicios: [F.mc(7)] }),
    },
    licoes_geradas: { L1: { licaoId: "L1", resumo: "## Resumo salvo\nTexto de estudo da lição." } },
    historias_geradas: { L1: { titulo: "História velha", capitulos: [] } },
    progresso: { a1_L1: { alunoId: "a1", licaoId: "L1", acertos: 2, erros: 1, total: 3, concluido: true, percentualAcertos: 67 } },
  }, extra || {}));
}
const enunciados = h => [...h.document.querySelectorAll(".ex-edit-card")].map(c => c.querySelector("input").value);
const copia = v => JSON.parse(JSON.stringify(v));
const docJ = (h, c, id) => { const d = h.store.doc(c, id); return d === undefined ? undefined : copia(d); };

async function abrir(o) { return abrirProfessor(Object.assign({ seed: seed(), editar: "L1" }, o || {})); }

// ---------- visibilidade do botão ----------
test("botão: aparece só em lição salva; desabilitado sem exercícios, sem texto ou sem chave", async () => {
  let h = await abrir();
  assert.equal(h.botao(/Regenerar exercícios com IA \(3\)/).disabled, false);
  await h.clicar(/^Cancelar$/); await h.clicar(/Criar nova lição/);
  assert.equal(h.tem(/Regenerar exercícios/), false, "lição nova (não salva) não tem o botão");
  h.fechar();

  h = await abrir({ seed: seed({ licoes: { L1: F.licao({ exercicios: [] }) } }) });
  assert.equal(h.botao(/Regenerar exercícios com IA \(0\)/).disabled, true);
  assert.match(h.texto(), /Disponível quando a lição tiver exercícios salvos/);
  h.App.regenerarExerciciosIA(); await h.estabilizar();
  assert.match(erroIA(h), /ainda não tem exercícios/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();

  h = await abrir({ seed: seed({ licoes: { L1: F.licao({ conteudo: "" }) } }) });
  assert.equal(h.botao(/Regenerar exercícios/).disabled, true);
  h.App.regenerarExerciciosIA(); await h.estabilizar();
  assert.match(erroIA(h), /Escreva o conteúdo/);
  h.fechar();

  h = await abrir({ semChave: true });
  assert.equal(h.botao(/Regenerar exercícios/).disabled, true);
  h.App.regenerarExerciciosIA(); await h.estabilizar();
  assert.match(erroIA(h), /IA não configurada/);
  assert.equal(h.ia.chamadas.length, 0);
  h.fechar();
});

test("lição nova com exercícios (não salva): handler recusa e pede para salvar", async () => {
  const h = await abrirProfessor();
  await h.clicar(/Criar nova lição/);
  await h.preencher("lTexto", "conteúdo"); await h.clicar(/Adicionar exercício/);
  h.App.regenerarExerciciosIA(); await h.estabilizar();
  assert.equal(ultimoToast(h), "Salve a lição primeiro para regenerar os exercícios.");
  assert.equal(h.confirmacoes.length, 0);
  h.fechar();
});

// ---------- confirmação ----------
test("confirmação: texto exato; cancelar não chama a IA nem altera nada", async () => {
  const h = await abrir({ confirmar: false });
  const antes = copia(h.store.dados);
  await h.clicar(/Regenerar exercícios com IA/);
  assert.deepEqual(h.confirmacoes, [CONFIRM]);
  assert.equal(h.ia.chamadas.length, 0);
  assert.deepEqual(copia(h.store.dados), antes);
  assert.deepEqual(enunciados(h), ["Quanto é 1 + 1?", "Quanto é 2 + 2?", "Quanto é 3 + 3?"]);
  h.fechar();
});

// ---------- sucesso ----------
test("sucesso: substitui atomicamente, mantém quantidade, atualiza UI/cache e preserva o resto", async () => {
  const h = await abrir();
  const L2antes = copia(docJ(h, "licoes", "L2"));
  const progAntes = copia(docJ(h, "progresso", "a1_L1"));
  h.ia.fila(F.json(F.questoesIA(3)));
  await h.clicar(/Regenerar exercícios com IA/);

  const d = docJ(h, "licoes", "L1");
  assert.equal(d.exercicios.length, 3, "mesma quantidade");
  assert.match(d.exercicios[0].enunciado, /Maria tinha 10 figurinhas/);
  assert.ok(d.exercicios.every(e => ["mc", "vf", "fill"].includes(e.tipo) && e.id && !("_explicacao" in e)));
  assert.deepEqual(Object.keys(d.explicacoes).sort(), d.exercicios.map(e => e.id).sort(), "explicações antigas não ficam órfãs");
  assert.equal(d.exerciciosVersao, 1);
  assert.ok(d.exerciciosRegeneradosEm && d.exerciciosRegeneradosEm.seconds > 0);
  assert.equal(d.titulo, "Somas simples"); assert.equal(d.conteudo, "Somar é juntar quantidades.");
  const cache = docJ(h, "licoes_geradas", "L1");
  assert.equal(cache.resumo, "## Resumo salvo\nTexto de estudo da lição.", "conteúdo explicativo NÃO muda");
  assert.equal(cache.exercicios.length, 3);
  assert.equal(docJ(h, "historias_geradas", "L1"), undefined, "história antiga (1 capítulo por questão) removida");
  assert.deepEqual(copia(docJ(h, "progresso", "a1_L1")), progAntes, "histórico do aluno preservado");
  assert.deepEqual(copia(docJ(h, "licoes", "L2")), L2antes, "outra lição intacta");

  const commits = h.store.log.map(l => l.op + " " + l.caminho);
  assert.deepEqual(commits, ["update licoes/L1", "set licoes_geradas/L1", "delete historias_geradas/L1"], "tudo num único batch");
  assert.match(enunciados(h)[0], /Maria tinha 10/);
  assert.equal(ultimoToast(h), "✅ 3 exercícios novos salvos (1F/1I/1D)!");
  assert.equal(erroIA(h), "");
  assert.ok(h.tem(/Regenerar exercícios com IA \(3\)/), "painel volta ao normal");
  assert.deepEqual(h.errosJs(), []);
  h.fechar();
});

test("contexto enviado à IA: tema, disciplina, série, idade, dificuldade, tipos, quantidade, questões atuais e texto de estudo", async () => {
  const exs = [F.mc(1), F.vf(2, 0), F.fill(3, "dez")];
  const h = await abrir({ seed: seed({ licoes: { L1: F.licao({ exercicios: exs, materialTexto: "[a.txt]\nMaterial X" }) } }) });
  h.ia.fila(F.json([
    F.questoesIA(1)[0],
    { nivel: "intermediario", tipo: "verdadeiro_falso", enunciado: "Somar 7 e 8 resulta em 15, verdade?", resposta_correta: "verdadeiro", explicacao: "Tudo bem errar! Sete mais oito dá quinze." },
    { nivel: "dificil", tipo: "completar_lacunas", enunciado: "Juntando 9 bolas com 6 bolas temos ___ bolas.", resposta_correta: "15", explicacao: "Tudo bem errar! Nove mais seis são quinze bolas." },
  ]));
  await h.clicar(/Regenerar exercícios com IA/);
  const p = h.ia.ultimoPrompt();
  for (const re of [/lição "Somas simples" \(Matemática\)/, /Crie exatamente 3 exercícios NOVOS/, /3º ano do Ensino Fundamental I/,
    /aproximadamente 8 anos/, /1 fáceis, 1 intermediários e 1 difíceis/, /1 de múltipla escolha, 1 de verdadeiro\/falso e 1 de completar lacunas/,
    /EXERCÍCIOS ATUAIS \(NÃO repetir\):\n1\. Quanto é 1 \+ 1\?/, /Afirmação número 2/, /Complete a lacuna 3/,
    /TEXTO DE ESTUDO QUE O ALUNO LÊ ANTES[^\n]*\n## Resumo salvo/, /Somar é juntar quantidades/, /Material X/, /"explicacao"/]) assert.match(p, re);
  assert.doesNotMatch(p, /\bdez\b/, "não precisa mandar as respostas atuais");
  const tipos = docJ(h, "licoes", "L1").exercicios.map(e => e.tipo);
  assert.deepEqual(tipos, ["mc", "vf", "fill"], "tipos suportados preservados");
  h.fechar();
});

test("texto de estudo: sem cache em licoes_geradas usa o resumoIA legado da lição", async () => {
  const s = seed({ licoes: { L1: F.licao({ resumoIA: "Resumo legado da lição" }) } });
  delete s.licoes_geradas;
  const h = await abrir({ seed: s });
  h.ia.fila(F.json(F.questoesIA(3)));
  await h.clicar(/Regenerar exercícios com IA/);
  assert.match(h.ia.ultimoPrompt(), /TEXTO DE ESTUDO[^\n]*\nResumo legado da lição/);
  h.fechar();
});

// ---------- validação / rejeição ----------
const base3 = () => F.questoesIA(3);
const INVALIDAS = [
  ["JSON malformado", "[{ \"enunciado\": ", /0 de 3 questões válidas/],
  ["resposta vazia", { json: true, texto: "" }, /0 de 3 questões válidas/],
  ["quantidade menor", F.json(F.questoesIA(2)), /2 de 3 questões válidas/],
  ["duplicadas entre si", F.json([base3()[0], base3()[0], base3()[1]]), /duplicada/],
  ["igual a uma questão atual", F.json([Object.assign(base3()[0], { enunciado: "Quanto é 1 + 1?" }), base3()[1], base3()[2]]), /parecida com uma questão atual/],
  ["alternativa vazia", F.json([Object.assign(base3()[0], { opcoes: ["30", "", "29", "40"] }), base3()[1], base3()[2]]), /alternativas incompletas/],
  ["alternativas repetidas", F.json([Object.assign(base3()[0], { opcoes: ["30", "30", "29", "40"] }), base3()[1], base3()[2]]), /alternativas repetidas/],
  ["correta ausente", F.json([Object.assign(base3()[0], { resposta_correta: "999" }), base3()[1], base3()[2]]), /ausente ou ambígua/],
  ["tipo não suportado", F.json([{ nivel: "facil", tipo: "dissertativa", enunciado: "Explique o que é somar com suas palavras.", resposta_correta: "livre", explicacao: "Tudo bem errar! Somar é juntar quantidades." }, base3()[1], base3()[2]]), /alternativas insuficientes/],
  ["lacuna sem ___", F.json([{ nivel: "facil", tipo: "completar_lacunas", enunciado: "Complete: dois mais dois é", resposta_correta: "4", explicacao: "Tudo bem errar! Dois mais dois é quatro." }, base3()[1], base3()[2]]), /lacuna sem ___/],
  ["sem explicação", F.json([Object.assign(base3()[0], { explicacao: "" }), base3()[1], base3()[2]]), /sem explicação/],
  ["enunciado curto", F.json([Object.assign(base3()[0], { enunciado: "Soma?" }), base3()[1], base3()[2]]), /enunciado vazio ou curto/],
  ["V/F sem resposta válida", F.json([{ nivel: "facil", tipo: "verdadeiro_falso", enunciado: "Somar 2 e 2 dá quatro inteiros?", resposta_correta: "talvez", explicacao: "Tudo bem errar! Dois mais dois é quatro." }, base3()[1], base3()[2]]), /V\/F sem resposta válida/],
];
for (const [nome, resposta, re] of INVALIDAS) {
  test(`validação: ${nome} → rejeita (após 1 nova tentativa) e mantém os exercícios atuais`, async () => {
    const h = await abrir();
    const antes = copia(h.store.dados);
    h.ia.fila(resposta, resposta);
    await h.clicar(/Regenerar exercícios com IA/);
    assert.equal(h.ia.chamadas.length, 2, "tenta de novo uma vez");
    assert.deepEqual(copia(h.store.dados), antes, "banco intacto");
    assert.deepEqual(enunciados(h), ["Quanto é 1 + 1?", "Quanto é 2 + 2?", "Quanto é 3 + 3?"]);
    const msg = erroIA(h);
    assert.match(msg, /questões inválidas/);
    assert.match(msg, re);
    assert.match(msg, /Os exercícios atuais foram mantidos\./);
    h.fechar();
  });
}

test("validação: 1ª resposta inválida e 2ª válida → grava a 2ª", async () => {
  const h = await abrir();
  h.ia.fila(F.json(F.questoesIA(1)), F.json(F.questoesIA(3)));
  await h.clicar(/Regenerar exercícios com IA/);
  assert.equal(h.ia.chamadas.length, 2);
  assert.equal(docJ(h, "licoes", "L1").exercicios.length, 3);
  h.fechar();
});

test("validação: IA devolve MAIS questões que o pedido → grava exatamente a quantidade atual", async () => {
  const h = await abrir();
  h.ia.fila(F.json(F.questoesIA(5)));
  await h.clicar(/Regenerar exercícios com IA/);
  const d = docJ(h, "licoes", "L1");
  assert.equal(d.exercicios.length, 3);
  assert.equal(Object.keys(d.explicacoes).length, 3);
  h.fechar();
});

test("validação: letra A–D como resposta de múltipla escolha é aceita e mapeada", async () => {
  const h = await abrir();
  h.ia.fila(F.json(F.questoesIA(3, i => ({ resposta_correta: "B" }))));
  await h.clicar(/Regenerar exercícios com IA/);
  assert.deepEqual(docJ(h, "licoes", "L1").exercicios.map(e => e.correta), [1, 1, 1]);
  h.fechar();
});

// ---------- erros da IA (sem nova tentativa) ----------
for (const [nome, item, re] of [
  ["429 limite de uso", { status: 429 }, /Limite de uso atingido/],
  ["503 indisponível", { status: 503, mensagem: "Service Unavailable" }, /Erro 503/],
  ["401 chave inválida", { status: 401 }, /Chave da API inválida/],
  ["rede", { rede: true }, /Falha na chamada à OpenAI/],
  ["stream interrompido", { corte: "[{\"niv" }, /interrompida no meio/],
]) {
  test(`erro da IA: ${nome} → mensagem, 1 chamada só, nada muda`, async () => {
    const h = await abrir();
    const antes = copia(h.store.dados);
    h.ia.fila(item);
    await h.clicar(/Regenerar exercícios com IA/);
    assert.equal(h.ia.chamadas.length, 1);
    assert.match(erroIA(h), re);
    assert.match(erroIA(h), /Os exercícios atuais foram mantidos/);
    assert.deepEqual(copia(h.store.dados), antes);
    h.fechar();
  });
}

test("loading + bloqueio: cliques repetidos e salvar são ignorados durante a geração; timeout preserva tudo", async () => {
  const h = await abrir();
  const antes = copia(h.store.dados);
  h.ia.fila({ pendurar: true });
  h.App.regenerarExerciciosIA(); await h.estabilizar();
  assert.match(h.texto(), /Gerando e validando 3 exercícios novos com IA/);
  assert.equal(h.tem(/Regenerar exercícios com IA/), false, "botão some (não dá para clicar de novo)");
  h.App.regenerarExerciciosIA(); h.App.regenerarExerciciosIA(); await h.estabilizar();
  assert.equal(h.confirmacoes.length, 1, "não pede confirmação de novo");
  assert.equal(h.ia.chamadas.length, 1, "não cria requisições duplicadas");
  await h.App.saveLesson(); await h.estabilizar();
  assert.equal(ultimoToast(h), "Aguarde a regeneração dos exercícios terminar.");
  await h.avancar(46000);
  assert.match(erroIA(h), /demorou demais.*mantidos/);
  assert.deepEqual(copia(h.store.dados), antes);
  assert.ok(h.tem(/Regenerar exercícios com IA/));
  h.fechar();
});

// ---------- atomicidade / rollback ----------
test("rollback: falha no commit do batch não altera banco, editor nem cache local", async () => {
  const h = await abrir();
  const antes = copia(h.store.dados);
  h.store.falhar({ op: "commit", erro: Object.assign(new Error("deadline-exceeded"), { code: "deadline-exceeded" }) });
  h.ia.fila(F.json(F.questoesIA(3)));
  await h.clicar(/Regenerar exercícios com IA/);
  assert.deepEqual(copia(h.store.dados), antes, "nenhum documento mudou (exercícios, explicações, versão, cache, história)");
  assert.deepEqual(enunciados(h), ["Quanto é 1 + 1?", "Quanto é 2 + 2?", "Quanto é 3 + 3?"]);
  assert.match(erroIA(h), /deadline-exceeded.*mantidos/);
  // o DATA local também continua o antigo: reabrir o editor mostra as questões antigas
  await h.clicar(/^Cancelar$/); h.App.editLesson("L1"); await h.estabilizar();
  assert.deepEqual(enunciados(h), ["Quanto é 1 + 1?", "Quanto é 2 + 2?", "Quanto é 3 + 3?"]);
  h.fechar();
});

test("rollback: se o documento da lição sumiu (update impossível), nenhuma parte do batch é aplicada", async () => {
  const h = await abrir();
  delete h.store.dados.licoes.L1; // excluída em outro aparelho, sem snapshot ainda
  const antes = copia(h.store.dados);
  h.ia.fila(F.json(F.questoesIA(3)));
  await h.clicar(/Regenerar exercícios com IA/);
  assert.deepEqual(copia(h.store.dados), antes, "licoes_geradas e historias_geradas intocados");
  assert.match(erroIA(h), /No document to update/);
  h.fechar();
});

test("regenerar duas vezes seguidas: versão 2 e explicações sempre casando com os exercícios atuais", async () => {
  const h = await abrir();
  h.ia.fila(F.json(F.questoesIA(3)));
  await h.clicar(/Regenerar exercícios com IA/);
  h.ia.fila(F.json(F.questoesIA(3, i => ({ enunciado: `Pedro guardou ${i + 50} tampinhas numa caixa e achou mais ${i + 60}. Qual o total de tampinhas?` }))));
  await h.clicar(/Regenerar exercícios com IA/);
  const d = docJ(h, "licoes", "L1");
  assert.equal(d.exerciciosVersao, 2);
  assert.match(d.exercicios[0].enunciado, /Pedro guardou/);
  assert.deepEqual(Object.keys(d.explicacoes).sort(), d.exercicios.map(e => e.id).sort());
  assert.match(h.ia.ultimoPrompt(), /1\. Maria tinha 10 figurinhas/, "a 2ª regeneração evita as questões da 1ª");
  h.fechar();
});

// ---------- concorrência ----------
test("concorrência: dois professores regenerando ao mesmo tempo → estado final consistente (sem mistura)", async () => {
  const s = seed();
  const h1 = await abrirProfessor({ seed: s, editar: "L1" });
  const h2 = await abrirProfessor({ store: h1.firebase, relogio: h1.relogio, editar: "L1" });
  h1.ia.fila(F.json(F.questoesIA(3)));
  h2.ia.fila(F.json(F.questoesIA(3, i => ({ enunciado: `Pedro guardou ${i + 50} tampinhas numa caixa e achou mais ${i + 60}. Qual o total de tampinhas?` }))));
  const p1 = h1.App.regenerarExerciciosIA(), p2 = h2.App.regenerarExerciciosIA();
  await Promise.all([p1, p2]); await h1.estabilizar(); await h2.estabilizar();
  const d = docJ(h1, "licoes", "L1");
  assert.equal(d.exerciciosVersao, 2, "os dois commits contaram (increment atômico)");
  assert.equal(d.exercicios.length, 3);
  const grupos = new Set(d.exercicios.map(e => /Maria/.test(e.enunciado) ? "maria" : "pedro"));
  assert.equal(grupos.size, 1, "exercícios de uma única geração");
  assert.deepEqual(Object.keys(d.explicacoes).sort(), d.exercicios.map(e => e.id).sort());
  assert.deepEqual(docJ(h1, "licoes_geradas", "L1").exercicios.map(e => e.id), d.exercicios.map(e => e.id));
  h1.fechar(); h2.fechar();
});

test("concorrência: aluno no meio da tentativa não quebra; próxima tentativa usa a versão nova; sem explicações órfãs", async () => {
  const s = seed();
  const prof = await abrirProfessor({ seed: s, editar: "L1" });
  const aluno = await abrirApp({ store: prof.firebase, relogio: prof.relogio, local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" } });
  aluno.App.openSubject("mat"); aluno.App.openLesson("L1"); await aluno.estabilizar();
  aluno.App.startExercises(); await aluno.estabilizar();
  assert.match(aluno.texto(), /Questão 1 de 3/);
  aluno.App.selectOpt(0); aluno.App.checkAnswer(); aluno.App.nextExercise(); await aluno.estabilizar();

  prof.ia.fila(F.json(F.questoesIA(3)));
  await prof.clicar(/Regenerar exercícios com IA/);
  await aluno.estabilizar();

  assert.match(aluno.texto(), /Questão 2 de 3/);
  assert.match(aluno.texto(), /Quanto é 2 \+ 2\?/, "a tentativa em andamento segue com a versão que começou");
  aluno.App.selectOpt(0); aluno.App.checkAnswer(); aluno.App.nextExercise(); await aluno.estabilizar();
  aluno.App.selectOpt(0); aluno.App.checkAnswer(); aluno.App.nextExercise(); await aluno.estabilizar();
  assert.equal(docJ(aluno, "progresso", "a1_L1").total, 3, "tentativa concluída e registrada");
  assert.deepEqual(aluno.errosJs(), []);

  aluno.App.startExercises(); await aluno.estabilizar();
  assert.match(aluno.texto(), /Maria tinha \d+ figurinhas/, "nova tentativa já usa os exercícios regenerados");
  const d = docJ(prof, "licoes", "L1");
  const ids = d.exercicios.map(e => e.id);
  assert.ok(Object.keys(d.explicacoes).every(k => ids.includes(k)), "nenhuma explicação para questão antiga");
  aluno.fechar(); prof.fechar();
});

// ---------- permissões ----------
test("permissão: aluno logado não consegue regenerar exercícios (nenhuma chamada/escrita)", async () => {
  const aluno = await abrirApp({ seed: seed(), local: F.LOCAL_BASE, sessao: { tipo: "aluno", id: "a1" } });
  aluno.App.regenerarExerciciosIA(); await aluno.estabilizar();
  assert.equal(aluno.confirmacoes.length, 0);
  assert.equal(aluno.ia.chamadas.length, 0);
  for (const c of ["licoes", "licoes_geradas", "historias_geradas"]) assert.equal(aluno.store.escritas(c).length, 0, "sem escrita em " + c);
  assert.equal(docJ(aluno, "licoes", "L1").exercicios[0].id, "ex1");
  aluno.fechar();
});

test("permissão: visitante sem sessão (tela inicial) não consegue regenerar", async () => {
  const h = await abrirApp({ seed: seed(), local: F.LOCAL_BASE });
  h.App.regenerarExerciciosIA(); await h.estabilizar();
  assert.equal(h.ia.chamadas.length, 0);
  assert.equal(h.store.log.length, 0);
  h.fechar();
});
