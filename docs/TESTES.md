# Suíte de testes do EstudaMais

Este documento é a referência da suíte automatizada: como rodar, o que cobre (matriz de
rastreabilidade), os defeitos corrigidos e o que **não** está coberto.

> Não há garantia de "sistema livre de erros". O que está aqui é o que foi **comprovadamente
> validado** por testes que passam de forma repetida e determinística.

## 1. Como rodar

| Comando | O que faz |
|---|---|
| `npm install` | instala as ferramentas de teste (só devDependencies; o app não tem build) |
| `npm run test:unit` | unitários + contrato + backend (proxy) + service worker (`tests/unit`) |
| `npm run test:integration` | integração/componente: o `index.html` real no jsdom (`tests/integration`) |
| `npm run test:e2e` | jornadas no navegador real com Playwright (`tests/e2e`) |
| `npm test` | as três suítes acima, em sequência |
| `npm run coverage` | unit + integração com c8 → `coverage/index.html`, `coverage/lcov.info` |
| `npm run lint` | ESLint (app extraído, sw.js, proxy, testes) |
| `npm run check` | validação estática: sintaxe, constantes órfãs, `App.x()` inexistentes, JSONs |
| `npm run check:no-only` | falha se houver `.only/.skip/.todo/fixme` |
| `npm run ci` | tudo o que o CI roda (check, no-only, lint, coverage com limites, e2e) |
| `npm run test:ai-real` | suíte **opcional** com a OpenAI real (ver §7) — desligada por padrão |

- **E2E local:** usa o Google Chrome instalado (`channel: "chrome"`). Para usar o Edge: `PW_CHANNEL=msedge npm run test:e2e`.
  No CI, o workflow instala o Chromium do Playwright.
- **CI:** `.github/workflows/testes.yml`. Ele falha se um teste falhar, se o lint ou a validação
  estática falhar, se a cobertura ficar abaixo dos limites do `.c8rc.json` ou se houver `only/skip`.

## 2. Arquitetura da suíte

- O app é um único `index.html`. `tests/tools/extrair-app.js` copia o `<script>` inline para
  `build/index.app.js`. O c8 mede esse arquivo.
  **Linha do index.html = linha do relatório + offset** (o offset fica em `build/offset.json`,
  hoje 482). Os stack traces já saem com a linha do index.html.
- `tests/support/app.js` (**harness**) carrega o `index.html` real no jsdom e injeta:
  - `fake-firebase.js`: Firestore em memória (o "banco isolado"), com batch atômico,
    `where`/`onSnapshot`/FieldValue, injeção de falhas (`store.falhar`), operações pendentes
    (`store.segurar`), modo offline e log de escritas;
  - `fake-ia.js`: OpenAI determinística (JSON, SSE em streaming, 401/429/5xx, rede, conexão
    pendurada, silêncio no stream, corte no meio, corpo inválido);
  - relógio falso: `setTimeout`, `setInterval` e `Date` avançam só com `h.avancar(ms)`. Não há
    espera real;
  - aleatoriedade injetável: `Math.random` com semente e fila de valores (`h.random.fila`);
  - voz (speechSynthesis), áudio, canvas, `confirm`/`prompt`/`alert`, PDF.js, mammoth e jsPDF falsos.
- Cada teste abre o próprio app com o próprio banco e chama `h.fechar()`. Não há estado
  compartilhado entre testes nem dependência da ordem de execução.
- **E2E** (`tests/e2e/base.js`): o Playwright intercepta os scripts do Firebase (serve o mesmo
  `fake-firebase.js`, agora persistido no `localStorage` da página para sobreviver ao reload),
  as CDNs e a OpenAI. O tempo é controlado com `page.clock`.

## 3. Inventário de funcionalidades

| Área | Funcionalidades |
|---|---|
| Autenticação | landing; login e cadastro de aluno (nome tolerante a acentos, homônimos, contas legadas); login e cadastro de professor (validações, e-mail único e normalizado); mostrar/ocultar senha; sessão local (restaurar, conta apagada, corrompida, offline com cache); logout; tela de erro de conexão com retry |
| Admin | senha de admin; configuração da IA (chave/proxy em `config/openai`, legado `config/app`); testar conexão |
| Aluno – estudo | home e contagens; lista de lições com visibilidade estrita ano+turma; lições em tempo real; resumo por IA com cache (memória → `licoes_geradas` → `resumoIA` legado → sem chave → IA → fallback); botão liberado após 10s; material de apoio; pré-geração de explicações |
| Aluno – exercícios | seleção de modo; múltipla escolha, V/F e lacuna; ordem por dificuldade; XP 10/20/30; vidas; sair |
| Erro e reinício | explicação da IA (salva, sem chave, erros); reinício só ao confirmar; volta à 1ª questão com tudo zerado; embaralhamento só da tentativa; lição de 1 questão; cliques repetidos |
| Conclusão | recompensa, nível, medalhas; `progresso/{aluno}_{lição}`; write-through no doc do aluno; ofensiva diária; recarregar; tentativa concluída imutável |
| Modo História | geração e cache; +50% de XP; narrativa de acerto/erro; desfechos; game over; conquista |
| Interpretação de texto | leitura com TTS por parágrafo; "Já li"; "Ver o texto"; "Você sabia?"; geração em 3 etapas (professor) |
| Perfil e voz | dados; som; zerar progresso; dados escolares; estilos/velocidade/vozes; auto-leitura |
| Modo demo | perfis demo; nenhuma escrita no Firestore; resumo demo; sair do demo |
| Professor – lições | abas; lista por escopo; criar, editar, salvar (validações), excluir; pré-visualizar; editor de exercícios |
| Professor – IA | gerar exercícios (substituir/acumular); **regenerar conteúdo**; **regenerar exercícios** (validação + batch atômico); história; interpretação; testar IA |
| Material de apoio | TXT/PDF/DOCX/imagem (OCR); limites de 15 arquivos e 10MB; divisão justa dos 60.000 caracteres; remover/reabrir |
| Rendimento e gestão | rendimento por escopo com filtros; redefinir senha; remover aluno; zerar progresso; premiações; conta do professor |
| Corretor de provas | manual (nota calculada pelo JS); automático por foto (visão da IA); feedback; PDF; compartilhar; histórico |
| Backend e infra | proxy Cloudflare Worker; service worker (PWA offline); manifest; regras do Firestore |
| Segurança | guardas de professor/admin; isolamento; XSS em conteúdo do usuário e da IA; chave fora do front; entradas extremas |

## 4. Matriz de rastreabilidade

Formato: funcionalidade → arquivos e testes. Cada linha tem casos de sucesso, de erro e casos
extremos (ver os nomes dos testes em cada arquivo, que descrevem o cenário).

Legenda dos tipos:
- **U**: unitário
- **C**: contrato
- **I**: integração/componente
- **S**: segurança
- **E**: end-to-end
- **R**: regressão

### 4.1 Funcionalidades prioritárias

| Requisito | Tipo | Testes |
|---|---|---|
| Resposta incorreta pede e exibe a explicação da IA (salva no doc, IA ok e persistida, sem chave) | I, E | `aluno-reinicio` › "erro → pede a explicação…", "explicação já salva…", "sem chave de IA…"; `jornadas-aluno` › "aluno erra, vê a explicação…" |
| Erros da IA na explicação: rede, 401, 429, 503, vazia, corpo não-JSON, corte, timeout de 10s | I, C | `aluno-reinicio` › "explicação: …" (8 casos); `contrato-ia` › "erro tratado: …" |
| Reinício só depois de confirmar a explicação | I | `aluno-reinicio` › "reinício só acontece ao confirmar…" |
| Volta à 1ª questão com progresso, respostas, XP, vidas e revisão zerados | U, I, E | `fluxos` › "após a explicação, reinicia…"; `aluno-reinicio` › "após confirmar…"; `jornadas-aluno` |
| Mesmas questões, sem duplicar nem perder; ordem diferente; aleatoriedade injetada | U, I, E | `fluxos`/`utilitarios` › "embaralharTentativa…"; `aluno-reinicio` › "aleatoriedade que repete…" |
| Ordem permanente no banco inalterada | U, I, E | `fluxos`; `aluno-reinicio`; `jornadas-aluno` (compara `licoes/L1.exercicios`) |
| Lição com 1 questão reinicia | U, I | `fluxos` › "2 questões sempre trocam; 1 questão só reinicia"; `aluno-reinicio` › "lição com 1 questão…" |
| Cliques repetidos não duplicam requisições nem tentativas | U, I, R | `fluxos` › "clique duplo em 'Entendi'…"; `aluno-reinicio` › "cliques repetidos…"; `aluno-exercicios` › "REGRESSÃO: Verificar disparado 2x…" |
| Sair durante a geração da explicação | I | `aluno-reinicio` › "sair da atividade…", "cancelar a saída…" |
| Acerto avança e progresso atualiza; última questão conclui | I, E | `aluno-exercicios` › "múltipla escolha…"; `aluno-conclusao` › "última questão conclui…"; `jornadas-aluno` › "responde tudo certo…" |
| Resultado e pontuação persistidos (progresso, doc do aluno, cache) | I, E | `aluno-conclusao` › "progresso gravado…", "recompensa persistida…"; `jornadas-aluno` |
| Recarregar não corrompe o estado | I, E | `aluno-conclusao` › "recarregar (×2)"; `auth` › "recarregar a página mantém o login…"; `jornadas-aluno` › "recarrega a página no meio…" |
| Tentativa concluída não recebe alterações | I, R | `aluno-conclusao` › "tentativa concluída…", "REGRESSÃO: App.nextExercise() após concluir…" |
| **Regenerar exercícios**: confirmação, cancelamento, loading, bloqueio de cliques | U, I, E | `professor-regenerar-exercicios` › "confirmação: …", "loading + bloqueio…"; `fluxos` › "cancelar… clique duplo…"; `jornadas-professor` |
| Contexto enviado à IA: tema, disciplina, série, dificuldade, tipos, quantidade, questões atuais, texto de estudo | U, C, I | `professor-regenerar-exercicios` › "contexto enviado…"; `material-prompts` › "montarPromptRegenerarExercicios…" |
| Questões diferentes; validação e rejeição de incompletas, duplicadas, parecidas, tipo inválido, quantidade errada, JSON malformado ou vazio | U, I, E | `professor-regenerar-exercicios` › "validação: … → rejeita" (13 casos); `parsers-ia` › "(estrito)…"; `jornadas-seguranca` › "JSON malformado…" |
| Substituição atômica, rollback e preservação em caso de erro | I, E | `professor-regenerar-exercicios` › "sucesso: …", "rollback: falha no commit…", "rollback: se o documento…"; `jornadas-seguranca` |
| Históricos preservados, sem registros órfãos, versão +1 | I | `professor-regenerar-exercicios` › "sucesso…", "regenerar duas vezes…" |
| Concorrência: dois professores; aluno no meio da tentativa | I | `professor-regenerar-exercicios` › "concorrência: …" (2) |
| Erros da IA: timeout, 429, 503/indisponível, 401, rede, stream cortado | I, E | `professor-regenerar-exercicios` › "erro da IA: …"; `jornadas-seguranca` › "timeout…", "falha de rede…" |
| Lição sem exercícios, não salva, sem chave, sem texto | I | `professor-regenerar-exercicios` › "botão: …", "lição nova com exercícios…" |
| Aluno ou visitante não consegue regenerar | S, E | `professor-regenerar-exercicios` › "permissão: …"; `seguranca-autorizacao`; `jornadas-seguranca` |
| **Regenerar conteúdo** altera só o resumo; exercícios intactos | I, E | `professor-regenerar-conteudo` › "sucesso grava SÓ…"; `jornadas-professor` |
| Contexto do resumo e estrutura didática objetiva (títulos, ≥2 exemplos, "Cuidado!", tamanho, idioma, sem respostas) | U, C, I | `fluxos` › "prompt do texto de estudo…"; `material-prompts` › "montarPromptResumo…"; `professor-regenerar-conteudo` › "contexto enviado…" |
| Conteúdo anterior mantido em erro (429, 503, rede, vazio, timeout, falha de gravação) | I, R, E | `professor-regenerar-conteudo` (6 testes + "falha ao gravar… NÃO mostra sucesso"); `jornadas-seguranca` › "limite de uso (429)…" |
| Cancelar a regeneração de conteúdo | I, E | `professor-regenerar-conteudo` › "cancelar a confirmação…"; `jornadas-professor` › "cancela a regeneração…" |

### 4.2 Autenticação, autorização e segurança

| Requisito | Tipo | Testes |
|---|---|---|
| Login e logout (aluno e professor) com sucesso e erros | I | `auth` (33 testes) |
| Sessão válida, ausente, de conta apagada, corrompida, offline | I | `auth` › "sessão …", "offline ao ler o aluno…" |
| Sessão "expirada" | — | **não existe no app**: a sessão local não expira (ver §6) |
| Perfis aluno, professor, admin e demo: acesso permitido e negado | S, E | `seguranca-autorizacao`; `admin`; `jornadas-seguranca` › "usuário sem permissão ›" (5 testes) |
| Handlers administrativos sem professor não gravam nada | S, R | `seguranca-autorizacao` › "autorização: App.X() sem professor…" (14 handlers) |
| Proteção de telas (`irTela('teacher')`, admin) | S, R | `seguranca-autorizacao` › "irTela('teacher') sem professor…", "irTela('admin')…" |
| Troca de ID: sessão adulterada; aluno fora do escopo do professor | S, R | `seguranca-autorizacao` › "sessão adulterada…", "LIMITAÇÃO CONHECIDA…"; `professor-rendimento-alunos` › "gestão: … FORA do escopo…" |
| Isolamento: lições por ano+turma, progresso por aluno, rendimento por escopo | S, I | `seguranca-autorizacao` › "aluno só vê…", "progresso é gravado só…", "rendimento…"; `aluno-estudo` › "visibilidade estrita…" |
| Entradas vazias, inválidas, muito longas (10k), malformadas, unicode | S | `seguranca-conteudo` › "entradas muito longas…", "dados malformados…", "caracteres especiais…"; validações em `auth`/`professor-licoes` |
| XSS em conteúdo do usuário e da IA | S | `seguranca-conteudo` › "XSS: …" (3); `aluno-estudo`/`aluno-historia`/`professor-*` › "conteúdo inseguro…"; `contrato-ia` |
| Chave e dados sensíveis fora do front; proxy sem Authorization; senha só em hash | S, C | `seguranca-conteudo` › "chave da IA não aparece…", "com proxy…"; `contrato-ia` › "modo proxy…"; `auth` |
| Requisições simultâneas e operações duplicadas | I, R | `auth` › "clique duplo não duplica…"; `aluno-reinicio`; `aluno-exercicios` › "REGRESSÃO…"; `professor-regenerar-exercicios` › "concorrência…" |

### 4.3 Banco de dados e consistência (Firestore falso isolado)

| Requisito | Tipo | Testes |
|---|---|---|
| CRUD das entidades (lições, alunos, professores, progresso, premiações, correções, config) | I | `professor-licoes`, `auth`, `professor-rendimento-alunos`, `professor-corretor`, `admin` |
| Relacionamentos (progresso e conquistas por aluno; explicações por exercício; caches por lição) | I, R | `professor-rendimento-alunos` › "remover aluno: não deixa premiacoes_alunos órfãs…"; `professor-regenerar-exercicios` |
| Transação e rollback (batch) | I | `professor-regenerar-exercicios` › "rollback: …" (2) |
| Preservação do histórico após alterar a lição | I | `professor-licoes` › "editar: … preserva progresso"; `professor-regenerar-exercicios` › "sucesso…" |
| Idempotência: seed das lições de exemplo uma única vez; concluir uma vez | I | `lacunas-*` (seedFirestore); `aluno-conclusao` › "repetir uma lição…" |
| Compatibilidade de dados legados (migrações implícitas) | U, I | `utilitarios` › "migrarExercicioResposta…", "licaoDeDoc…"; `aluno-estudo` › "resumoIA legado…"; `admin` › "config legada…"; `auth` › "conta legada sem nomeNorm…" |
| Regras do Firestore cobrem todas as coleções usadas | U | `configuracao` › "regras do Firestore…" |

### 4.4 Integração com a IA (deterministicamente)

| Cenário | Testes |
|---|---|
| Resposta válida (SSE e JSON) | `contrato-ia` › "resposta JSON…", "lerStreamIA: junta deltas…" |
| Resposta inválida, JSON malformado, campos ausentes | `parsers-ia`; `professor-gerar-ia`; `professor-regenerar-exercicios` |
| Conteúdo duplicado ou parecido com as questões atuais | `parsers-ia`; `professor-regenerar-exercicios` |
| Timeout (inicial, inatividade, teto) | `contrato-ia` › "timeout inicial…", "cabeçalhos chegam…", "lerStreamIA: vigia…" |
| Erro de rede, 429, 5xx, resposta vazia, corpo inválido | `contrato-ia` › "erro tratado: …" (9) |
| Conteúdo inseguro | `contrato-ia` › "conteúdo inseguro…"; `seguranca-conteudo` |
| Proxy (backend) | `proxy-worker` (11 testes) |

### 4.5 Jornadas E2E (navegador real)

| # | Jornada | Teste |
|---|---|---|
| 1 | Administrador (professor) cria e abre uma lição | `jornadas-professor` › "professor faz login, abre uma lição existente e cria…" |
| 2 | Regenera o conteúdo explicativo | `jornadas-professor` › "professor regenera o conteúdo explicativo…" |
| 3 | Regenera os exercícios e confirma | `jornadas-professor` › "professor regenera os exercícios…" |
| 4 | Cancela uma regeneração | `jornadas-professor` › "professor cancela a regeneração…" |
| 5 | Aluno acessa a lição e estuda | `jornadas-aluno` › "aluno faz login, abre a lição e estuda…" |
| 6 | Aluno acerta tudo e conclui | `jornadas-aluno` › "aluno responde tudo certo e conclui…" |
| 7 | Aluno erra, vê a explicação e reinicia com a ordem nova | `jornadas-aluno` › "aluno erra, vê a explicação da IA…" |
| 8 | Aluno recarrega a página durante a tentativa | `jornadas-aluno` › "aluno recarrega a página no meio…" |
| 9 | Usuário sem permissão tenta ação administrativa | `jornadas-seguranca` › "usuário sem permissão ›" (5) |
| 10 | Falha da IA sem perda de conteúdo ou exercícios | `jornadas-seguranca` › "falha da IA sem perda…" (4) |

### 4.6 Demais funcionalidades

| Área | Testes |
|---|---|
| Estudo, resumo e cache; pré-geração | `aluno-estudo` |
| Modo História (aluno e professor) | `aluno-historia`, `professor-historia-interpretacao` |
| Interpretação de texto | `aluno-interpretacao`, `professor-historia-interpretacao` |
| Perfil, voz e TTS | `aluno-perfil`, `aluno-voz`, `lacunas-*` |
| Modo demo | `aluno-demo`, `lacunas-*` |
| Editor de lições e geração por IA | `professor-editor`, `professor-gerar-ia` |
| Material de apoio | `professor-material`, `material-prompts` |
| Rendimento, gestão, premiações, conta | `professor-rendimento-alunos` |
| Corretor de provas | `professor-corretor`, `lacunas-*` |
| Gamificação | `gamificacao`, `aluno-conclusao` |
| Service worker / PWA | `service-worker`, `configuracao` |
| Validação estática | `npm run check`, `npm run lint` |

## 4.7 Resultados e cobertura (última execução)

| Suíte | Testes | Resultado |
|---|---|---|
| Unitários + contrato + backend + SW (`tests/unit`, 9 arquivos) | 118 | 118 ✔ |
| Integração/componente/segurança (`tests/integration`, 36 arquivos) | 368 | 368 ✔ |
| E2E Playwright (`tests/e2e`, 3 arquivos) | 17 | 17 ✔ |
| **Total** | **503** | 0 falhas, 0 skip/todo |

Os testes node rodaram duas vezes seguidas com resultado idêntico. O E2E passou em três
execuções completas.

Cobertura (c8, unit + integração). Os limites do CI ficam em `.c8rc.json`: linhas, statements
e funções ≥ 97%; branches ≥ 75%.

| Arquivo | Linhas | Branches | Funções |
|---|---|---|---|
| `index.html` (script → `build/index.app.js`) | 98,26% | 77,58% | 98,83% |
| `sw.js` | 100% | 100% | 100% |
| `proxy/cloudflare-worker.js` | 100% | 100% | 100% |

Sem cobertura:
- **6 funções de código morto**, sem nenhum chamador: `mesmaTurma`, `mesmoAno`,
  `limparHistoriaGerada`, `parseGabarito`, `montarResultadoCorrecao` e `Sound.click`.
- **Branches restantes (~22%)**: quase todos são `catch(_){}` de armazenamento
  indisponível, `||` defensivos e fallbacks sem efeito observável. O V8 conta cada `?:`/`||`
  como branch. Risco baixo.

## 5. Bugs de produção corrigidos durante a criação da suíte

Cada correção tem um teste de regressão que falhava antes e passa depois. As correções são
mínimas e estão no `index.html`.

| # | Defeito | Correção | Regressão |
|---|---|---|---|
| 1 | Ações de professor sem guarda: pelo console, um aluno ou visitante podia **apagar lição**, **remover aluno**, **trocar a senha de outro aluno** (tomada de conta) e excluir premiação; `saveLesson`/`gerarExerciciosIA` davam TypeError | `exigirProfessor()` em `deleteLesson`, `removerAluno`, `redefinirSenhaAluno`, `excluirPremiacao`, `criarPremiacao`, `saveLesson`, `gerarExerciciosIA` | `seguranca-autorizacao` › "autorização: App.X()…"; `jornadas-seguranca` |
| 2 | `salvarChaveOpenAI`/`testarChaveIA` sem checar a senha de admin: qualquer um apagava a config da IA de todos | exigem `State.adminAuth` | `seguranca-autorizacao` |
| 3 | `irTela('teacher')` abria o painel do professor sem login | `render()` só mostra o painel se houver `PROFESSOR` | `seguranca-autorizacao` › "irTela('teacher')…" |
| 4 | `removerAluno`/`redefinirSenhaAluno` não verificavam o escopo turma+ano do professor | checagem `alunoNoEscopo` (igual a `zerarProgressoAluno`) | `seguranca-autorizacao`, `professor-rendimento-alunos` |
| 5 | Cadastro de professor apagava nome/e-mail/senha a cada erro de validação | `syncProfForm()` antes de validar | `auth` › "…erro de validação preserva…" |
| 6 | `checkAnswer` aceitava 2º disparo na mesma questão: acerto contado 2x (**percentualAcertos 133% gravado**), erro tirava 2 vidas | ignora se `Sess.respondido` | `aluno-exercicios` › "REGRESSÃO: …" (2) |
| 7 | `nextExercise` na tela de conclusão concluía de novo: **XP em dobro** e progresso regravado | só avança a partir de questão respondida na tela de exercício | `aluno-conclusao` › "REGRESSÃO: App.nextExercise()…" |
| 8 | Modo demo gravava `progresso/demo_…` no Firestore | `salvarProgresso` retorna se `DEMO` | `aluno-demo` › "REGRESSÃO…" |
| 9 | "Regenerar conteúdo" mostrava "✅ salvo" mesmo com falha na gravação (e virava faixa de erro) | `salvarLicaoGerada` devolve a Promise; `await` antes do sucesso; grava só `resumo` | `professor-regenerar-conteudo` › "falha ao gravar… NÃO mostra sucesso" |
| 10 | Mesmo problema ao gerar a história (professor) | `salvarHistoriaGerada` devolve a Promise; `await` | `professor-historia-interpretacao` › "história: falha ao gravar…" |
| 11 | Remover aluno deixava `premiacoes_alunos` órfãs | apaga as conquistas do aluno | `professor-rendimento-alunos` › "remover aluno: não deixa…órfãs" |
| 12 | Corretor manual sem IA: o feedback padrão não aparecia na tela | re-renderiza quando o feedback fica pronto | `professor-corretor` › "corretor manual sem IA…" |
| 13 | "Zerar progresso" não zerava `historiasCompletas`: a medalha "Contador de Histórias" voltava na aventura seguinte | incluído na lista | `regressoes` › "zerar progresso também zera as aventuras…" |
| 14 | `update()` da explicação sem `.catch`: falha offline virava a faixa vermelha de erro | `.catch(()=>{})` (best-effort) | `regressoes` › "falha ao salvar a explicação…" |
| 15 | Chaves duplicadas `hist`/`interp` no objeto `Teacher` (lint `no-dupe-keys`) | removida a duplicata idêntica | `npm run lint` |

**Falhas preexistentes:** a suíte existente antes deste trabalho (`tests/unit/fluxos.test.js`,
14 testes) passava 14/14. Não havia outras suítes, lint nem CI.

## 6. Riscos e pontos não automatizados

| Ponto | Motivo | Risco |
|---|---|---|
| **Autorização no servidor** | As regras do Firestore são `allow read, write: if true` e não há Firebase Auth. As guardas testadas são do cliente: quem usar o SDK direto lê e grava tudo, inclusive a chave da IA em `config/openai` e dados de crianças | **Alto** se o app for público. Mitigação: Firebase Auth + regras por usuário + proxy com a chave (já documentado no CLAUDE.md) |
| **Sessão local sem token/expiração** | A sessão é só `{tipo,id}` no localStorage; quem souber o id de outro aluno entra na conta dele. Não existe "sessão expirada" | Alto (mesma mitigação) |
| Firestore real e emulador | Os testes usam um fake fiel ao subconjunto usado. Não há teste contra o emulador (exige Java e firebase-tools; com as regras abertas, não haveria o que validar) | Médio: diferenças sutis de semântica do SDK |
| OpenAI real | Nunca chamada nos testes comuns. A suíte opcional `tests/opcional` roda só com `OPENAI_API_KEY_TESTE` | Baixo/médio: mudança de formato da API |
| Qualidade do texto gerado | Validamos requisitos objetivos (prompt e estrutura), não qualidade subjetiva. O resumo regenerado hoje só é validado como "não vazio" (lacuna de requisito, ver §8) | Médio |
| Layout, rolagem, animações, confete, áudio audível | jsdom não faz layout nem fala; o E2E verifica o fluxo, não a aparência | Baixo |
| Streaming SSE no navegador real | O E2E responde em JSON; o SSE é coberto no jsdom (`contrato-ia`) e no proxy | Baixo |
| `esc()` não escapa `'` | Valores interpolados em `onclick="App.x('…')"` são ids do Firestore ou turmas de lista fixa (A–F); uma turma legada com `'` quebraria o clique | Baixo (observação, sem correção) |

## 7. Suíte opcional com a IA real

`tests/opcional/ia-real.test.js`: roda só com a variável de ambiente `OPENAI_API_KEY_TESTE`.
Sem ela, os testes não são registrados (não aparecem como skip). Comando: `npm run test:ai-real`.

## 8. Lacunas de requisito conhecidas (não resolvidas aqui)

- As 27 lições de exemplo semeadas no 1º acesso não têm `ano`/`turma`. Com o filtro estrito
  de visibilidade (decisão do projeto: sem curinga), **nenhum aluno as vê**, só o professor.

- O resumo regenerado é persistido após checar apenas que não está vazio. Validar estrutura,
  exemplos e tamanho antes de gravar seria um requisito novo de produto.
- Os avisos de lint (22) são código morto legado (funções e constantes sem uso). Não foram
  removidos para não mexer em produção fora do escopo.
