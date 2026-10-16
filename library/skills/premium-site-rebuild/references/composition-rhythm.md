# Ritmo de composição: como o De Antonio prende o olhar

O site não centra nada duas vezes seguidas. Cada bloco começa noutra margem, o título e o texto
ficam lado a lado, as imagens saem do eixo, e entre blocos há ar a sério. O olho é empurrado
esquerda → direita → esquerda ao longo da página e nunca se habitua. Um site "bom mas plano"
(tudo encostado a 4 %, blocos de 900 px colados) perde exactamente isto.

## Medidas reais (tomas476.github.io/deantonio, 1440 px; esquerda–direita em % do ecrã)

| Bloco | Texto | Imagem / mídia |
|---|---|---|
| Hero | h1 centrado 14–86 sobre vídeo | vídeo a sangrar −2–102 |
| «Hidden outboard engines.» | h2 16–52 e parágrafo 57–92 **no mesmo topo** | cartão desviado à direita 24–96, 80 px abaixo; 3 legendas curtas em 3 colunas por baixo |
| «The range, to scale.» | h2 8–45; parágrafo 47–75 **87 px mais abaixo** (escada) | selector, foto 6–82 |
| «A new era of luxury and performance.» | h2 na **metade direita** 50–92; marca D60 em contorno 16–46 à esquerda; ~390 px de vazio por cima | depois foto a sangrar 0–100, 792 px de altura |
| Números | `dl` 4–96: 18.5m · 2,400 · 46 · 12, serifa grande, rótulos em versaletes | |
| Interior | | carrossel: cartões de 46 %, o primeiro a 16 %, a fila **sai pela direita**; contador 01/07 |
| «European Powerboat of the Year. Twice.» | h2 8–80 | anos gigantes em contorno 2026 (8–31) e 2023 (57–80) **atrás** de duas fotos (8–43, 45–80) que lhes tapam a metade de baixo; legendas 15–43 / 52–80 |
| Momento inteiro | h2 10–76 por cima: «Seeking adventure. The world is out there.» | vídeo −3–103, 873 px |
| «From Barcelona to 39 countries.» | h2 grande 8–49; parágrafo 51–79 **270 px mais abaixo** | mapa |

Intervalo entre blocos: 330–400 px (≈ 35–45 vh). Página: 11 678 px.

## Regras

1. **Nunca duas margens iguais seguidas.** Rodar as entradas 8 / 10 / 16 / 24 / 47–57 %.
2. **Título e texto lado a lado**, não empilhados: título na coluna esquerda, texto na direita,
   no mesmo topo ou em escada (+90 px).
3. **Mídia fora do eixo**: cartões largos a 24–96; carrosséis começam a 16 % e sangram pela
   direita; pelo menos um bloco a sangrar 0–100.
4. **Ar**: 300–400 px entre blocos e, uma ou duas vezes, um ecrã só com uma frase curta (a
   ideia-assinatura que viaja com o scroll enche esse vazio).
5. **Dois momentos de ecrã inteiro** a meio da página (vídeo ou foto 100vw × 100svh).
   Vídeo só vertical (Instagram)? Um tríptico de 3 clips 9:16 lado a lado enche 1440×900
   sem ampliar (3 × 480×853); no telemóvel, um clip só a 100svh.
6. **Tipografia gigante em contorno** (só `stroke`, números ou uma palavra) atrás das imagens,
   com as imagens a tapar-lhe a metade de baixo. Só números verdadeiros do cliente.
7. **Telemóvel**: uma coluna, mas o ritmo fica com recuos alternados (0 / 12 % / 0 / 20 %), o
   carrossel a sangrar e os momentos inteiros.

## Medir em vez de achar

Medir as margens reais de cada bloco do site novo e do De Antonio com Playwright
(`getBoundingClientRect` de h1/h2/p/img/video, em % de `innerWidth`) e comparar em tabela.
Se mais de dois blocos começarem à mesma margem, ou nenhum sangrar, a composição está plana.
