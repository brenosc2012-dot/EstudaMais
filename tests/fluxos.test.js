// Testes dos três fluxos: reinício embaralhado após erro, regenerar exercícios e
// prompt do texto de estudo. Rodar com:  node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar-app");

const PURAS = ["norm", "esc", "uid", "fmtInline", "formatResumo", "linhasTexto", "paragrafosTexto",
  "tipoLabel", "nivelDificuldadeLabel", "contarPorDificuldade", "normalizarNivelDif", "acharIndiceCorreto",
  "sanitizarControlesJson", "jsonParseTolerante", "parseExerciciosIA", "similaridadeEnunciados",
  "validarExerciciosRegenerados", "ehLinguaEstrangeira", "blocoLinguaEstrangeira", "timeoutComMaterial",
  "mensagemErroIA", "montarPromptResumo", "montarPromptRegenerarExercicios"];
const CONSTS = ["REGEN_SIMILAR_ANTIGA", "REGEN_SIMILAR_NOVA", "REGEN_EX_TENTATIVAS", "LINGUAS_ESTRANGEIRAS"];
const SUBJ = { mat: { id: "mat", nome: "Matemática" }, ing: { id: "ing", nome: "Inglês" } };

function exs(n) {
  return Array.from({ length: n }, (_, i) => ({ id: "e" + i, tipo: "mc", nivel: "facil",
    enunciado: "Pergunta original número " + i, opcoes: ["a", "b", "c", "d"], correta: 0 }));
}

// ============ 1) Reinício da atividade após erro ============
function ctxSessao(licao) {
  const ctx = carregar({
    funcoes: ["esc", "fmtInline", "formatResumo", "embaralharTentativa", "novaSessao",
              "reiniciarTentativaAposErro", "continuarAposExplicacao", "renderExplain"],
    stubs: {
      Sess: null, State: { subj: "mat", lesson: licao && licao.id, tela: "explain", explic: { texto: "Explicação", respCorreta: "x" } },
      app: { innerHTML: "" }, getLesson: () => licao, renders: 0, toasts: [],
      mascot: () => "", botaoFala: () => "", agendarAutoLeitura: () => {}, openSubject: () => { ctx.saiu = true; },
    },
  });
  ctx.render = () => { ctx.renders++; };
  ctx.toast = m => ctx.toasts.push(m);
  return ctx;
}

test("embaralharTentativa: mesmas questões, ordem nova, original intacto", () => {
  const ctx = carregar({ funcoes: ["embaralharTentativa"] });
  const orig = exs(5);
  const copiaIds = orig.map(e => e.id).join();
  for (let k = 0; k < 300; k++) {
    const out = ctx.embaralharTentativa(orig, orig);
    assert.equal(out.length, 5);
    assert.deepEqual(out.map(e => e.id).sort(), orig.map(e => e.id).sort());
    assert.notEqual(out.map(e => e.id).join(), copiaIds, "deve diferir da tentativa anterior");
  }
  assert.equal(orig.map(e => e.id).join(), copiaIds, "não pode alterar a ordem permanente");
});

test("embaralharTentativa: 2 questões sempre trocam; 1 questão só reinicia", () => {
  const ctx = carregar({ funcoes: ["embaralharTentativa"] });
  const dois = exs(2);
  for (let k = 0; k < 50; k++) assert.deepEqual(ctx.embaralharTentativa(dois, dois).map(e => e.id), ["e1", "e0"]);
  const um = exs(1);
  const r = ctx.embaralharTentativa(um, um);
  assert.deepEqual(r.map(e => e.id), ["e0"]);
  assert.notEqual(r, um, "devolve cópia");
});

test("após a explicação, reinicia na 1ª questão com tudo zerado e nova ordem", () => {
  const licao = { id: "L1", exercicios: exs(6) };
  const ctx = ctxSessao(licao);
  const anterior = licao.exercicios.slice();
  ctx.Sess = Object.assign(ctx.novaSessao(anterior, "classico"),
    { idx: 4, acertos: 4, erros: 1, vidas: 2, xpGanho: 40, respondido: true, selecionado: 2, respAluno: "b",
      revisao: [{ ok: true }, { ok: false }] });
  ctx.continuarAposExplicacao();
  const S = ctx.Sess;
  assert.equal(S.idx, 0); assert.equal(S.acertos, 0); assert.equal(S.erros, 0);
  assert.equal(S.xpGanho, 0); assert.equal(S.vidas, 3); assert.equal(S.respondido, false);
  assert.equal(S.selecionado, null); assert.equal(S.respAluno, ""); assert.equal(S.revisao.length, 0);
  assert.equal(S.modo, "classico"); assert.equal(S.total, 6);
  assert.equal(ctx.State.tela, "exercise");
  assert.notEqual(S.exercicios.map(e => e.id).join(), anterior.map(e => e.id).join());
  assert.deepEqual(licao.exercicios.map(e => e.id), ["e0", "e1", "e2", "e3", "e4", "e5"], "lição não muda");
  assert.equal(ctx.renders, 1);
});

test("clique duplo em 'Entendi' não reinicia duas vezes nem avança", () => {
  const licao = { id: "L1", exercicios: exs(4) };
  const ctx = ctxSessao(licao);
  ctx.Sess = ctx.novaSessao(licao.exercicios.slice(), "classico");
  ctx.continuarAposExplicacao();
  const sess1 = ctx.Sess;
  ctx.Sess.idx = 1; // aluno já está respondendo a nova tentativa
  ctx.continuarAposExplicacao(); // 2º clique atrasado
  assert.equal(ctx.Sess, sess1); assert.equal(ctx.Sess.idx, 1); assert.equal(ctx.renders, 1);
});

test("tela de explicação avisa que a atividade será reiniciada", () => {
  const licao = { id: "L1", exercicios: exs(3) };
  const ctx = ctxSessao(licao);
  ctx.Sess = ctx.novaSessao(licao.exercicios, "classico");
  ctx.renderExplain();
  assert.match(ctx.app.innerHTML, /Revise a explicação e tente novamente\. A atividade será reiniciada com uma nova ordem de questões\./);
  assert.match(ctx.app.innerHTML, /Explicação/, "a explicação da IA continua na tela");
  ctx.Sess = ctx.novaSessao(exs(1), "classico");
  ctx.renderExplain();
  assert.doesNotMatch(ctx.app.innerHTML, /nova ordem/);
});

// ============ 2) Regenerar exercícios ============
function itemIA(i, extra) {
  return Object.assign({ nivel: "facil", tipo: "multipla_escolha", enunciado: `Quanto é ${i + 2} vezes ${i + 7} em uma conta de mercado?`,
    opcoes: ["Opção alfa " + i, "Opção beta " + i, "Opção gama " + i, "Opção delta " + i], resposta_correta: "Opção beta " + i,
    explicacao: "Tudo bem errar! A resposta certa é a beta porque multiplicamos os dois números." }, extra);
}
const respostaIA = arr => "```json\n" + JSON.stringify(arr) + "\n```";

function ctxRegen(opts) {
  opts = opts || {};
  const atuais = exs(3);
  const ops = [];
  const licaoSalva = { id: "L1", exercicios: atuais.map(e => Object.assign({}, e)), explicacoes: { e0: "velha" }, exerciciosVersao: 0, resumoIA: "" };
  const ctx = carregar({
    funcoes: PURAS.concat(["gravarExerciciosRegenerados", "regenerarExerciciosIA"]),
    constantes: CONSTS,
    stubs: {
      DEMO: false, ehModoDemo: () => false, historiaCache: { L1: { velha: true } }, resumoCache: {},
      DATA: { mat: [licaoSalva] },
      Teacher: { subj: "mat", editingLesson: { id: "L1", _persistido: true, titulo: "Multiplicação", texto: "Multiplicar é somar parcelas iguais.",
        exercicios: atuais, materialTexto: "", nivel: "fund1", ano: "3º ano" }, iaErro: "" },
      syncTextInputs: () => {}, render: () => {}, toasts: [], confirm: () => opts.confirmar !== false,
      iaConfigurada: () => true, subjById: id => SUBJ[id], nomeNivel: () => "Ensino Fundamental I",
      descreverPublicoLicao: () => ({ ano: "3º ano", nivelId: "fund1", idade: 8, frase: "Adapte para 8 anos." }),
      getLicaoGerada: async () => ({ resumo: "## O que é?\nMultiplicar é somar parcelas iguais." }),
      prompts: [],
      firebase: { firestore: { FieldValue: { increment: n => ({ inc: n }), serverTimestamp: () => "TS" } } },
      db: {
        collection: c => ({ doc: d => ({ path: c + "/" + d }) }),
        batch: () => ({
          update: (r, v) => ops.push(["update", r.path, v]),
          set: (r, v, o) => ops.push(["set", r.path, v, o]),
          delete: r => ops.push(["delete", r.path]),
          commit: async () => { if (opts.commitFalha) throw new Error("Falha de rede ao gravar"); ops.push(["commit"]); },
        }),
      },
    },
  });
  ctx.toast = m => ctx.toasts.push(m);
  const respostas = opts.respostas || [respostaIA([0, 1, 2].map(i => itemIA(i)))];
  let k = 0;
  ctx.chamarIA = async (prompt) => {
    ctx.prompts.push(prompt);
    const r = respostas[Math.min(k++, respostas.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return { ctx, ops, atuais, licaoSalva };
}

test("regenerar: gera, valida e grava tudo num batch atômico (resumo intacto)", async () => {
  const { ctx, ops, licaoSalva } = ctxRegen();
  await ctx.regenerarExerciciosIA();
  assert.equal(ctx.Teacher.iaErro, "");
  assert.deepEqual(ops.map(o => o[0]), ["update", "set", "delete", "commit"]);
  const [, pathL, upd] = ops[0];
  assert.equal(pathL, "licoes/L1");
  assert.equal(upd.exercicios.length, 3, "mantém a quantidade atual");
  assert.ok(upd.exercicios.every(e => !("_explicacao" in e)), "campo temporário não vai ao banco");
  assert.equal(Object.keys(upd.explicacoes).sort().join(), upd.exercicios.map(e => e.id).sort().join(), "explicações só das novas questões");
  assert.deepEqual(upd.exerciciosVersao, { inc: 1 });
  assert.equal(ops[1][1], "licoes_geradas/L1");
  assert.ok(!("resumo" in ops[1][2]), "não toca no resumo de estudo");
  assert.equal(ops[1][3].merge, true);
  assert.equal(ops[2][1], "historias_geradas/L1");
  assert.equal(ctx.Teacher.editingLesson.exercicios[0].enunciado, upd.exercicios[0].enunciado);
  assert.equal(licaoSalva.exercicios[0].enunciado, upd.exercicios[0].enunciado, "DATA local atualizado");
  assert.equal(licaoSalva.exerciciosVersao, 1);
  assert.equal(ctx.historiaCache.L1, undefined);
  assert.equal(ctx.Teacher.regenerandoEx, false);
  assert.match(ctx.toasts.pop(), /3 exercícios novos/);
  // o prompt leva as questões atuais (para não repetir), a quantidade e o texto de estudo
  const p = ctx.prompts[0];
  assert.match(p, /exatamente 3 exercícios NOVOS/);
  assert.match(p, /Pergunta original número 0/);
  assert.match(p, /TEXTO DE ESTUDO/);
  assert.match(p, /3 de múltipla escolha, 0 de verdadeiro\/falso e 0 de completar lacunas/);
});

test("regenerar: resposta inválida da IA (2x) mantém os exercícios atuais", async () => {
  const ruim = respostaIA([itemIA(0, { resposta_correta: "não existe" }), itemIA(1), itemIA(2)]);
  const { ctx, ops, atuais, licaoSalva } = ctxRegen({ respostas: [ruim, ruim] });
  const antes = JSON.stringify(licaoSalva.exercicios);
  await ctx.regenerarExerciciosIA();
  assert.equal(ctx.prompts.length, 2, "tenta de novo uma vez");
  assert.equal(ops.length, 0, "nada foi gravado");
  assert.equal(ctx.Teacher.editingLesson.exercicios, atuais);
  assert.equal(JSON.stringify(licaoSalva.exercicios), antes);
  assert.match(ctx.Teacher.iaErro, /inválidas.*ambígua.*mantidos/);
  assert.equal(ctx.Teacher.regenerandoEx, false);
});

test("regenerar: 1ª resposta inválida, 2ª válida → grava a 2ª", async () => {
  const ruim = respostaIA([itemIA(0)]); // só 1 de 3
  const { ctx, ops } = ctxRegen({ respostas: [ruim, respostaIA([0, 1, 2].map(i => itemIA(i)))] });
  await ctx.regenerarExerciciosIA();
  assert.equal(ctx.prompts.length, 2);
  assert.equal(ops[ops.length - 1][0], "commit");
});

test("regenerar: timeout da IA e falha ao gravar preservam tudo", async () => {
  let t = ctxRegen({ respostas: [new Error("timeout")] });
  await t.ctx.regenerarExerciciosIA();
  assert.equal(t.ops.length, 0);
  assert.match(t.ctx.Teacher.iaErro, /demorou demais.*mantidos/);

  t = ctxRegen({ commitFalha: true });
  const antes = JSON.stringify(t.licaoSalva.exercicios);
  await t.ctx.regenerarExerciciosIA();
  assert.equal(t.ctx.Teacher.editingLesson.exercicios, t.atuais, "editor intacto");
  assert.equal(JSON.stringify(t.licaoSalva.exercicios), antes, "DATA intacto");
  assert.equal(t.licaoSalva.exerciciosVersao, 0);
  assert.match(t.ctx.Teacher.iaErro, /Falha de rede ao gravar.*mantidos/);
});

test("regenerar: cancelar na confirmação, lição não salva e clique duplo não fazem nada", async () => {
  let t = ctxRegen({ confirmar: false });
  await t.ctx.regenerarExerciciosIA();
  assert.equal(t.ctx.prompts.length, 0);

  t = ctxRegen();
  t.ctx.Teacher.editingLesson._persistido = false;
  await t.ctx.regenerarExerciciosIA();
  assert.equal(t.ctx.prompts.length, 0);
  assert.match(t.ctx.toasts[0], /Salve a lição primeiro/);

  t = ctxRegen();
  const p1 = t.ctx.regenerarExerciciosIA();
  const p2 = t.ctx.regenerarExerciciosIA(); // enquanto a 1ª está em andamento
  await Promise.all([p1, p2]);
  assert.equal(t.ctx.prompts.length, 1);
  assert.equal(t.ops.filter(o => o[0] === "commit").length, 1);
});

test("validação: rejeita duplicadas, parecidas com as atuais, incompletas e sem explicação", () => {
  const ctx = carregar({ funcoes: PURAS, constantes: CONSTS, stubs: { subjById: id => SUBJ[id] } });
  const atuais = [{ enunciado: "Quanto é 2 vezes 7 em uma conta de mercado?" }];
  const casos = [
    [itemIA(0)], // igual a uma atual
    [itemIA(1), itemIA(1)], // duplicada entre as novas
    [itemIA(1, { opcoes: ["x", "", "y", "z"] })], // alternativa vazia
    [itemIA(1, { opcoes: ["x", "x", "y", "z"], resposta_correta: "y" })], // alternativas repetidas
    [itemIA(1, { explicacao: "" })], // sem justificativa
    [itemIA(1, { tipo: "completar_lacunas", enunciado: "Complete sem lacuna nenhuma aqui", resposta_correta: "x" })],
    [itemIA(1, { tipo: "verdadeiro_falso", resposta_correta: "talvez" })],
  ];
  casos.forEach((arr, i) => {
    const rej = [];
    const n = arr.length === 2 ? 2 : 1;
    const r = ctx.validarExerciciosRegenerados(ctx.parseExerciciosIA(respostaIA(arr), { estrito: true, rejeitados: rej }), atuais, n, rej);
    assert.equal(r.ok, false, "caso " + i + " deveria falhar");
  });
  // caso bom: V/F e lacuna válidos
  const bons = [itemIA(1, { tipo: "verdadeiro_falso", resposta_correta: "Falso" }),
    itemIA(2, { tipo: "completar_lacunas", enunciado: "Na multiplicação, 3 x 4 é igual a ___ .", resposta_correta: "12" })];
  const rej = [];
  const r = ctx.validarExerciciosRegenerados(ctx.parseExerciciosIA(respostaIA(bons), { estrito: true, rejeitados: rej }), atuais, 2, rej);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.exercicios[0].correta, 1);
  assert.equal(r.exercicios[1].resposta, "12");
});

test("parser sem modo estrito continua como antes (compatibilidade)", () => {
  const ctx = carregar({ funcoes: PURAS, constantes: CONSTS, stubs: { subjById: id => SUBJ[id] } });
  const out = ctx.parseExerciciosIA(respostaIA([itemIA(0, { resposta_correta: "B" })]));
  assert.equal(out.length, 1);
  assert.equal(out[0].correta, 1);
  assert.ok(!("_explicacao" in out[0]));
});

// ============ 3) Texto de estudo (prompt + formatação) ============
test("prompt do texto de estudo traz contexto e as regras didáticas", () => {
  const ctx = carregar({ funcoes: PURAS, constantes: CONSTS, stubs: { subjById: id => SUBJ[id] } });
  const l = { titulo: "Frações", texto: "Fração representa partes de um todo.", materialTexto: "Apostila p.12",
    exercicios: [{ tipo: "mc", nivel: "facil", enunciado: "Qual fração representa metade?", opcoes: ["1/2", "1/3"], correta: 0 },
                 { tipo: "fill", nivel: "dificil", enunciado: "Um quarto se escreve ___", resposta: "1/4" }] };
  const p = ctx.montarPromptResumo(l, { ano: "4º ano", nivelNome: "Ensino Fundamental I", idade: 9, frase: "Adapte para 9 anos." }, "mat");
  [/Tema: Frações/, /Disciplina: Matemática/, /4º ano do Ensino Fundamental I, aproximadamente 9 anos/,
   /1 fáceis, 0 intermediárias e 1 difíceis/, /Múltipla escolha, Complete a lacuna/, /Conhecimentos prévios/,
   /português do Brasil/, /PELO MENOS 2 exemplos práticos resolvidos passo a passo/, /Cuidado!/,
   /NÃO resolva nem revele as respostas/, /no máximo 450 palavras/, /Apostila p\.12/,
   /Qual fração representa metade\?/, /Adapte para 9 anos\./].forEach(re => assert.match(p, re));
  assert.doesNotMatch(p, /1\/4/, "não entrega a resposta da lacuna");
  // língua estrangeira ganha a instrução de tradução
  assert.match(ctx.montarPromptResumo(l, { ano: "6º ano", nivelNome: "EF II", idade: 11, frase: "" }, "ing"), /língua inglesa/);
});

test("texto de estudo: títulos e negrito renderizados, HTML escapado, voz sem marcação", () => {
  const ctx = carregar({ funcoes: PURAS, constantes: CONSTS, stubs: { subjById: id => SUBJ[id] } });
  const txt = "## O que é?\nUma **fração** <b>é</b> parte.\n- Passo 1: dividir";
  const html = ctx.formatResumo(txt);
  assert.match(html, /<div class="resumo-titulo">O que é\?<\/div>/);
  assert.match(html, /<b>fração<\/b>/);
  assert.match(html, /&lt;b&gt;é&lt;\/b&gt;/, "conteúdo da IA continua escapado");
  const voz = ctx.paragrafosTexto(txt);
  assert.equal(voz.length, ctx.linhasTexto(txt).length, "índices da leitura batem com os parágrafos");
  assert.equal(voz[0], "O que é?");
  assert.equal(voz[1], "Uma fração <b>é</b> parte.");
});
