---
name: widget-amg
description: Como mexer no widget do Agente AMG (o botão no ambiente de trabalho e a central de comando, Qt/PySide6 em widget/team_widget) sem o piorar. Usar sempre que o pedido fala do widget, do relógio, da estrela, da central de comando, das pílulas/ícones ao lado do relógio, dos tokens ou das câmaras no widget.
---

# Widget AMG: o que o Marco gosta, o que já correu mal e como testar

O widget é `widget/team_widget` (PySide6). Quase tudo está em `ui/window.py`: `Orb` (o cartão minimizado: estrela, hora, AMG e
ícones; o `InfoColumn` antigo já não se mostra), `WidgetWindow` (a central de comando e o crescer/encolher). `ui/tokens.py` é a Central de tokens. Os dados
vêm do Hub em `GET /api/local/live` (`backend/app/routers/local.py`).

## O visual que fica (decidido a 23 out, depois de várias voltas)

- **Minimizado = transparente, sem cartão** (24 out, 4.ª volta do dia: «não curti... mete tipo transparente, como tava
  antes... tá grande»). Pequeno (estrela 46 px, hora 24 pt). Sem fundo: só uma sombra escura suave e sem bordas por trás
  (`glow_disc` preto no `paint_face`), sempre igual, que deixa a hora cromada ler-se em fundo claro, cinzento ou escuro; cada
  pílula tem a sua própria cápsula escura. `Orb`: **a estrela da Mercedes à esquerda**; à direita, **em cima**, uma fila de pílulas pequenas, uma por opção ligada em «No relógio»
  (`GAUGES`: Claude, Tokens, Equipa, Mensagens, Tarefas, Ponto, Câmaras, FundedNext; `paint_chip`: um anel minúsculo à
  volta do ícone, na cor do estado, e o número ao lado); por baixo a hora **em cromado** (`chrome_text`), e por baixo dela
  o AMG com a data (ou, a âmbar/vermelho, «O Claude espera por ti», «Hub desligado»). Até 4 pílulas por fila (5 = 3+2); o
  cartão ajusta a largura e a altura ao que tem. Cada pílula faz a sua coisa ao clicar (`_gauge_clicked`): Ponto com dois
  cliques, Câmaras abre a cave, Mensagens/Tarefas/FundedNext a página, o resto a central; o rato mostra o detalhe.
  **Desde 28 out cada pílula abre o seu destaque** (`ui/spotlight.py`, conteúdo em `_spot_content` no `window.py`; Marco: «aquele não
  faz nada... preciso de utilizar para ver rápido»): um cartão preto ao lado do relógio com as coisas mesmo — Claude (as tuas janelas e o
  que fazem), Tokens (5 h e semana de cada um), Equipa (quantos Claudes cada um tem a trabalhar e em quê), Mensagens e Tarefas (as
  próprias, vindas de `message_list`/`task_list` do `/api/local/live`), Ponto (as horas e o botão), Câmaras (um botão por sala da cave:
  abre a mini janela com `?mini=1&cam=office|trading|etsy|vault|garage|all`), FundedNext. Clicar numa linha faz o que diz e fecha.
  A pílula Equipa mostra os Claudes da equipa a trabalhar.
- **A central** (28 out, 2.ª volta: «tá tudo igual», queria-a mudada a sério) segue o **Painel do Hub** (o dashboard do
  vídeo, `frontend/hub/painel.css`): a hora com o dia escrito por extenso («quarta-feira / 28 de outubro», tem de se ler);
  a fila de números `Kpi` (Claudes aceso, Mensagens, Tarefas, Ponto), cada um abre o mesmo destaque do relógio ao lado da
  central; módulos numerados como no Hub (`Platter(title, note, num)`: «01 EQUIPA», «02 NO RELÓGIO», «03 CONTROLO»,
  «04 ATALHOS»). Na Equipa, `TeamPick`: as três fotos do GitHub grandes (`ui/photos.py`), anel verde/âmbar pelo Claude;
  clicar numa mostra o 5 h e a semana dessa pessoa e as janelas dela (`pick_rows`), guardado em `team_pick`.
- **Três tamanhos, uma coisa só** (28 out, Marco: «quando eu digo para atualizares uma cena no widget, tens que atualizar todas as
  páginas»): relógio, destaque e central mostram os mesmos números. Mudar um = mudar os três (e o Escritório/3D se for o vídeo).
- **A central** (24 out): Equipa logo por baixo da hora com o 5 h e a semana de cada um (o número grande de tokens em
  milhares/milhões saiu: «texto desnecessário»), «No relógio» (8 opções), Claude agora, **Controlo** (os botões que só
  estavam no menu da bandeja: ponto, pausar/retomar, parar, por cima, invisível, Hub) e as apps com ícones cromados.
- **Lê-se em qualquer fundo pela sombra fixa, não por um cartão.** Nunca trocar de cor a olhar para o fundo (salta e parece
  avariado) e nunca letras sem sombra: testar sempre por cima de escuro, cinzento médio e branco.
- **Arrastar só move o cartão**, nada se reorganiza a meio; ao largar volta para dentro do ecrã se passou de uma borda, e
  o sítio fica guardado (`star_x`, `star_y`). Nada encaixa sozinho nos cantos.
- **Ajusta-se às bordas ao largar** (24 out, «sempre que eu arrastar para os cantos do monitor... tem que ajustar os ícones e
  tudo»): na metade direita do ecrã a estrela vai para o lado de fora e os ícones, a hora e o AMG encostam-se a ela, virados
  para dentro (`Orb.set_flip`, decidido no `_layout_orb`). Só ao largar; a meio do arrasto nada muda.
- **A central** é preta e cromada, ao estilo dos widgets do iOS, e tem de caber no ecrã (1032 px de altura no PC do Marco).

## O que o Marco recusou (não voltar a fazer)

| Tentativa | O que ele disse |
|---|---|
| Disco preto com a hora e um ponto verde | «básico» |
| Relógio analógico de tablier (IWC), com aro e ponteiros | «forçado», «ficou mais feio» |
| Cartões grandes por baixo do relógio | «ocupa boé espaço» |
| Pílulas de texto ao lado, com a hora numa pílula | «feio» |
| Cartão 200 × 86: estrela, hora, AMG e ícones minúsculos com um ponto (23 out) | «as horas bué feio», as opções «nem vale a pena» |
| Ecrã bloqueado do iPhone: estrela pequena, hora ao centro e mostradores redondos grandes por baixo (24 out) | «não é objeto assim tão grande», «mete o símbolo da Mercedes», «os ícones mete acima» |
| Cartão de vidro escuro com estrela grande, pílulas por cima e hora cromada (24 out, 4fa0a67) | «não curti», «tá grande», quer transparente como antes |
| Central igual com só uma linha nova (28 out, 1.ª volta) | «tá tudo igual... só meteste tudo por fora» |
| Data do relógio a 7 pt cinzenta | «quase nem consigo ver o que dia é nem o mês» (por cima de vídeo): 8 pt quase branca com contorno escuro |
| Destaque como `Qt.Popup` | segurava o rato: o clique que o fechava não chegava ao relógio e arrastar falhava; agora `Qt.Tool`, fecha ao arrastar e ao clicar fora |
| Encaixar sozinho no canto do ecrã | não era isso: quer mexer à vontade e que o resto se ajuste |
| Data, «Tudo bem», ponto e o módulo Limites na central | tralha |
| Hora branca fixa sem olhar para o fundo | em fundos brancos deixa de se ler |
| Estrela, risco, hora e AMG soltos no fundo, a trocar de cor pelo fundo | «tudo bug»: ilegível em cinzento, troca de cor a saltar |
| A hora e os ícones a reorganizarem-se enquanto se arrasta | «puxar e arrastar é tudo bug» |

Regra que sai daqui: **melhorar por cima do que ele já aprovou, não reinventar**. Antes de mudar o aspeto, ver como estava
no `git log -p widget/team_widget/ui/window.py` e manter o que funcionava. Na dúvida, fazer pequeno, mostrar, e ele diz.

## Peso (regra da equipa)

Parado não desenha nada: só repinta quando muda o minuto, o estado ou os dados do Hub (8 s; 4 s com os tokens no ecrã).
Animações só depois de uma mudança, pelo `motion.clock()`. Nada de browser (QWebEngine) dentro do widget: as câmaras e a cave
abrem na mini janela (`ui/mini.py`) só quando se pedem.

## Testar sem mexer no widget do Marco

1. Hub de teste com uma cópia da base de dados (`sqlite3 ... .backup`) na porta 8010 (ver CLAUDE.md, «Testar uma mudança no Hub»).
2. Um script que cria `WidgetWindow(StateStore(), cliente_falso)` com `TEAM_HUB_URL=http://127.0.0.1:8010`, espera ~9 s pelos
   dados, liga os ícones (`pin.on = True`, depois `win._layout_orb()`), e grava `win.grab()` por cima de três fundos:
   **escuro, cinzento médio e branco** (o fundo do Marco é cinzento-claro). Tem de se ler igual nos três.
3. Guardar e repor `~/.team-agent/widget-prefs.json` à volta do teste (o teste muda os pins).
4. Testar o cartão largado fora do ecrã (`win._layout_orb(QPoint(...))`): tem de voltar para dentro.
5. **Arrastar com eventos de rato a sério** (QMouseEvent enviado ao `orb`): para a metade direita de cada monitor (o Marco tem
   dois, lado a lado), com um destaque aberto, e para um canto. E pôr o relógio por cima de um frame de vídeo claro, não só
   cores lisas. Mexer numa coisa = testar o resto todo do widget, não só o que mudou.
6. Antes de dizer que está bom, tirar uma captura do ecrã verdadeiro (`QGuiApplication.primaryScreen().grabWindow(0)`) e
   ver o widget no fundo que o Marco tem mesmo.

## Publicar

`cd widget; ..\.venv\Scripts\python -m pytest tests -q`, commit só dos teus ficheiros, `git fetch` + `git rebase --autostash
origin/main` + `git push`, e reiniciar o widget (parar o `pythonw ... team_widget` e correr `Desktop\Abrir AMG.cmd`). Se mudou
o backend, reiniciar também o Hub da porta 8000. Mais do que uma janela do Claude pode estar a mexer no `window.py`:
perguntar por mensagem (ListAgents/SendMessage) antes de mexer e fazer commit logo a seguir.
