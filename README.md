# Mindmap

Ferramenta de mapas mentais (estilo Miro) organizada por **Projetos**. Next.js (React + rotas de API) com SQLite para guardar os dados.

## Rodar com Docker (recomendado)

Requer apenas o Docker.

```bash
git clone https://github.com/mvnp/mindmap.git
cd mindmap
docker compose up -d
```

Abra http://localhost:3000.

- **Outra porta:** `PORT=8080 docker compose up -d` (PowerShell: `$env:PORT=8080; docker compose up -d`).
- **Parar:** `docker compose down` (mantém os dados).
- **Apagar tudo, inclusive os mapas:** `docker compose down -v`.
- **Atualizar após mudar o código:** `docker compose up -d --build`.

Sem o compose:

```bash
docker build -t mindmap .
docker run -d --name mindmap --restart unless-stopped -p 3000:3000 -v mindmap-data:/data mindmap
```

### Banco de dados

O banco SQLite (`mindmap.db`) fica no volume `mindmap-data` (`/data` no container). Ele é criado sozinho na primeira requisição, já com **Projeto 1** (exemplo), **Projeto 2** e **Projeto 3**. Nas próximas subidas o banco existente é reaproveitado, e as migrações são aplicadas automaticamente.

## Rodar sem Docker

Requer **Node.js 22.5+** (usa o `node:sqlite` nativo, sem pacotes nativos).

```bash
npm install
npm run dev          # desenvolvimento em http://localhost:3000
# ou
npm run build && npm start
```

O banco é criado em `./mindmap.db`. Para usar outro caminho: `MINDMAP_DB=/caminho/mindmap.db`.

## Contas, login e usuário master

Todas as rotas exigem login, exceto **login, cadastro, recuperar/redefinir senha e verificação**. Cada projeto pertence a um usuário.

- **Cadastro:** nome, sobrenome, e-mail, telefone (máscara brasileira na tela; no banco vai só com dígitos) e senha (mín. 8 caracteres, guardada com hash scrypt).
- **Verificação de e-mail e "esqueci a senha":** usam links especiais de uso único (`/verificar?token=…`, `/redefinir-senha?token=…`). Ainda não há envio de e-mail: os links aparecem no log do servidor (`docker logs mindmap`). A conta nasce com `verificado = 0` e **não consegue entrar** até clicar no link de confirmação (que então redireciona para o login). O login oferece "Reenviar e-mail de confirmação".
- **Sair:** botão na barra lateral.
- **Master:** coluna `master` (padrão 0). O master vê o botão **Banco de dados** (tela cheia, com as tabelas e seus dados; hashes ficam ocultos) e é o único que marca funcionalidades como desenvolvidas.

Criar (ou atualizar) o usuário master, vinculando a ele os projetos que ainda não têm dono:

```bash
docker exec -e MASTER_PASSWORD='sua-senha' mindmap node scripts/create-master.mjs --nome Nome --sobrenome Sobrenome --email voce@exemplo.com
```

A senha nunca fica no código nem no repositório. Em produção, defina `APP_URL` (ex.: `https://mindmap.exemplo.com`) para os links especiais, e sirva por HTTPS (o cookie de sessão ganha `Secure` automaticamente atrás de proxy com `X-Forwarded-Proto: https`).

## Como usar

- **Projetos:** painel à esquerda. `＋` cria, duplo clique renomeia, `×` exclui. Cada projeto tem o seu mapa.
- **Tudo parte do nó central:** todo bloco descende dele; o nó central não pode ser excluído.
- **Salva a cada ação:** criar, editar, mover e excluir blocos são gravados na hora. Recarregar a página não perde nada.
- **Exportar / Importar:** botões na barra superior. A importação só é aceita em projeto zerado (apenas o nó central). Para levar mapas a outro PC: exporte o JSON e importe num projeto novo.

### Atalhos

| Tecla | Ação |
|---|---|
| Tab / Enter | criar filho / irmão |
| F2 ou duplo clique | editar texto |
| Del | excluir bloco (e seu ramo) |
| Espaço | recolher / expandir ramo |
| Ctrl+Z / Ctrl+Y | desfazer / refazer |
| M / S | ferramenta Mover / Selecionar |
| Shift+clique, Shift+arrastar, Ctrl+A | seleção múltipla |
| G | guias do mouse (cruz tracejada) |
| F12 | tela cheia da área de desenho (Esc sai) |
| Clique direito | menu (Padrão vertical) |

Outros: arraste a tela para navegar e use a roda do mouse para zoom; arraste um bloco sobre outro para mudar o pai; arraste as alças **esquerda ou direita** de um bloco selecionado para redimensioná-lo (o texto quebra linha; a borda do lado oposto fica parada). Com **vários blocos selecionados**, arrastar a alça de um deles redimensiona todos para a mesma largura. O espaço entre os blocos é **recalculado na hora**: quem ficaria sobreposto é empurrado (o de baixo desce com o seu ramo; filho invadido pelo pai alargado se afasta), e arrastar de volta devolve cada bloco ao lugar. Duplo clique numa alça volta à largura automática. Tudo isso é um único passo de Ctrl+Z.

## Assistente de IA (monta o mapa na sua frente)

O botão **✦ IA** (canto inferior direito) abre um chat com a Claude, que **vê o mapa e edita direto na tela**: um cursor animado vai até os blocos, cria, digita, liga, move, recolore, organiza e enquadra a câmera.

- **Setup (⚙):** sua chave da API da Anthropic, o modelo (Haiku 5.5, Sonnet 5.5, Opus 5.5 ou Fable 5.2), o nível de raciocínio e o **prompt** (instruções permanentes). A chave é guardada **criptografada (AES-256-GCM) no servidor**, é de uso pessoal e **nunca volta ao navegador** (só os 4 últimos caracteres).
- **Controles:** ⏸ Pausar / ▶ Continuar (congela o trabalho no ponto exato), ■ Parar (cancela a resposta em andamento; o que já foi feito fica) e ▶ Retomar (continua de onde parou). Velocidade do cursor: Lento · Normal · Rápido · Instantâneo. O chat pode ser minimizado sem interromper o trabalho.
- **Contexto:** a cada mensagem a IA recebe o estado completo do mapa (blocos, ids, hierarquia, posições, cores, seleção, área visível e zoom) e, se o 👁 estiver ligado, um **print da tela**. Também dá para **colar ou anexar imagens** (📎). Ela mesma pode chamar `ver_tela` para conferir o resultado.
- **Desfazer:** tudo que a IA faz em um pedido é **um único passo** de Ctrl+Z.
- **Ferramentas da IA:** `criar_bloco`, `editar_bloco`, `mover_bloco`, `ligar_bloco` (liga/desliga linhas), `excluir_bloco`, `organizar`, `enquadrar`, `selecionar`, `ver_tela`, `ler_mapa`. Definidas em `lib/ai-tools.js` e executadas no navegador por `components/ai/executor.js`.
- **Custo:** cada pedido gasta tokens da **sua** conta Anthropic (cache automático do histórico). Há limite de 120 chamadas por 10 minutos por usuário.
- **Consumo registrado:** a tabela `ai_usage` guarda **um registro por prompt** (as várias chamadas à API de um mesmo prompt são somadas e `updated_at` avança a cada chamada). Colunas: `id`, `run_id`, `user_id`, `project_id`, `prompt` (até 2000 caracteres), `model`, `effort`, `input_tokens` (**total** de entrada = novos + cache escrito + cache lido), `output_tokens`, `cache_write_tokens`, `cache_read_tokens`, `calls` (chamadas à API), `tool_calls` (ações no mapa), `status` (`em_andamento`, `concluido`, `parado`, `erro`, `limite`), `error`, `cost_usd` (**estimativa**; preços em `lib/ai.js`), `created_at`, `updated_at`. Tokens de chamadas interrompidas ou com erro de conexão também entram. Cada usuário vê o próprio consumo (24 h, 30 dias e últimos prompts) no ⚙ Setup do chat; o master vê tudo em **Banco de dados**.
- **Servidor:** defina `AI_ENC_SECRET` (qualquer texto longo e aleatório) no `.env` para a chave de criptografia ficar **fora do banco**. Sem ele, um segredo aleatório é gerado e guardado na tabela `app_secrets` (funciona, mas protege menos). Atrás do nginx, o streaming usa o cabeçalho `X-Accel-Buffering: no`; se houver outro proxy, desative o buffer para `/api/ai/chat`.

## Conteúdo de cada bloco

Selecione um bloco e clique em **📝** na barra dele para abrir o modal de **conteúdo**: título, texto formatado (negrito, itálico, sublinhado, subtítulo, listas) e arquivos (**textos de qualquer extensão, imagens, PDFs e áudios**, vários de uma vez, até 25 MB cada e 20 por bloco). O botão **✦ IA** lê o que você escreveu (mais o caminho do bloco no mapa) e **propõe** um texto, acrescentado ao final do rascunho; **↶ Desfazer IA** volta ao anterior. Ao **Salvar**, abre um segundo modal que mostra tudo organizado: título, conteúdo e arquivos (galeria de imagens, player de áudio, PDFs, prévia de textos). Blocos com conteúdo ganham um selo 📝 que abre essa visualização. Quem só visualiza o projeto (público) vê o conteúdo, mas não edita.

- **Onde ficam os arquivos:** em disco, dentro do volume de dados: `<pasta do banco>/uploads/<projeto>/<conteúdo>/<nome aleatório>.<ext>` (`/data/uploads` no Docker; mude com `MINDMAP_UPLOADS`). O caminho relativo é gravado em `conteudo_arquivos.caminho`; o texto e o título ficam em `conteudos` (um por bloco). Os arquivos só são servidos pela rota autenticada, com `nosniff` e `sandbox`; o texto formatado é higienizado (DOMPurify) ao salvar e ao exibir.
- **Backup:** copie também `/data/uploads` junto com `mindmap.db`. Excluir o projeto apaga os arquivos dele.
- **Nginx:** para enviar arquivos grandes, aumente `client_max_body_size` (ex.: `client_max_body_size 120m;`). O app aceita até 100 MB por envio.

## API

| Método e rota | Função |
|---|---|
| `POST /api/auth/register · login · logout · forgot · reset · verify`, `GET /api/auth/me` | autenticação |
| `GET /api/admin/tables[/nome]` | (master) tabelas do banco e seus dados |
| `GET/POST /api/projects` | listar / criar projetos do usuário logado |
| `GET/PATCH/DELETE /api/projects/:id` | ler (com nós) / renomear ou salvar visão / excluir |
| `POST /api/projects/:id/nodes` | criar nó `{ node, after? }` |
| `PATCH /api/projects/:id/nodes` | atualizar nós em lote `{ patches }` |
| `PUT /api/projects/:id/nodes` | substituir o mapa inteiro (snapshot) |
| `DELETE /api/projects/:id/nodes/:nid` | excluir nó e seu ramo |
| `POST /api/projects/:id/import` | importar mapa (só em projeto zerado) |
| `GET /api/projects/:id/conteudo` · `GET/PUT/DELETE …/conteudo/:bloco` · `GET …/conteudo/:bloco/arquivo/:id` | conteúdo do bloco (PUT é multipart: `titulo`, `corpo`, `remover`, `arquivos`) e download dos arquivos |
| `POST /api/ai/conteudo` | (IA) propõe o texto do conteúdo de um bloco |
| `GET/PUT/DELETE /api/ai/settings` | (IA) preferências e chave da API do usuário (a chave nunca é devolvida) |
| `POST /api/ai/test` | (IA) testa a chave e o modelo salvos |
| `POST /api/ai/chat` | (IA) um passo do agente, em streaming (SSE) |
| `GET /api/ai/usage` · `POST /api/ai/run-end` | (IA) consumo de tokens do usuário · aviso de como o prompt terminou |

## Estrutura

```
app/            páginas e rotas de API (Next.js)
components/     MindMap.jsx — editor (canvas, pan/zoom, seleção, menu) · AiAssistant.jsx — chat e setup da IA
components/ai/  agent.js (streaming e laço de ferramentas) · executor.js (ferramentas + cursor) · screenshot.js (print)
lib/ai.js       IA: chave criptografada, preferências, cliente Anthropic · lib/ai-tools.js — ferramentas e prompt de sistema
lib/mm-core.js  funções puras do mapa (layout, linhas, posicionamento)
lib/db.js       SQLite: esquema, CRUD e validação
Dockerfile, docker-compose.yml
```
