# Fazer o filme da viagem

O filme é o que o scroll conduz. Pode ser um vídeo cortado em fotogramas (canvas) ou um mundo de camadas (PNG/SVG
que a câmara atravessa). Escolher pela ordem abaixo: o mais barato que fique bonito.

## Quantos fotogramas e quanto pesa

- Regra: **15–25 fotogramas por ecrã de scroll**. Uma viagem de `--ecras:8` → 120–200 fotogramas no PC; o telemóvel
  aguenta com 60–70 % disso.
- PC a 1600 px de largura em WebP qualidade ~62: 40–90 KB cada (vídeo suave pesa menos, vídeo com grão pesa mais).
  Telemóvel 720×1280: 20–40 KB.
- Tectos: **9 MB no PC, 4 MB no telemóvel**. O `fotogramas.py` avisa. Passou? Baixar `--n`, `--largura` ou
  `--qualidade` (55 ainda fica limpo em imagens escuras).
- A carga é progressiva (o motor puxa primeiro e último, depois de 32 em 32, 16, 8...): a viagem anda logo, aos
  saltos, e fica fina em segundos. Seis pedidos de cada vez.

## A — os vídeos que o cliente já tem

Anúncios, reels, drone, filmagens do espaço. Escolher os planos com **movimento de câmara contínuo** (travelling,
drone a avançar, rotação à volta do produto); evitar cortes rápidos e caras a falar.

```bash
# cortar a parte boa de cada vídeo (início e duração em segundos), sem som
ffmpeg -ss 3.2 -t 4.5 -i anuncio1.mp4 -an -c:v libx264 -crf 14 a.mp4
ffmpeg -ss 0.0 -t 5.0 -i anuncio2.mp4 -an -c:v libx264 -crf 14 b.mp4
# colar numa viagem e cortar em fotogramas (PC + telemóvel recortado à volta de 40 % da largura)
python -I scripts/fotogramas.py a.mp4 b.mp4 --saida site/frames --n 140 --foco 0.4
```

Entre dois planos que não encaixam, esconder a troca: um véu de cor da marca, uma nuvem/fumo (camada `.nuvem` por cima
do canvas com `data-beat="fade"` num intervalo curto), ou uma palavra gigante que tapa o ecrã durante 3 % do progresso.

## B — IA (Higgsfield), uma viagem sem cortes

O truque do Levora: **cada clip começa exatamente onde o anterior acaba**.

1. **Imagens-chave** (uma por paragem, 4–7), todas no mesmo estilo: `generate_image` com o mesmo prompt de estilo,
   e as fotos/logótipo do cliente como referência (`media_upload` → `media_confirm`). Formato 16:9 para o PC.
   Prompt de estilo: «[estilo da marca], [luz], [paleta], wide establishing shot, no text, no logos».
2. **Clips entre imagens**: `generate_video` com `start_image` = imagem N e `end_image` = imagem N+1, 5 s, sem som.
   Modelos com primeiro **e** último fotograma (confirmado a 18 out 2026 com `models_explore` →
   `action: recommend`, «start frame end frame»): `flux_3_video` (5–20 s, até 4K, `generate_audio` vem ligado: pôr
   `false`) e `minimax_h3_max` (5–15 s, 768p). Os modelos mudam: perguntar outra vez ao `models_explore`.
   Prompt do movimento, sempre de câmara e contínuo:
   - «slow continuous dolly forward through the [portal/door/window], seamless, no cuts»
   - «camera flies forward into the clouds and emerges above [cena seguinte], one continuous shot»
   - «slow 180° orbit around the [produto] on a seamless [cor] background, studio light, no cuts»
   - «the [produto] separates into its parts in mid-air (exploded view), slow, centered, seamless background»
3. **Telemóvel**: repetir em 9:16 (as mesmas imagens recortadas ou geradas ao alto) ou usar `--foco`.
4. `jobs_wait` até acabarem, descarregar os mp4 e `fotogramas.py clip1.mp4 clip2.mp4 ... --saida frames`
   (o primeiro fotograma de cada clip seguinte sai, por ser repetido).

**Custa créditos.** Antes de gerar: ver o saldo (`balance`) e o preço de cada modelo; gerar primeiro **um** clip de
teste barato (resolução baixa) e só depois a viagem toda. Sem créditos → C.

## C — mundo de camadas (sem vídeo)

A câmara avança pelo eixo z (`.mundo[data-viagem]`), cada camada tem `data-z`. Bom para ilustração, paisagem,
interiores, «entrar» num sítio. Camadas:

- **Recortes do cliente** em PNG/WebP com transparência (pessoas, carro, produto, edifício): `remove_background` no
  Higgsfield, ou fotografias já recortadas.
- **Fundos** largos (`--w: 300vmax`) com chão por baixo, para nunca se verem as pontas.
- **Véus** entre cenas (`.nuvem`): gradientes radiais grandes que enchem o ecrã quando a câmara passa por eles.
- **Céu** fora do mundo (`.ceu` com `data-beat="fade"`), com lua/sol lá dentro.
- A demo NORTE desenha serras e o portal em SVG (`starter/js/demo.js`): serve para uma marca sem fotografia nenhuma.

Contas: uma camada a `z` enche exatamente o tamanho que tem no CSS quando a câmara está em `z - 1`. A câmara anda de 0
a `data-viagem`. A cena final fica composta com camadas a `z ≈ data-viagem + 1` (tamanho real) até `+ 2.5`.

## D — o produto (DRIP)

- **Fotos à volta do produto** (24–72, fundo liso, mesma luz) → um vídeo (`ffmpeg -framerate 24 -i %03d.jpg`) →
  fotogramas. Ou um render 3D (Blender) com a rotação e a vista explodida.
- **Peças soltas** (tampa, corpo, luz) em PNG com `data-peca`: chega para «separar», «subir», «acender».
- **Three.js** só quando o cliente quer rodar o produto com o rato: carregar a biblioteca do próprio site (`vendor/`),
  só quando o scroll pára perto da secção, e desenhar só com o visor à vista.

## Porque não `<video>` com `currentTime`

Os browsers só param em keyframes: o scrub engasga e no Safari salta. Codificar tudo em keyframes (`-g 1`) resolve
mas pesa o mesmo que os fotogramas e não tem carga progressiva. Fotogramas num canvas: certos em todo o lado.
