// Dados de teste (fixtures) — contas, lições e respostas de IA prontas.
// Todos os ids são fixos para que os testes sejam determinísticos.
"use strict";
const crypto = require("crypto");

/** Mesmo hash do app (SHA-256 hex). */
const hash = s => crypto.createHash("sha256").update(String(s)).digest("hex");

const SUBJ_IDS = ["mat", "por", "art", "fil", "red", "geo", "his", "cie", "ing"];

function gamificacao(extra) {
  const disciplinas = {};
  SUBJ_IDS.forEach(id => { disciplinas[id] = { xp: 0, nivel: 1, licoesConcluidas: [] }; });
  return Object.assign({ xpTotal: 0, streak: 0, ultimoDia: null, medalhas: [], premiacoes: [], som: true, disciplinas, licoesConcluidas: [], historiasCompletas: [] }, extra);
}

function aluno(extra) {
  const nome = (extra && extra.nome) || "Ana Souza";
  return Object.assign(gamificacao(), {
    nome, nomeNorm: nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
    idade: 8, nivel: "fund1", ano: "3º ano", turma: "A", senha: hash("senha123"),
  }, extra);
}

function professor(extra) {
  return Object.assign({
    nome: "Prof. Carlos", email: "carlos@escola.com", senha: hash("prof123"),
    turmas: ["A"], anos: ["3º ano"], disciplinas: ["mat", "por"],
  }, extra);
}

/** Exercício de múltipla escolha com enunciado único por índice. */
function mc(i, extra) {
  return Object.assign({ id: "ex" + i, tipo: "mc", nivel: "facil", enunciado: `Quanto é ${i} + ${i}?`,
    opcoes: [String(i * 2), String(i * 2 + 1), String(i * 2 + 2), String(i * 2 + 3)], correta: 0 }, extra);
}
function vf(i, correta, extra) {
  return Object.assign({ id: "ex" + i, tipo: "vf", nivel: "intermediario", enunciado: `Afirmação número ${i} é verdadeira?`, opcoes: ["Verdadeiro", "Falso"], correta: correta || 0 }, extra);
}
function fill(i, resposta, extra) {
  return Object.assign({ id: "ex" + i, tipo: "fill", nivel: "dificil", enunciado: `Complete a lacuna ${i}: ___`, resposta: resposta || "resposta" + i }, extra);
}

function licao(extra) {
  return Object.assign({
    disciplina: "mat", titulo: "Somas simples", conteudo: "Somar é juntar quantidades.",
    exercicios: [mc(1), mc(2), mc(3)], criadoEm: { __ts: 1000 },
    resumoIA: "", turma: "A", ano: "3º ano", nivel: "fund1",
    materialNomes: [], materialTipos: [], materialTexto: "", historiaHabilitada: true, tipo: "padrao",
  }, extra);
}

/**
 * Banco base: 1 aluno (a1), 1 professor (p1), 1 lição de Matemática visível para o aluno
 * (L1, 3 questões), config da IA com chave. Tudo pode ser sobrescrito.
 */
function banco(extra) {
  const b = {
    alunos: { a1: aluno() },
    professores: { p1: professor() },
    licoes: { L1: licao() },
    config: { openai: { apiKey: "sk-teste-NAO-REAL", proxyUrl: "" } },
  };
  for (const c in (extra || {})) b[c] = Object.assign({}, b[c] || {}, extra[c]);
  return b;
}

/** localStorage padrão: marca os exemplos como já semeados (não popula as 27 lições). */
const LOCAL_BASE = { estudamais_seed_firestore: "1" };

// ---------- respostas prontas da IA ----------
const RESUMO_DIDATICO = [
  "## O que é somar?",
  "Somar é **juntar quantidades** para saber quanto temos no total.",
  "## Exemplo 1",
  "- Passo 1: pegue 2 maçãs.",
  "- Passo 2: junte mais 3 maçãs. Agora são 5.",
  "## Exemplo 2",
  "- Passo 1: 4 lápis na mesa.",
  "- Passo 2: ganhe 1 lápis. Total: 5.",
  "## Cuidado!",
  "Não esqueça de contar todos os itens.",
  "## Dica para lembrar",
  "Somar é juntar! Você consegue!",
].join("\n");

/** Array JSON de N questões válidas no formato da IA (regenerar/gerar exercícios). */
function questoesIA(n, extra) {
  const niveis = ["facil", "intermediario", "dificil"];
  return Array.from({ length: n }, (_, i) => Object.assign({
    nivel: niveis[Math.floor(i * 3 / Math.max(n, 1))] || "facil",
    tipo: "multipla_escolha",
    enunciado: `Maria tinha ${i + 10} figurinhas e ganhou ${i + 20}. Quantas figurinhas ela tem agora?`,
    opcoes: [String(2 * i + 30), String(2 * i + 31), String(2 * i + 29), String(2 * i + 40)],
    resposta_correta: String(2 * i + 30),
    explicacao: "Tudo bem errar! Para saber o total, somamos as duas quantidades de figurinhas.",
  }, typeof extra === "function" ? extra(i) : extra));
}
const json = v => "```json\n" + JSON.stringify(v) + "\n```";

module.exports = { hash, aluno, professor, licao, mc, vf, fill, banco, gamificacao, LOCAL_BASE, RESUMO_DIDATICO, questoesIA, json, SUBJ_IDS };
