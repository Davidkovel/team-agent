---
name: widget-amg
description: Como mexer no widget do Agente AMG (o botão no ambiente de trabalho e a central de comando, Qt/PySide6 em widget/team_widget) sem o piorar. Usar sempre que o pedido fala do widget, do relógio, da estrela, da central de comando, das pílulas/ícones ao lado do relógio, dos tokens ou das câmaras no widget.
---

# Widget AMG: o que o Marco gosta, o que já correu mal e como testar

O widget é `widget/team_widget` (PySide6). Quase tudo está em `ui/window.py`: `Orb` (o cartão minimizado: estrela, hora, AMG e
ícones; o `InfoColumn` antigo já não se mostra), `WidgetWindow` (a central de comando e o crescer/encolher). `ui/tokens.py` é a Central de tokens. Os dados
vêm do Hub em `GET /api/local/live` (`backend/app/routers/local.py`).

## O visual que fica (decidido a 23 out, depois de várias voltas)

- **Minimizado = um widget do iOS** (decidido a 23 out, depois de tudo o resto falhar): **um cartão pequeno de vidro escuro**
  (`Orb`, 200 × 86, cantos de 22, sombra suave, aro cromado fino) com a estrela cromada à esquerda, a hora grande, um
  ponto pequeno na cor do estado, o emblema AMG por baixo e uma fila de ícones pequenos das vistas ligadas na central
  (Claude, Tokens, Limites, Câmaras), cada um com um ponto de estado. O rato num ícone mostra a linha dele num balão
  escuro; clicar abre a central (Câmaras abre a cave). Ao clicar no cartão, ele cresce até à central.
- **Lê-se em qualquer fundo porque tem o seu próprio vidro.** Nunca pôr letras soltas por cima do ambiente de trabalho:
  num fundo cinzento médio nem o branco nem o grafite se leem, e trocar de cor a olhar para o fundo salta e parece avariado.
- **Arrastar só move o cartão**, nada se reorganiza a meio; ao largar volta para dentro do ecrã se passou de uma borda, e
  o sítio fica guardado (`star_x`, `star_y`). Nada encaixa sozinho nos cantos.
- **A central** é preta e cromada, ao estilo dos widgets do iOS, e tem de caber no ecrã (1032 px de altura no PC do Marco).

## O que o Marco recusou (não voltar a fazer)

| Tentativa | O que ele disse |
|---|---|
| Disco preto com a hora e um ponto verde | «básico» |
| Relógio analógico de tablier (IWC), com aro e ponteiros | «forçado», «ficou mais feio» |
| Cartões grandes por baixo do relógio | «ocupa boé espaço» |
| Pílulas de texto ao lado, com a hora numa pílula | «feio» |
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
5. Antes de dizer que está bom, tirar uma captura do ecrã verdadeiro (`QGuiApplication.primaryScreen().grabWindow(0)`) e
   ver o widget no fundo que o Marco tem mesmo.

## Publicar

`cd widget; ..\.venv\Scripts\python -m pytest tests -q`, commit só dos teus ficheiros, `git fetch` + `git rebase --autostash
origin/main` + `git push`, e reiniciar o widget (parar o `pythonw ... team_widget` e correr `Desktop\Abrir AMG.cmd`). Se mudou
o backend, reiniciar também o Hub da porta 8000. Mais do que uma janela do Claude pode estar a mexer no `window.py`:
perguntar por mensagem (ListAgents/SendMessage) antes de mexer e fazer commit logo a seguir.
