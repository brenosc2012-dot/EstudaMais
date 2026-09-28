// Respostas determinísticas da IA para as ETAPAS DO PREPARO da lição (análise de documento,
// plano de cobertura, conteúdo de estudo). Os exercícios continuam vindo da fila de cada teste:
// o preparo é respondido por `ia.interceptar`, que não consome a fila (e registra as chamadas
// em `ia.chamadasInterceptadas`, deixando `ia.chamadas` só com as de exercícios/resumo/etc.).
//
//   usarPreparo(h, { extra, analise, plano, conteudo })
//   - extra: texto acrescentado a cada seção do conteúdo (vocabulário que as questões usam)
//   - analise/plano/conteudo: item | fn(chamada) | [itens em ordem] — substituem o padrão
"use strict";

const TIPOS = {
  analise: /Analise a PARTE \d+ DE \d+ do documento/,
  plano: /^PLANO DE COBERTURA DA LIÇÃO/,
  conteudo: /^CONTEÚDO DE ESTUDO ESTRUTURADO/,
};
function tipoPreparo(prompt) {
  for (const k in TIPOS) if (TIPOS[k].test(prompt)) return k;
  return null;
}
const COMUNS = new Set(["para", "como", "qual", "quais", "este", "esta", "isso", "isto", "mais", "muito", "sobre", "quando", "onde", "porque", "também",
  "the", "and", "with", "that", "this", "from", "have", "your", "what", "does", "lição", "texto", "nesta", "sobre"]);
function palavras(t, n) {
  const out = [];
  String(t || "").toLowerCase().split(/[^0-9a-zà-ÿ]+/i).forEach(w => { if (w.length >= 4 && !COMUNS.has(w) && out.indexOf(w) < 0 && out.length < n) out.push(w); });
  return out;
}
// Vocabulário usado pelas fixtures de exercícios dos testes (para as questões se apoiarem no conteúdo).
const VOCAB_TESTES = [
  "Somar é juntar quantidades: quantas figurinhas, bolinhas, lápis, balas, livros, carrinhos, adesivos, bonecas, moedas, flores, pipas, botões,",
  "tampinhas, conchas, cartas, blocos, fitas, chaveiros, pulseiras e selos alguém tinha, ganhou, guardou, achou ou comprou — o total.",
  "Personagens dos exemplos: Maria, João, Ana, Pedro, Luísa, Caio, Beatriz, Rafael, Sofia, Gabriel, Helena, Davi, Clara, Enzo, Lara, Theo, Alice, Miguel, Laura, Arthur.",
  "Contas: quanto é, vezes, dobro, afirmação verdadeira ou falsa, complete a lacuna, letras e vogais, mercado, padaria, farmácia, papelaria, feira, livraria, sorveteria, quitanda.",
].join(" ");

function analisePadrao(ch) {
  const nome = (ch.prompt.match(/do documento "([^"]+)"/) || [])[1] || "documento";
  const parte = (ch.prompt.match(/<<<\n([\s\S]*?)\n>>>/) || [])[1] || "";
  const textos = [...parte.matchAll(/"""([\s\S]+?)"""/g)].map(m => m[1]);
  return JSON.stringify({ topicos: [{ topico: "Conteúdo de " + nome.replace(/\.[a-z]+$/i, ""), conceitos: palavras(parte, 12), fatos: [parte.slice(0, 200)], exemplos: [], vocabulario: [], textos }] });
}
function planoPadrao(ch) {
  const p = ch.prompt;
  const desc = ((p.match(/DESCRIÇÃO DO PROFESSOR \(fonte principal\):\n([\s\S]*?)\n\nNOTAS DOS DOCUMENTOS:/) || [])[1] || "").trim();
  const notas = (p.match(/NOTAS DOS DOCUMENTOS:\n([\s\S]*?)(\n\nEXERCÍCIOS JÁ EXISTENTES|$)/) || [])[1] || "";
  const topicos = [];
  if (desc && desc !== "(vazia)") topicos.push({ id: "T1", topico: "Tema da descrição", fontes: ["descricao"], conceitos: palavras(desc, 10), obrigatorio: true });
  notas.split(/\n(?=\[doc\d+\])/).forEach(bloco => {
    const m = bloco.match(/^\[(doc\d+)\] (.+)/);
    if (!m) return;
    topicos.push({ id: "T" + (topicos.length + 1), topico: "Assunto de " + m[2].replace(/ \(texto.*$/, ""), fontes: [m[1]], conceitos: palavras(bloco.replace(/^.*\n/, ""), 10), obrigatorio: true });
  });
  return JSON.stringify({ suficiente: true, topicos, objetivos: [{ id: "O1", texto: "Aplicar o que foi estudado na lição", topicos: topicos.map(t => t.id) }], divergencias: [] });
}
function textoSecao(nome, conceitos, extra) {
  return `Nesta seção você vai estudar **${nome}**. Os pontos principais são: ${conceitos.join(", ") || "as ideias da lição"}. ${extra}
- Exemplo 1: Passo 1, leia com atenção o que foi pedido. Passo 2, use o que você aprendeu para resolver.
- Exemplo 2: veja como aplicar a ideia em uma situação do dia a dia, com calma e sem pressa.
Cuidado: não confunda os conceitos; revise quando tiver dúvida.`;
}
function conteudoPadrao(ch, extra) {
  const p = ch.prompt;
  const topicos = [...p.matchAll(/^(T\d+b?): (.+?)(?: \(obrigatório\))? — fontes: [^\n]*?(?: — conceitos: ([^\n]*))?$/gm)].map(m => ({ id: m[1], nome: m[2], conceitos: (m[3] || "").split(/;\s*/).filter(Boolean) }));
  const faltando = (p.match(/escreva AGORA seções SÓ para o que faltou: ([^\n]*)/) || [])[1];
  const alvo = faltando ? topicos.filter(t => faltando.indexOf(t.id + " (") >= 0) : topicos;
  const lista = alvo.length ? alvo : topicos;
  return JSON.stringify({
    secoes: lista.map((t, k) => ({ id: "S" + (k + 1), titulo: t.nome, topicos: [t.id], texto: textoSecao(t.nome, t.conceitos, extra) })),
    verificacao: ["O que você aprendeu nesta lição?"], resumo_final: ["Revise os pontos principais da lição."],
  });
}
function resolver(v, ch, contagem) {
  if (Array.isArray(v)) { const i = contagem++; return [v[Math.min(i, v.length - 1)], contagem]; }
  return [typeof v === "function" ? v(ch) : v, contagem];
}
function usarPreparo(h, o) {
  o = o || {};
  const extra = o.extra != null ? o.extra : VOCAB_TESTES;
  const cont = { analise: 0, plano: 0, conteudo: 0 };
  const chamadas = [];
  h.ia.chamadasInterceptadas = chamadas;
  h.ia.interceptar(ch => {
    const t = tipoPreparo(ch.prompt);
    if (!t) return undefined;
    chamadas.push(Object.assign({ tipo: t }, ch));
    if (o[t] !== undefined) { const [r, c] = resolver(o[t], ch, cont[t]); cont[t] = c; return r; }
    return t === "analise" ? analisePadrao(ch) : t === "plano" ? planoPadrao(ch) : conteudoPadrao(ch, extra);
  });
  return { chamadas, de: t => chamadas.filter(c => c.tipo === t) };
}

module.exports = { usarPreparo, tipoPreparo, analisePadrao, planoPadrao, conteudoPadrao, textoSecao, VOCAB_TESTES };
