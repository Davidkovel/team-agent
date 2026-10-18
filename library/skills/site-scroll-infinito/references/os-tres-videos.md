# Os três vídeos, ecrã a ecrã

Vistos fotograma a fotograma a 18 out 2026 (yt-dlp `--impersonate chrome` + ffmpeg). São vídeos de 10–15 s de
contas que mostram sites feitos «com o Claude»; o que está escrito em cada legenda vai citado. Nenhum dos sites é
nosso: aprender a técnica, nunca copiar a marca, as imagens ou os textos.

## 1. Levora — «Infinite Scroll» (@wearebrand.io, 15 s)

Site de um jogo («A Metaverse Medieval Game»). Legenda: «the scroll continue…».

| Momento | Ecrã | Como se faz |
|---|---|---|
| 0 % | Hero ilustrado dentro de uma **moldura rasgada** (papel queimado, cor de magenta e roxo); título serifado centrado, uma linha, botão em pílula roxo «Start the journey». Cabeçalho transparente: logótipo à esquerda, «About», «Subscribe» em pílula e o menu. «Scroll ——» no canto de baixo à direita. | Moldura = camada da frente com um buraco (máscara/SVG `evenodd`). |
| 5–15 % | A câmara **entra pelo buraco**: a moldura cresce e sai pelos lados, o mundo aproxima-se. | Fotogramas de um zoom contínuo (ou camadas a escalar). |
| 15–25 % | Mergulho **dentro das nuvens** (o ecrã fica só nuvem cor-de-rosa), sai do outro lado numa cena nova: ilha voante, dragões, planetas. | As nuvens escondem a troca de cena: é assim que clips diferentes parecem um só. |
| 25–35 % | «Extraordinary Trading Strategies»: título + parágrafo à esquerda por cima da cena, que continua a mexer. | Texto em HTML por cima do palco fixo, com entrada/saída ligada ao progresso. |
| 35–55 % | Interior roxo e azul: «Evolutionary NFTs & Lucrative Play 2 Earn», cartas de NFT, um ovo a brilhar com «What makes Levora unique?». | Mais paragens; o fundo nunca pára. |
| 55–80 % | Escamas de dragão, um portal circular com runas: «Experience history with your own hands. Explore, plunder and conquer.» | Cena que se aproxima até encher o ecrã. |
| 80–100 % | Nuvens outra vez, falésias vermelhas: «Token Generation», «Whitepaper and…». | O mesmo truque: nuvem entre cenas. |

O essencial: **um só plano-sequência**. Nunca há um corte seco: cada cena nasce da anterior (zoom, nuvem, portal).
Paleta muito fechada (magenta, roxo, azul-noite), uma letra serifada para títulos e uma sem serifa pequena para o texto.

## 2. Mr. Day — «Claude can you build this?» (@webforge6, 12 s)

Marca italiana de bolos embalados. A legenda explica a faixa: duplicar o conteúdo, pô-lo num flex mais largo do que o
ecrã e animar com **um só `@keyframes` de 0 a -50 %** (não -100 %): quando o conteúdo é exatamente o dobro, a volta
recomeça sem se ver. CSS puro, corre no compositor, sem contas de scroll.

| Momento | Ecrã | Como se faz |
|---|---|---|
| 0–25 % | Hero laranja vivo: donut de chocolate gigante a rodar devagar, embalagem a entrar de lado; cartão creme «Donut Level UP: sbloccato il bundle al cioccolato» com botão azul «SCOPRI I DONUTS »». Em baixo uma barra de vídeo com **34 %… 59 %**, ⏮ ⏸ ⏭. | Vídeo do produto + percentagem que conta. |
| Cabeçalho | Logótipo «Let's play MR. DAY» ao centro, numa **aba que desce** do topo; botões em pílula «PRODOTTI», «CONCORSI», «NEWS ED EVENTI», «MODALITÀ STORIA». | Cabeçalho fixo, logótipo grande ao meio. |
| 25–40 % | Faixa preta «MR. DAY LET'S PLAY» a correr; ecrã laranja vazio onde **as embalagens caem uma a uma** e se alinham, depois sobem para o topo. | `data-cai`: cada peça entra com uma curva que passa do sítio e volta (overshoot). |
| 40–60 % | **Faixas cruzadas em diagonal**, creme e azul, a correr em sentidos opostos: «MUFFIN 🧁 MUFFIN», «BROWNIES», «DONUTS», «CIAMBELLE», «PLUMCAKE», com as fotos dos produtos entre as palavras e faixas azuis «SCOPRI I MUFFIN». | `data-faixa` com `rotate`, uma com `animation-direction: reverse`. |
| 60–75 % | «Level 40 Unlocked — il break che sblocca le differenze» à esquerda; a mascote com «LEVEL 40 UNLOCKED» e prémios (viagem a Tóquio). | Bloco de campanha. |
| 75–100 % | Uma **onda** passa o laranja a azul-céu com nuvens; televisão retro a passar o anúncio «MR.DAY sale al lv.40!»; a faixa «LET'S PLAY» volta e o rodapé escuro. | Mudança de cor (`data-cor`) + divisória em onda (SVG). |

O essencial: **energia de marca de consumo** — cores puras, letra muito grossa, tudo a mexer em loop, e cada secção
entra de uma maneira diferente (cair, correr, onda).

## 3. DRIP — «Can you believe Claude did this?» (@webloved, 10 s)

Garrafa de água com luz UV-C. A legenda diz: Three.js para a garrafa em 3D a rodar com o rato, luz que reage ao
scroll, `scroll-snap` horizontal para a galeria, GSAP ScrollTrigger a prender o produto enquanto o texto corre,
gradiente radial no preto para a profundidade, lottie para animações. (O que se vê no vídeo também se faz com
fotogramas de um render, que é mais leve e certo no telemóvel.)

| Momento | Ecrã | Como se faz |
|---|---|---|
| 0 % | Fundo creme, a garrafa preta enorme na diagonal a sair do ecrã; «The Future / Of Hydration» à esquerda, «Scroll Down». Cabeçalho: HOME, ABOUT, SHOP, logótipo «DRIP» ao centro, conta, saco, «BUY NOW». | Fotograma 1 do filme do produto. |
| 10–25 % | A garrafa **roda até ficar de pé ao centro**; «UV-C / Water Bottle» com parágrafo. | Palco preso (`data-cena`), fotogramas. |
| 25–40 % | «Sleek / Design» à esquerda, parágrafo à direita; depois «Stainless / Steel» e «Capacity 600ml». | Rótulos em lados alternados (`data-beat`). |
| 40–60 % | A **tampa separa-se** da garrafa (vista explodida), vira-se e mostra o fundo: macro da **porta USB-C** com textura de pedra, «Charging Type USB-C». | Fotogramas do render (ou `data-peca`). |
| 60–80 % | Anéis de luz roxa sobem pela tampa, **«Battery Capacity 5000 mAh»** com os números a rolar; a luz UV-C acende. | `data-conta` + peça de luz com opacidade. |
| 80–100 % | Tampa e garrafa juntam-se; o fundo passa a **azul-escuro**: «Say Goodbye to Single Use Water Bottles», «99.9 %», «Ready to experience smart hydration?» + botão, rodapé. | `data-cor` para escuro + números + CTA. |

O essencial: **o produto é o herói e nunca sai do meio**; tudo o resto (texto, números, luz) roda à volta dele com o
scroll. Muito ar, uma letra sem serifa limpa, duas cores (creme e preto) e uma de acento (roxo UV).

## O que os três têm em comum (as regras da skill)

1. Uma viagem contínua: o scroll é o comando de um filme, não a passagem de páginas.
2. O palco fica preso enquanto o filme corre; o texto entra e sai por cima, em HTML.
3. As trocas escondem-se (nuvem, portal, onda, rotação do produto): nunca um corte seco.
4. Cabeçalho mínimo, transparente, com um indicador de scroll ou de percentagem.
5. Pouca cor, uma letra de títulos com personalidade, muito espaço.
6. Um convite no fim (botão), logo a seguir à última paragem.
