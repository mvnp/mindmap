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

Outros: arraste a tela para navegar e use a roda do mouse para zoom; arraste um bloco sobre outro para mudar o pai; arraste a alça direita de um bloco selecionado para redimensioná-lo (o texto quebra linha).

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

## Estrutura

```
app/            páginas e rotas de API (Next.js)
components/     MindMap.jsx — editor (canvas, pan/zoom, seleção, menu)
lib/db.js       SQLite: esquema, CRUD e validação
Dockerfile, docker-compose.yml
```
