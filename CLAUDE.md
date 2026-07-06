# CLAUDE.md

Guia para o Claude Code trabalhar neste repositório.

## Visão geral

**EstudaMais** é um app web de estudos **gamificado** inspirado no Duolingo, para
alunos do **1º ano do Ensino Fundamental ao 3º ano do Ensino Médio** (6 a 18 anos).
A linguagem/complexidade do conteúdo gerado por IA é adaptada à faixa etária do aluno.
Disciplinas: Matemática, Português, Artes, Filosofia, Redação, Geografia, História,
Ciências e Inglês.

> **Versão 2.0 (multiusuário):** o app deixou de ser "aluno anônimo + senha única de
> professor". Agora há **contas** de aluno e de professor (login/cadastro), turmas,
> e o progresso do aluno fica na **nuvem** (Firestore), sincronizando entre aparelhos.
> Níveis de ensino: Fund. I (1º–5º), Fund. II (6º–9º), Médio (1º–3º).

O núcleo do app é o **`index.html`** (HTML + CSS + JS puro, tudo inline; sem build/bundler).
Há poucos arquivos de apoio na raiz: `manifest.json`, `sw.js` (service worker) e `icon.svg`
para o **PWA** (instalável + offline), e `firestore.rules` (regras de partida do Firestore).
Firebase entra por CDN. Funciona offline após o primeiro carregamento (o service worker
faz cache do app shell; HTML em network-first para sempre pegar a versão fresca online).

## Como rodar

- Abra `index.html` diretamente no navegador (duplo clique) **ou** use um servidor
  estático (ex.: Live Server do VS Code).
- **Importante:** após editar, recarregue com **Ctrl+Shift+R** (hard reload) — o
  navegador costuma servir a versão em cache do arquivo.
- **Requer internet** para carregar o Firebase (CDN) e as lições do Firestore. Os
  recursos de IA também exigem rede. O resto (gamificação/progresso) é local.
- Não há testes automatizados nem passo de compilação.

## Validar alterações no JavaScript

O JS fica embutido no **último** bloco `<script>...</script>` (há também 2 `<script src>`
do Firebase, sem conteúdo inline). Para checar a sintaxe sem abrir o navegador:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const b=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('_check.js',b[b.length-1][1]);" && node --check _check.js && echo OK && rm -f _check.js
```

Sempre rode isso após mexer no JavaScript.

## Estrutura do `index.html`

O CSS e o JS são organizados em seções comentadas. No JavaScript (dentro de uma IIFE
`(function(){ "use strict"; ... })()`):

- **A) DADOS** — `ADMIN_PASSWORD`, chaves do localStorage, `NIVEIS_ENSINO`,
  helpers de faixa etária (`descreverPublico`/`descreverPublicoLicao`), config do
  Firebase/IA (OpenAI), `hashSenha` (SHA-256), `SUBJECTS` e `seedData()`.
- **B) ESTADO & UTILITÁRIOS** — `DATA`, `PROFILE`, `IA`; `uid`, `esc`, `norm`, `toast`,
  `mascot` (SVG), módulo `Sound` (Web Audio API), load/save do localStorage.
- **C) GAMIFICAÇÃO** — XP, vidas, streak, níveis (`concederRecompensa`), e medalhas
  (`ACHIEVEMENTS`, `verificarMedalhas`, `statsProgresso`).
- **D) UI DO ALUNO** — `render()` central + telas: `home`, `lessons`, `study`,
  `exercise`, `explain`, `done`, `profile`. Estado em `State` e sessão de exercícios
  em `Sess`. A tela `study` mostra um **resumo gerado por IA** antes dos exercícios
  (botão liberado após contagem de 10s, com cache por sessão em `resumoCache`); ao
  errar, a tela `explain` mostra uma **explicação gerada por IA**.
- **E) UI DO PROFESSOR** — login por senha, abas (lições / editor / progresso),
  CRUD de lições/exercícios, e o painel de **geração por IA**.
- **D0) AUTENTICAÇÃO** — telas de `landing`, login/cadastro de aluno e de professor,
  e painel `admin` (chave da OpenAI). Sessão local em `SESSAO`; aluno logado em
  `ALUNO` (= `PROFILE`); professor em `PROFESSOR`.
- **F) INICIALIZAÇÃO** — objeto público `window.App` (handlers via `onclick="App.x()"`)
  e o `boot()` **assíncrono** (`loadIA()`, `carregarSessao()`, `initFirebase()`,
  `await carregarChaveIA()`, `await ouvirLicoes()`, `await restaurarSessao()`,
  `render()`), com tela de carregamento e de erro de conexão (retry via `App.retryBoot`).

## Conceitos-chave

### Renderização
- A UI é redesenhada via `render()`, que troca o `innerHTML` de `#app` conforme
  `State.tela`. Não há framework nem virtual DOM — strings de template literais.
- Handlers são expostos em `window.App` e chamados por `onclick="App.metodo(...)"`.
- Como o `innerHTML` é recriado a cada `render()`, **inputs de texto não usam `oninput`
  que re-renderiza** (perderia o foco). Título/texto da lição são lidos sob demanda por
  `syncTextInputs()` antes de qualquer re-render.

### Persistência

**Lições → Firebase Firestore.** As lições do professor ficam na coleção `licoes`
do Firestore (projeto `estudamais-5cb1b`). O Firebase é carregado por **CDN compat**
(`firebase-app-compat.js` + `firebase-firestore-compat.js`, sem bundler/import) e
inicializado em `initFirebase()` → `db = firebase.firestore()` (com `enablePersistence`
best-effort para cache offline).

- Documento Firestore: `{ disciplina, titulo, conteudo, exercicios, criadoEm, resumoIA, explicacoes }`.
- Lição interna no app: `{ id, titulo, texto, exercicios, resumoIA, explicacoes }`
  (note: `conteudo`↔`texto`, `id` = id do documento). Conversão em `licaoDeDoc()`.
- **Conteúdo de IA é persistido no Firestore para compartilhar entre dispositivos:**
  `resumoIA` (resumo de estudo, string) e `explicacoes` (mapa `{exId: texto}` das
  explicações de erro). Gerado uma vez por qualquer aparelho e salvo no doc; os demais
  usam o salvo (sem nova chamada à IA e sem precisar da chave naquele aparelho).
  `saveLesson()` invalida ambos ao editar (`resumoIA:""` + `explicacoes` via
  `FieldValue.delete()`), pois o material pode ter mudado.
- `pregerarExplicacoes(l)` roda em segundo plano ao abrir a lição **num aparelho com
  a chave** e gera/salva a explicação de TODAS as questões que ainda não têm uma, para
  que dispositivos sem a chave (ex.: o celular) encontrem a explicação pronta ao errar.
- `ouvirLicoes()` registra um **listener em tempo real** (`onSnapshot`) na coleção:
  `construirDATA(snap)` reagrupa em `DATA[disciplina]` e `aoAtualizarLicoes()`
  re-renderiza quando a tela é segura (home/lessons/profile/teacher-licoes), para que
  mudanças feitas em **qualquer dispositivo** apareçam ao vivo. A Promise resolve no
  primeiro snapshot (para o boot). Se a coleção estiver vazia na 1ª vez (e `SEED_FLAG`
  não setado no navegador), `seedFirestore()` popula os 27 exemplos uma vez.
- CRUD do professor é **assíncrono** e grava no Firestore: `saveLesson()`
  (`add`/`set merge`), `deleteLesson()` (`delete`), atualizando `DATA` local em seguida.
- ⚠️ **Regras do Firestore:** o app é client-only; o projeto precisa ter regras que
  permitam leitura/escrita na coleção `licoes` (modo de teste ou regras adequadas),
  senão o boot cai na tela de erro de conexão.

**Coleções no Firestore (v2.0):**

| Coleção | Conteúdo |
|---|---|
| `licoes` | Lições (agora com `turma`, `ano`, `nivel` de escopo) |
| `licoes_geradas` | Cache de conteúdo IA por lição: `{licaoId, resumo, exercicios, geradoEm, geradoPor}` |
| `alunos` | Conta + progresso do aluno (nome, idade, ano, nível, turma, senha hash, XP, medalhas, premiações, disciplinas…) |
| `professores` | Conta do professor (nome, email, senha hash, turmas[] (letras A–F), anos[] (séries que leciona), disciplinas[]) |
| `progresso` (campos) | inclui `percentualAcertos` (acertos/total*100) além de acertos/erros/total/xpGanho/concluido/concluidoEm |
| `progresso` | `{alunoId}_{licaoId}`: acertos, erros, xpGanho, total, concluido, concluidoEm (painel do professor) |
| `premiacoes` | Premiações personalizadas do professor |
| `premiacoes_alunos` | `{alunoId}_{premiacaoId}`: conquistas |
| `config` | doc `openai`: `{apiKey}` cadastrada no painel Admin |

Regras necessárias em `firestore.rules` (ponto de partida; ver arquivo no repo).

**localStorage** — apenas dados locais do dispositivo:

| Chave | Conteúdo |
|---|---|
| `estudamais_sessao_v2` | Sessão local: `{tipo:"aluno"|"professor", id}` |
| `estudamais_aluno_cache_v2` | Cache do doc do aluno logado (offline) |
| `estudamais_ia_modo_v1` | Preferência local da IA: `substituir`/`acumular` |
| `estudamais_device` | Id aleatório do dispositivo (campo `geradoPor`) |
| `estudamais_seed_firestore` | Flag: exemplos já semeados por este navegador |

- O progresso do aluno **sincroniza entre dispositivos** (fica no doc `alunos/{id}`,
  com `saveProfile()` fazendo write-through). `PROFILE` é um alias do aluno logado
  (`ALUNO`) para reaproveitar a gamificação existente.

### Modelo de dados
- Disciplina: objeto em `SUBJECTS` com `{id, nome, icon, cor}`.
- Lição: `{id, titulo, texto, exercicios:[...]}` em `DATA[subjId]`.
- Exercício: `{id, tipo, enunciado, ...}` onde `tipo`:
  - `"mc"` (múltipla escolha): `opcoes:[...]`, `correta:<índice>`
  - `"vf"` (verdadeiro/falso): `opcoes:["Verdadeiro","Falso"]`, `correta:0|1`
  - `"fill"` (completar lacuna): `resposta:"<texto>"` (correção via `norm()`,
    ignora acentos/maiúsculas)

### Gamificação
- `XP_POR_NIVEL=50`, `XP_POR_ACERTO=10`, `XP_BONUS_LICAO=20`.
- 3 vidas (corações) por sessão; zerar → tela de "game over".
- Streak diário baseado em `Date`. Medalhas em `ACHIEVEMENTS` desbloqueiam ao concluir
  lições (`verificarMedalhas`).

### Som
- `Sound` usa a **Web Audio API** (sem arquivos). Só inicializa após o primeiro toque
  do usuário (regra dos navegadores). Liga/desliga no perfil (`PROFILE.som`).

### Layout / rolagem
- App-shell de **altura fixa**: `#app { height:100dvh; overflow:hidden }`. A rolagem
  acontece dentro de `.content` (e `.celebrate`). Para a rolagem flex funcionar, esses
  contêineres precisam de **`min-height:0`** — não remova isso.
- Mobile-first: `max-width:480px` centralizado, botões ≥48px, fontes ≥16px.

## Geração de exercícios por IA

- Provedor atual: **OpenAI**.
  - Endpoint: `https://api.openai.com/v1/chat/completions`
  - Modelo: `gpt-4o-mini`
  - Auth: header `Authorization: Bearer <chave>`
  - Resposta extraída de `data.choices[0].message.content`.
  - Config no Firestore `config/openai` (`apiKey` e `proxyUrl`), cadastrada no **painel
    de Admin** (`ADMIN_PASSWORD`), carregada no boot por `carregarChaveIA()` para `IA`.
  - **Dois modos** (`chamarIA`): se `IA.proxyUrl` está setado → chama o **proxy** (sem
    chave no cliente; o proxy injeta a chave e devolve CORS); senão chama a OpenAI
    **direto** com `IA.apiKey`. Proxy recomendado: ver `proxy/` (Cloudflare Worker).
  - ⚠️ A OpenAI **não envia CORS em respostas de erro** (401/429) → chamada direta com
    chave inválida/sem créditos aparece como "Failed to fetch" (parece falta de rede).
    `mensagemErroIA()` explica isso; o proxy elimina o problema.
  - **Geração agora cria 15 exercícios** em 3 níveis (5 fácil / 5 intermediário /
    5 difícil); o parser captura o campo `nivel`. XP por acerto: 10/20/30.
- Helper compartilhado: `chamarIA(prompt)` faz o `fetch` e devolve o texto (lança
  `Error` em falha). Usado por três fluxos:
  1. **Gerar exercícios** (professor) — `gerarExerciciosIA()`.
  2. **Resumo de estudo** (aluno) — `openLesson()` gera o resumo; cache em `resumoCache`;
     fallback para o texto original do professor se não houver chave ou der erro.
  3. **Explicação ao errar** (aluno) — `gerarExplicacao()`; fallback para uma mensagem
     padrão acolhedora.
- Fluxo de exercícios: `gerarExerciciosIA()` monta o prompt → `chamarIA` → `parseExerciciosIA()`
  (limpa cercas ```` ```json ````, faz `JSON.parse`, mapeia
  `multipla_escolha→mc` / `verdadeiro_falso→vf` / `completar_lacunas→fill`,
  e `acharIndiceCorreto()` resolve a opção correta por texto ou letra A/B/C/D).
- O **Administrador** cadastra a chave no painel ⚙️ (tela inicial → "Administrador"),
  que a salva em `config/openai` (campo `apiKey`) no Firestore. Há loading e tratamento de erro (401/429/rede/timeout).
- Histórico de provedores já usados: Anthropic → Google Gemini → Groq → **OpenAI** (atual).
  Para trocar de provedor, ajuste `IA_MODELO`, `IA_ENDPOINT`, o `fetch`/headers em
  `chamarIA`, e a extração da resposta, além dos textos do painel (`iaPanel`/Admin).

## Segurança

- A chave da OpenAI é **paga** e fica no Firestore (`config/openai`), legível por quem
  acessar o banco com as regras atuais (modo aberto). **Risco de custo** se o app for
  público. Para produção, use um proxy backend guardando a chave.
- **Autenticação por hash simples** (SHA-256 via `hashSenha`, sem Firebase Auth): é uma
  barreira, não segurança real — os dados (inclusive nome/idade de crianças) ficam
  legíveis com as regras abertas. Use apenas em contexto fechado (turma/família).
- Senha de **Admin** hardcoded em `ADMIN_PASSWORD` (`admin123`) — barreira simples.
- Ver `firestore.rules` (ponto de partida) e considere migrar para Firebase Auth.

## Convenções

- Código e textos de UI em **português (pt-BR)**.
- Comentários por seção; mantenha a densidade/idioma do código existente.
- Tudo em um arquivo — não introduza arquivos JS/CSS externos nem dependências sem
  pedido explícito.
- Sempre escape conteúdo do usuário com `esc()` ao montar HTML.
