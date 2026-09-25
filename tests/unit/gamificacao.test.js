// Unitários: regras de gamificação — XP por dificuldade, níveis, ordem das questões,
// recompensa ao concluir, ofensiva (streak) diária e medalhas.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar-app");
const F = require("../support/fixtures");

const j = v => JSON.parse(JSON.stringify(v));
const CONSTS = ["XP_POR_NIVEL", "XP_POR_ACERTO", "XP_BONUS_LICAO", "XP_POR_DIFICULDADE", "ORDEM_NIVEL", "SUBJECTS", "ACHIEVEMENTS"];
const FUNCS = ["nivelDe", "xpNoNivel", "xpDaQuestao", "ordenarPorDificuldade", "atualizarStreak", "concederRecompensa", "statsProgresso", "verificarMedalhas"];

// Date falso: "hoje" fixo, para a ofensiva ser determinística
function dataFixa(ms) {
  class D extends Date { constructor(...a) { if (a.length) super(...a); else super(ms); } static now() { return ms; } }
  return D;
}
const HOJE = new Date(2026, 2, 10, 12).getTime();

function ctx(perfil, opts) {
  opts = opts || {};
  const salvos = [];
  const c = carregar({
    funcoes: FUNCS, constantes: CONSTS,
    stubs: {
      PROFILE: perfil, Date: dataFixa(opts.agora || HOJE),
      saveProfile: () => salvos.push(JSON.stringify(c.PROFILE)),
      // todas as lições concluídas são "visíveis" para o aluno, salvo indicação
      licoesDoAluno: id => (opts.visiveis ? opts.visiveis(id) : (perfil.disciplinas[id].licoesConcluidas || []).map(x => ({ id: x }))),
    },
  });
  c.salvos = salvos;
  return c;
}

test("nivelDe / xpNoNivel: 50 XP por nível", () => {
  const c = ctx(F.gamificacao());
  assert.equal(c.nivelDe(0), 1); assert.equal(c.nivelDe(49), 1); assert.equal(c.nivelDe(50), 2); assert.equal(c.nivelDe(260), 6);
  assert.equal(c.xpNoNivel(0), 0); assert.equal(c.xpNoNivel(73), 23);
});

test("xpDaQuestao: 10/20/30 por dificuldade; sem nível ou nível inválido = 10", () => {
  const c = ctx(F.gamificacao());
  assert.equal(c.xpDaQuestao({ nivel: "facil" }), 10);
  assert.equal(c.xpDaQuestao({ nivel: "intermediario" }), 20);
  assert.equal(c.xpDaQuestao({ nivel: "dificil" }), 30);
  assert.equal(c.xpDaQuestao({ nivel: "" }), 10);
  assert.equal(c.xpDaQuestao({ nivel: "impossivel" }), 10);
  assert.equal(c.xpDaQuestao(null), 10);
});

test("ordenarPorDificuldade: fácil→intermediário→difícil, sem nível no meio, ordem estável, não muta", () => {
  const c = ctx(F.gamificacao());
  const arr = [{ id: "d1", nivel: "dificil" }, { id: "s", nivel: "" }, { id: "f1", nivel: "facil" }, { id: "i1", nivel: "intermediario" }, { id: "f2", nivel: "facil" }, { id: "d2", nivel: "dificil" }];
  const orig = arr.map(e => e.id).join();
  assert.deepEqual(c.ordenarPorDificuldade(arr).map(e => e.id), ["f1", "f2", "s", "i1", "d1", "d2"]);
  assert.equal(arr.map(e => e.id).join(), orig);
  assert.deepEqual(j(c.ordenarPorDificuldade([])), []);
});

test("concederRecompensa: soma XP + bônus 20, marca lição uma vez, sobe de nível e salva", () => {
  const p = F.gamificacao();
  const c = ctx(p);
  const r = c.concederRecompensa("mat", "L1", 40);
  assert.deepEqual(j(r), { ganho: 60, subiuNivel: true, nivel: 2 });
  assert.equal(p.xpTotal, 60); assert.equal(p.disciplinas.mat.xp, 60);
  assert.deepEqual(j(p.disciplinas.mat.licoesConcluidas), ["L1"]);
  // refazer a mesma lição soma XP mas não duplica a lição concluída
  const r2 = c.concederRecompensa("mat", "L1", 0);
  assert.equal(r2.subiuNivel, false); assert.equal(p.xpTotal, 80);
  assert.deepEqual(j(p.disciplinas.mat.licoesConcluidas), ["L1"]);
  assert.ok(c.salvos.length >= 2);
});

test("atualizarStreak: 1º dia = 1; dia seguinte +1; pular um dia zera para 1; mesmo dia não conta de novo", () => {
  const p = F.gamificacao();
  const hoje = new Date(HOJE).toDateString();
  const ontem = new Date(HOJE - 86400000).toDateString();
  const anteontem = new Date(HOJE - 2 * 86400000).toDateString();
  let c = ctx(p); c.atualizarStreak();
  assert.equal(p.streak, 1); assert.equal(p.ultimoDia, hoje);
  c.atualizarStreak(); assert.equal(p.streak, 1, "mesmo dia");
  p.ultimoDia = ontem; p.streak = 4; c.atualizarStreak(); assert.equal(p.streak, 5);
  p.ultimoDia = anteontem; p.streak = 9; c = ctx(p); c.atualizarStreak(); assert.equal(p.streak, 1);
});

test("statsProgresso: só conta lições concluídas que ainda são visíveis ao aluno", () => {
  const p = F.gamificacao();
  p.disciplinas.mat.licoesConcluidas = ["L1", "L-apagada"]; p.disciplinas.mat.nivel = 3;
  p.disciplinas.por.licoesConcluidas = ["P1"];
  const c = ctx(p, { visiveis: id => (id === "mat" ? [{ id: "L1" }] : id === "por" ? [{ id: "P1" }] : []) });
  assert.deepEqual(j(c.statsProgresso()), { totalConcl: 2, discComConcl: 2, nivelMax: 3 });
});

test("verificarMedalhas: desbloqueia as atingidas uma única vez e salva só se houve novidade", () => {
  const p = F.gamificacao({ xpTotal: 120, streak: 3 });
  p.disciplinas.mat.licoesConcluidas = ["L1"];
  const c = ctx(p);
  const novas = j(c.verificarMedalhas({ perfeito: true }).map(m => m.id));
  assert.deepEqual(novas.sort(), ["first", "perfeito", "streak3", "xp100"].sort());
  const salvos = c.salvos.length;
  assert.deepEqual(j(c.verificarMedalhas({ perfeito: true })), [], "não repete");
  assert.equal(c.salvos.length, salvos, "sem novidade não salva");
  assert.deepEqual(j(c.verificarMedalhas()).length, 0, "ctx ausente é tolerado");
});

test("verificarMedalhas: Explorador (3 disciplinas), Grande Mestre (9), Contador de Histórias (5), Especialista (nível 5)", () => {
  const p = F.gamificacao({ historiasCompletas: ["a", "b", "c", "d", "e"] });
  F.SUBJ_IDS.forEach(id => { p.disciplinas[id].licoesConcluidas = [id + "1"]; });
  p.disciplinas.cie.nivel = 5;
  const c = ctx(p);
  const ids = j(c.verificarMedalhas({}).map(m => m.id));
  for (const m of ["explorador", "mestre", "contador", "nivel5", "l5"]) assert.ok(ids.includes(m), m);
  assert.ok(!ids.includes("perfeito"));
  assert.ok(!ids.includes("l10"), "9 lições < 10");
});

test("ACHIEVEMENTS: ids únicos e todos com ícone, título e descrição", () => {
  const c = ctx(F.gamificacao());
  const ids = c.ACHIEVEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length);
  c.ACHIEVEMENTS.forEach(a => { assert.ok(a.icon && a.titulo && a.desc, a.id); assert.equal(typeof a.check, "function"); });
});
