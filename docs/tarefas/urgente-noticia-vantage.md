# URGENTE: aviso de notícia Forex Factory no Hub, para abrir no Vantage

**Objetivo:** com o Hub aberto, quando sai uma notícia importante do Forex Factory, salta logo um ecrã por cima de tudo a dizer que notícia é, e um botão abre o Vantage para negociar.

## Resultado pedido
1. Popup em qualquer página do Hub, no PC e no telemóvel, com hora, moeda, nome da notícia, impacto, previsto, anterior e real.
2. Contagem decrescente antes da notícia e atualização quando sai o valor real.
3. Botão «Abrir no Vantage» que abre o Vantage no ativo certo. Sem ordens automáticas: a entrada é sempre manual.
4. Aparece depois de um refresh se a notícia ainda estiver ativa, e não repete depois de fechada.
5. Testado com uma notícia simulada e com uma real.

## Partir do que já existe
- `#/sinal` (BUY/SELL no segundo em que sai um dado dos EUA) e `#/reforco`.
- Repo `news-reaction`, dados do Forex Factory e `PATTERNS.md`.
- Skill `hub-pagina`.

## Falta decidir
Que notícias e ativos contam, e se o Vantage abre na app MT5 ou na web. Por omissão: alto impacto USD; ouro, EUR e GER40.
