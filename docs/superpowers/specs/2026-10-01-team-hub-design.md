# Team Hub — design (v1, base)

## Objectivo
O widget passa a ser a porta de entrada para um **site partilhado** (Hub) onde a equipa vê e edita tudo num só sítio: empresas, skills, plugins, vídeos, fotos, tarefas e agentes. Qualquer pessoa deve perceber tudo só com os olhos e o rato.

Fora de âmbito da v1 (fica para depois): recolher skills da internet, enviar skills automaticamente aos agentes, editor de media, billing.

## Pessoas e acesso
- Um único servidor, na conta/PC do Covel. Todos entram no mesmo site.
- Utilizadores actuais: `owner`, `mark`, `david` (seed em `backend/app/main.py`).
- **Novo:** o Owner cria utilizadores pela UI (aba Equipa): nome, utilizador, password inicial. Substitui a edição manual de `SEED_USERS`.
- Regras de visibilidade existentes mantêm-se (README, "Кто что видит").

## Online
- `docker compose` no PC do Covel (sempre ligado) + **Cloudflare Tunnel** → URL fixo com HTTPS, acessível de casa de cada um, sem abrir portas.
- **Deploy por Git:** um serviço `deployer` no PC do Covel verifica o remoto a cada ~30 s; se houver commits novos faz `git pull` e `docker compose up -d --build`. Push no GitHub → todos vêem a versão nova.
- Segredos (`.env`, token do tunnel) nunca entram no Git.

## Dashboard como site com abas
Menu lateral, ícones grandes, poucas palavras:

| Aba | Conteúdo |
|---|---|
| Início | resumo: quem está online, o que mexeu por último |
| Empresas | uma entrada por empresa; v1: **BareDesk** (Shopify) |
| Skills / Plugins | pastas e ficheiros partilhados, com editor |
| Agentes, Tarefas | o que já existe no dashboard actual |
| Equipa | utilizadores (criar/editar) e actividade |

Dentro de uma empresa, sub-abas fixas: **Tema · Skills · Plugins · Vídeos · Fotos · Docs**. Clicar em Vídeos mostra os vídeos (reprodutor), clicar em Fotos mostra uma grelha de fotos. Árvore de pastas à esquerda quando faz sentido (Tema, Skills, Plugins, Docs).

Alterações de um utilizador aparecem aos outros em tempo real (WebSocket existente).

### Aparência
- **Cinza escuro com luzes e bordas roxas** (decisão do utilizador, substitui o "segue o PC" da primeira versão). Só tema escuro.
- Visual limpo: cartões grandes, muito espaço, tipografia do sistema, animações curtas. Sem páginas cheias de texto.
- Funciona no telemóvel.

## Empresa BareDesk (dados iniciais)
Fonte: `C:\Users\marco\Documents\baredesk-theme` (repo `Baredesk/baredesk-theme`) + `Desktop\baredesk-anuncio` + `Desktop\BareDesk`.

| Sub-aba | Origem |
|---|---|
| Tema | `layout/ sections/ assets/ config/ locales/` do repo do tema (só leitura na v1) |
| Skills | `.claude/skills/` (ex.: `boa`) |
| Plugins | lista dos plugins usados (manifest com nome + descrição) |
| Vídeos | `ads/` (mp4), `baredesk-anuncio/*.mp4`, `Desktop\BareDesk/*.mp4` |
| Fotos | `shots/`, `Desktop\BareDesk/*.jpg|png`, logos |
| Docs | `docs/`, `guiao.md`, `CLAUDE.md` |

## Onde ficam os dados
- **Texto** (skills, plugins, docs, manifests) → pasta `library/` **no Git**. Editar no site grava o ficheiro e faz commit + push automático; editar no Git aparece no site após o deploy. O Git é a fonte única.
- **Media pesada** (~390 MB e a crescer: vídeos, fotos) → **fora do Git**, num volume do servidor (`/data/media/<empresa>/{videos,fotos}`), servida com streaming. Importação inicial por script a partir das pastas do PC do Covel; depois por upload no site.
- **Tema** → o servidor lê o checkout do repo `baredesk-theme` (read-only); a sincronização é feita pelo mesmo `deployer`.
- Conflitos de edição: v1 só avisa ("alguém editou isto") e não faz merge automático.

## Widget
- Botão **maximizar** abre o Hub (URL público) numa janela grande sem barra de browser (modo app do browser instalado).
- O widget pequeno e o tray mantêm-se como estão.

## Componentes / interfaces
- `backend/app/routers/library.py` — listar/ler/escrever ficheiros em `library/`, commit + push.
- `backend/app/routers/media.py` — listar e servir media por empresa/tipo (Range requests).
- `backend/app/routers/users.py` — criar/listar utilizadores (só Owner).
- `backend/app/companies.py` — registo de empresas (`companies.json` em `library/`).
- `frontend/` — passa de uma página para shell com abas (rotas por hash), mantendo HTML/JS estático sem build.
- `deployer/` — script + serviço compose para pull/redeploy.
- `scripts/import_baredesk.py` — importação inicial.
- `widget/team_widget/ui/window.py` — botão maximizar.

## Erros e segurança
- Caminhos validados contra `..` e fora de `library/` ou `/data/media`.
- Só utilizadores autenticados; criar utilizadores e apagar só Owner.
- Falha de push → edição fica guardada localmente e a UI mostra "por sincronizar".
- Cloudflare Tunnel dá HTTPS; o token do WebSocket em query string (limitação conhecida do README) fica anotado para a v2.

## Testes
- Backend: path traversal bloqueado, permissões por papel, criar utilizador, listagem/stream de media, commit na edição.
- Frontend: verificação manual no browser com a empresa BareDesk carregada.
- Deployer: teste com repo local de origem simulado.

## Decisões em aberto (não bloqueiam a spec)
- Quais plugins entram no manifest do BareDesk (lista a confirmar com os dados reais).
- Domínio do tunnel (subdomínio grátis `trycloudflare` ou domínio próprio).
