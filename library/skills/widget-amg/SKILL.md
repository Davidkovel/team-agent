---
name: widget-amg
description: Como mexer no widget do Agente AMG (o botão no ambiente de trabalho e a central de comando, Qt/PySide6 em widget/team_widget) sem o piorar. Usar sempre que o pedido fala do widget, do relógio, da estrela, da central de comando, das pílulas/ícones ao lado do relógio, dos tokens ou das câmaras no widget.
---

# Widget AMG: o que o Marco gosta, o que já correu mal e como testar

O widget é `widget/team_widget` (PySide6). Quase tudo está em `ui/window.py`: `Orb` (a estrela), `InfoColumn` (a hora e os
ícones ao lado), `WidgetWindow` (a central de comando e o crescer/encolher). `ui/tokens.py` é a Central de tokens. Os dados
vêm do Hub em `GET /api/local/live` (`backend/app/routers/local.py`).

## O visual que fica (decidido a 23 out, depois de várias voltas)

- **Minimizado = o visual de 2 out:** a estrela da Mercedes cromada (64 px, com sombra, **sem** disco, mostrador, luz por
  trás ou ponto de estado), um risco fino, **a hora** em letra grande e o **emblema AMG** por baixo. Nada de caixas à volta.
- **A cor segue o fundo:** de 20 em 20 s (e ao largar a estrela) `WidgetWindow._sample` olha para o ambiente de trabalho
  atrás da hora: em fundo claro, letras, risco e AMG passam a grafite com halo claro. Nunca tirar isto.
- **Ao lado do relógio**, por baixo do AMG: um **ícone redondo pequeno** por cada vista ligada na central (Claude, Tokens,
  Limites, Câmaras), com um ponto na cor do estado. **O rato por cima abre o ícone** numa cápsula com a informação.
  Clicar abre a central (as Câmaras abrem a cave ao vivo).
- **Mexe-se à vontade:** nada encaixa sozinho nos cantos. Ao arrastar, a hora e os ícones mudam de lado perto da borda
  direita e nunca saem do ecrã. O sítio fica guardado (`star_x`, `star_y` em `~/.team-agent/widget-prefs.json`).
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

Regra que sai daqui: **melhorar por cima do que ele já aprovou, não reinventar**. Antes de mudar o aspeto, ver como estava
no `git log -p widget/team_widget/ui/window.py` e manter o que funcionava. Na dúvida, fazer pequeno, mostrar, e ele diz.

## Peso (regra da equipa)

Parado não desenha nada: só repinta quando muda o minuto, o estado ou os dados do Hub (8 s; 4 s com os tokens no ecrã).
Animações só depois de uma mudança, pelo `motion.clock()`. Nada de browser (QWebEngine) dentro do widget: as câmaras e a cave
abrem na mini janela (`ui/mini.py`) só quando se pedem.

## Testar sem mexer no widget do Marco

1. Hub de teste com uma cópia da base de dados (`sqlite3 ... .backup`) na porta 8010 (ver CLAUDE.md, «Testar uma mudança no Hub»).
2. Um script que cria `WidgetWindow(StateStore(), cliente_falso)` com `TEAM_HUB_URL=http://127.0.0.1:8010`, espera ~9 s pelos
   dados, liga os ícones (`pin.on = True`), e grava `win.grab()` por cima de um fundo **escuro e de um claro**
   (`glance.set_light(True/False)`). Para um ícone aberto: `win.glance.open["tokens"] = 1.0`.
3. Guardar e repor `~/.team-agent/widget-prefs.json` à volta do teste (o teste muda os pins).
4. Testar a estrela encostada à direita, à esquerda, em cima e em baixo (`win._layout_orb(QPoint(...))`): os ícones têm de
   ficar dentro do ecrã.

## Publicar

`cd widget; ..\.venv\Scripts\python -m pytest tests -q`, commit só dos teus ficheiros, `git fetch` + `git rebase --autostash
origin/main` + `git push`, e reiniciar o widget (parar o `pythonw ... team_widget` e correr `Desktop\Abrir AMG.cmd`). Se mudou
o backend, reiniciar também o Hub da porta 8000. Mais do que uma janela do Claude pode estar a mexer no `window.py`:
perguntar por mensagem (ListAgents/SendMessage) antes de mexer e fazer commit logo a seguir.
