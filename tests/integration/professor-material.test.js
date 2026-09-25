// Professor: material de apoio (TXT/PDF/DOCX/imagem via OCR), limites, divisão justa do
// orçamento de 60.000 caracteres, remover, salvar e reabrir.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirProfessor, ultimoToast, F } = require("../support/professor-helpers");

function arquivo(h, nome, conteudo, tipo, tamanho) {
  const f = new h.window.File([conteudo], nome, { type: tipo || "" });
  if (tamanho) Object.defineProperty(f, "size", { value: tamanho });
  return f;
}
async function importar(h, arquivos) {
  const input = h.document.querySelector('input[type=file]');
  Object.defineProperty(input, "files", { value: arquivos, configurable: true });
  input.dispatchEvent(new h.window.Event("change"));
  await h.estabilizar(60);
}
const itensLista = h => [...h.document.querySelectorAll("#materialLista .t-lesson-row")].map(r => r.querySelector(".t").textContent);

test("importa TXT, PDF e DOCX, mostra lista/progresso e salva o texto combinado com cabeçalhos", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await importar(h, [
    arquivo(h, "aula.txt", "Conteúdo do TXT", "text/plain"),
    arquivo(h, "livro.pdf", "%PDF", "application/pdf"),
    arquivo(h, "resumo.docx", "PK", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  ]);
  assert.deepEqual(itensLista(h), ["aula.txt", "livro.pdf", "resumo.docx"]);
  assert.match(ultimoToast(h), /✅ 3 documentos lidos!/);
  assert.match(h.texto(), /3 documentos • .* de 60\.000 caracteres/);
  assert.match(h.texto(), /3 de 15 documentos/);
  await h.clicar(/Salvar lição/);
  const d = h.store.doc("licoes", "L1");
  assert.deepEqual([...d.materialNomes], ["aula.txt", "livro.pdf", "resumo.docx"]);
  assert.equal(d.materialTexto, "[aula.txt]\nConteúdo do TXT\n\n[livro.pdf]\nTexto do PDF de teste\n\n[resumo.docx]\nTexto do DOCX de teste");
  assert.equal(d.materialTextos, undefined, "os textos por documento ficam só no estado local");
  h.fechar();
});

test("material entra no prompt de geração de exercícios", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await importar(h, [arquivo(h, "aula.txt", "Frações equivalentes são iguais", "text/plain")]);
  h.ia.fila(F.json(F.questoesIA(2)));
  await h.clicar(/Gerar 15 Exercícios com IA/);
  assert.match(h.ia.ultimoPrompt(), /MATERIAL DE APOIO ANEXADO \(priorize este conteúdo\):\n\[aula\.txt\]\nFrações equivalentes são iguais/);
  h.fechar();
});

test("imagem usa OCR pela visão da IA (conteúdo multimodal) e o texto entra no material", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  h.ia.fila("Texto lido da foto do caderno");
  await importar(h, [arquivo(h, "foto.png", "binario", "image/png")]);
  const c = h.ia.chamadas[0];
  assert.equal(c.body.messages[0].content[0].type, "image_url");
  assert.match(c.body.messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(itensLista(h), ["foto.png"]);
  await h.clicar(/Salvar lição/);
  assert.match(h.store.doc("licoes", "L1").materialTexto, /\[foto\.png\]\nTexto lido da foto do caderno/);
  h.fechar();
});

test("imagem sem chave da IA ou .doc antigo: não extrai texto e avisa (não entra na lista)", async () => {
  const h = await abrirProfessor({ semChave: true, editar: "L1" });
  await importar(h, [arquivo(h, "foto.jpg", "x", "image/jpeg")]);
  assert.match(ultimoToast(h), /Não foi possível extrair texto de "foto\.jpg"/);
  await importar(h, [arquivo(h, "velho.doc", "x", "application/msword")]);
  assert.ok(h.toasts.some(t => /\.doc antigos não permitem extração/.test(t)));
  assert.deepEqual(itensLista(h), []);
  h.fechar();
});

test("falha na extração (PDF corrompido) avisa e segue com os demais arquivos", async () => {
  const h = await abrirProfessor({ editar: "L1", pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error("PDF corrompido")) }) } });
  await importar(h, [arquivo(h, "ruim.pdf", "x", "application/pdf"), arquivo(h, "bom.txt", "ok", "text/plain")]);
  assert.deepEqual(itensLista(h), ["bom.txt"]);
  assert.ok(h.toasts.some(t => /Não foi possível extrair texto de "ruim\.pdf"/.test(t)));
  assert.ok(!h.toasts.some(t => /documentos? lidos?/.test(t)), "sem mensagem de sucesso total quando algo falhou");
  h.fechar();
});

test("recusa formato não suportado e arquivo acima de 10MB (nada é lido)", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await importar(h, [arquivo(h, "virus.exe", "MZ", "application/x-msdownload")]);
  assert.equal(ultimoToast(h), 'Formato não suportado: "virus.exe". Use PDF, DOC, DOCX, TXT, PNG ou JPG.');
  await importar(h, [arquivo(h, "ok.txt", "a", "text/plain"), arquivo(h, "grande.pdf", "x", "application/pdf", 10 * 1024 * 1024 + 1)]);
  assert.equal(ultimoToast(h), '"grande.pdf" tem mais de 10MB. Escolha um arquivo menor.');
  assert.deepEqual(itensLista(h), [], "validação acontece antes de ler qualquer arquivo");
  await importar(h, [arquivo(h, "limite.txt", "a", "text/plain", 10 * 1024 * 1024)]);
  assert.deepEqual(itensLista(h), ["limite.txt"], "exatamente 10MB é aceito");
  h.fechar();
});

test("limite de 15 documentos por lição: recusa o excedente e esconde o importador ao encher", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  const quinze = Array.from({ length: 15 }, (_, i) => arquivo(h, `d${i}.txt`, "texto " + i, "text/plain"));
  await importar(h, quinze.slice(0, 14));
  await importar(h, [arquivo(h, "a.txt", "1", "text/plain"), arquivo(h, "b.txt", "2", "text/plain")]);
  assert.equal(ultimoToast(h), "Máximo de 15 documentos por lição (ainda cabem 1).");
  assert.equal(itensLista(h).length, 14);
  await importar(h, [arquivo(h, "ultimo.txt", "3", "text/plain")]);
  assert.equal(itensLista(h).length, 15);
  assert.match(h.texto(), /Limite de 15 documentos atingido/);
  h.fechar();
});

test("divisão justa do orçamento de 60.000 caracteres: todos os documentos aparecem, sobras vão aos grandes", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  const grande = n => "g".repeat(n);
  await importar(h, [
    arquivo(h, "gigante1.txt", grande(50000), "text/plain"),
    arquivo(h, "gigante2.txt", grande(50000), "text/plain"),
    arquivo(h, "pequeno.txt", "pequeno mas presente", "text/plain"),
  ]);
  assert.match(h.texto(), /resumido p\/ caber/, "painel avisa que os grandes foram resumidos");
  await h.clicar(/Salvar lição/);
  const t = h.store.doc("licoes", "L1").materialTexto;
  assert.ok(t.length <= 60000, "respeita o teto: " + t.length);
  assert.ok(t.length > 59900, "usa o orçamento quase todo");
  assert.match(t, /\[pequeno\.txt\]\npequeno mas presente/, "o documento pequeno não é engolido pelos grandes");
  const b1 = t.split("[gigante2.txt]")[0].length, b2 = t.split("[gigante2.txt]")[1].split("[pequeno.txt]")[0].length;
  assert.ok(Math.abs(b1 - b2) < 50, "os dois grandes recebem cotas iguais");
  h.fechar();
});

test("remover material: confirmação sim/não; recompõe o texto; reabrir lição salva reconstrói os blocos", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await importar(h, [arquivo(h, "um.txt", "primeiro", "text/plain"), arquivo(h, "dois.txt", "segundo", "text/plain")]);
  h.respostaConfirm(false);
  h.App.removerMaterial(0); await h.estabilizar();
  assert.equal(h.confirmacoes[h.confirmacoes.length - 1], 'Remover "um.txt" do material de apoio?');
  assert.equal(itensLista(h).length, 2);
  h.respostaConfirm(true);
  h.App.removerMaterial(0); await h.estabilizar();
  assert.deepEqual(itensLista(h), ["dois.txt"]);
  assert.equal(ultimoToast(h), "Documento removido.");
  h.App.removerMaterial(99); await h.estabilizar(); // índice inválido: ignora
  await h.clicar(/Salvar lição/);
  assert.equal(h.store.doc("licoes", "L1").materialTexto, "[dois.txt]\nsegundo");

  // reabrir: só o texto combinado está salvo; os blocos por documento são reconstruídos
  h.App.editLesson("L1"); await h.estabilizar();
  assert.deepEqual(itensLista(h), ["dois.txt"]);
  assert.match(h.document.querySelector("#materialLista").textContent, /7 caracteres usados/);
  h.fechar();
});

test("reabrir lição com nomes repetidos e cabeçalhos no texto mantém blocos na ordem", async () => {
  const L1 = F.licao({ materialNomes: ["a.txt", "a.txt", "b.txt"], materialTipos: ["", "", ""], materialTexto: "[a.txt]\nX1\n\n[a.txt]\nX2\n\n[b.txt]\nY" });
  const h = await abrirProfessor({ extraSeed: { licoes: { L1 } }, editar: "L1" });
  const infos = [...h.document.querySelectorAll("#materialLista .t-lesson-row")].map(r => r.textContent);
  assert.equal(infos.length, 3);
  assert.ok(infos.every(i => /2 caracteres usados|1 caracteres usados/.test(i)), infos.join(" | "));
  // remover o 2º "a.txt" não afeta o 1º
  h.App.removerMaterial(1); await h.estabilizar();
  await h.clicar(/Salvar lição/);
  assert.equal(h.store.doc("licoes", "L1").materialTexto, "[a.txt]\nX1\n\n[b.txt]\nY");
  h.fechar();
});

test("nome de arquivo com HTML é escapado na lista", async () => {
  const h = await abrirProfessor({ editar: "L1" });
  await importar(h, [arquivo(h, '<img src=x onerror=alert(1)>.txt', "t", "text/plain")]);
  assert.equal(h.document.querySelector("#materialLista img"), null);
  h.fechar();
});
