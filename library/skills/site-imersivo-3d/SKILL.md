---
name: site-imersivo-3d
description: Faz um site imersivo de nível Awwwards (3D em tempo real, scroll que conta uma história, som, um objeto-herói que nunca sai do ecrã), no estilo dos sites que o Marco escolheu a 24 out 2026 (Aether 1, Seasats Lightfish, Corn Revolution da Resn, Utsubo, Alche) e dos que o Claude juntou (Lusion, Igloo Inc, Active Theory, Bruno Simon, Messenger, 14islands). Usar quando pedirem "site como o aether1 / seasats / utsubo / alche", "site 3D", "site imersivo", "site Awwwards", "produto em 3D que roda com o scroll", "site com WebGL", "site de estúdio criativo", "site para lançar um produto", "сайт как этот", "крутой 3D сайт", "иммерсивный сайт", ou mandarem links de sites assim para copiar a ideia. Também para juntar um site novo à Galeria do Hub (Skills › Galeria).
---

# site-imersivo-3d: um site que se lembra

A galeria destes sites está no Hub, **Skills › Galeria** (`#/galeria`): fotografia, o golpe de cada um, o que roubar, a stack e
um botão «Copiar o pedido». A lista é `frontend/hub/galeria/sites.json`. Abre-a antes de começar e escolhe com a pessoa (ou
sozinho, pelo negócio) **um** site de referência e **um** golpe. Um site com cinco golpes não tem nenhum.

Para o código 3D (Three.js + GSAP + Lenis, shaders, pós-processamento, transições) segue a skill **`awwwards-3d`** (está na
biblioteca, com modelos prontos em `assets/templates`). Esta skill decide **o quê** e **porquê**; aquela dá **o como**.
Para o ritmo do scroll e o resto do site junta a `site-scroll-infinito`, e a regra dos 3 segundos: cada ecrã agarra em 3 s.

## 1. Escolher o padrão pelo negócio

| O cliente tem… | Padrão | Referência | O golpe |
|---|---|---|---|
| Um produto físico (auriculares, barco, relógio, carro) | **Produto-herói** | Aether 1, Seasats | O produto fica no ecrã o site todo; o scroll muda o ângulo e o estado (abre, desmonta, raio-X) capítulo a capítulo |
| Uma história ou um processo (ciência, fábrica, origem) | **Viagem de um objeto** | Corn Revolution, Igloo | Um só objeto atravessa os capítulos; as transições são partículas que se refazem noutra forma |
| Um estúdio, agência, criativo | **Mascote / sala de trabalhos** | Utsubo, Alche, Lusion | Uma personagem 3D que é a marca, ou os trabalhos como ecrãs curvos numa sala que roda |
| Pouco orçamento ou pouco tempo | **Tipografia gigante** | 14islands | Letra enorme, espaço vazio, movimento discreto e igual em todo o lado: parece caro sem 3D |
| Uma marca que quer ser falada | **Brinquedo** | Bruno Simon, Messenger | A página é um jogo pequeno: conduzir, andar, explorar |

## 2. As peças que se repetem nos melhores (roubar à vontade)

1. **Porta de entrada** (Utsubo, Messenger, Bruno Simon): um botão redondo «Entrar» / «Begin» com «melhor com som». Serve
   para três coisas ao mesmo tempo: carrega a cena por trás, desbloqueia o áudio (o browser só deixa depois de um clique) e
   cria expectativa. Nunca mais de 2 s de espera depois do clique.
2. **Objeto que não sai** (Aether, Seasats, Corn): uma cena Three.js fixa (`position: fixed`) por trás do HTML; cada secção
   tem uma *pose* (posição, rotação, estado) e o scroll interpola entre poses com uma timeline GSAP com `scrub`. O texto
   passa por cima; o objeto fica.
3. **Capítulos à vista**: lista de capítulos no menu (Aether: Sound · Craft · Controls · Power · Specs) ou pontos à direita
   (Corn). A pessoa sabe sempre onde está e quanto falta.
4. **Trocar de produto sem sair** (Seasats): pílula fixa em baixo com os modelos; troca o objeto 3D e a ficha.
5. **Raio-X / interior** (Seasats «X-ray view»): um interruptor que troca o material para transparente/linhas. Barato de
   fazer (outro material no mesmo modelo) e as pessoas adoram.
6. **Ficha técnica em mono** (Seasats): tabela de números em letra mono com «Descarregar ficha» (PDF).
7. **HUD** (Alche, Igloo): números pequenos, giroscópio, grelha, coordenadas nos cantos. Dá ar técnico e premium.
8. **3D num cartão** (Lusion): a cena dentro de um rectângulo de cantos redondos em vez do ecrã todo. Mais elegante, mais leve.
9. **Assistente fixo** (Aether «Ask Aether»): um botão em baixo que abre perguntas sobre o produto. Em sites nossos pode ser
   o WhatsApp com a pergunta já escrita.
10. **Mudança de página sem recarregar** (Alche, com Swup): a cena 3D continua viva entre páginas.

## 3. A stack (igual ao que eles usam, sem build quando possível)

- **Por omissão:** HTML + CSS + JS num ficheiro, Three.js + GSAP (ScrollTrigger) + Lenis por CDN, como na `awwwards-3d`.
  Publica-se em GitHub Pages como os outros sites da empresa.
- **Projeto grande ou do cliente em React:** Next.js + React Three Fiber + drei + GSAP + Lenis (é a stack da Seasats).
- **Site de estúdio com várias páginas:** Astro + Three.js + GSAP + Lenis (Utsubo) ou + Swup para as transições (Alche).
- **Som:** Howler.js, só depois do clique da porta de entrada, com botão para desligar sempre à vista.
- **Animações 2D vetoriais** (ícones, logótipo a desenhar-se): Rive ou Lottie.

## 4. O modelo 3D (de onde vem)

1. O cliente tem CAD/3D do produto → exportar para **GLB**, comprimir com `gltf-transform` (Draco ou Meshopt, texturas
   KTX2/WebP), alvo **< 3 MB**.
2. Só há fotografias → **Higgsfield `generate_3d`** (imagem → GLB) ou Meshy/Tripo; limpar no Blender.
3. Nada → modelo de **licença aberta** (Sketchfab CC0/CC-BY, Poly Haven) com o crédito no rodapé, ou geometria procedural
   (a `awwwards-3d` tem `references/PROCEDURAL_GEOMETRY.md`).
4. Luz: um HDRI pequeno (1k) em vez de muitas luzes.

## 5. Regras que não se discutem

- **Telemóvel primeiro:** DPR máximo 1,5, menos partículas, sem pós-processamento pesado; se o GPU for fraco
  (`renderer.capabilities`, FPS < 40 nos primeiros 2 s) troca a cena por um **vídeo em loop** da mesma cena (gravado do
  próprio site). Nunca um ecrã preto.
- **`prefers-reduced-motion`:** sem scrub, poses fixas, fade simples.
- **Parar quando ninguém vê:** `requestAnimationFrame` pára com a aba escondida (`visibilitychange`) e a cena fora do ecrã.
- **O texto é HTML de verdade** (SEO, leitores de ecrã), nunca texto desenhado dentro do canvas.
- **Primeiro ecrã em < 2,5 s:** o poster (imagem da cena) aparece logo; o 3D entra por cima quando estiver pronto.
- **Cookies:** banner pequeno, «Recusar» tão visível como «Aceitar».

## 6. Verificar antes de dizer que está feito

- Screenshots no PC (1440×860) e no telemóvel (393×852) em 4 pontos do scroll: `scripts/galeria.py` (no team-agent) tira
  uma com GPU; a `site-scroll-infinito` tem `scripts/fotos.py` para várias.
- Medir: FPS no PC e no telemóvel, peso total (< 6 MB no primeiro ecrã), tempo até ao primeiro ecrã.
- Comparar lado a lado com a referência da Galeria: o golpe escolhido tem de se ver em 3 segundos.

## Juntar um site à Galeria

Quando alguém manda um site bom (ou o Claude encontra um), ele fica na Galeria para a equipa:

1. `python scripts/galeria.py <id> <url> --wait 14` no team-agent grava `frontend/hub/galeria/<id>.jpg`. Se o site tem uma
   porta de entrada: `--click 720,430` (o meio do ecrã) ou `--click "text=Begin"`; cookies: clicar sempre em recusar
   (`--click "text=Reject"`). Ver a imagem: se saiu preta ou só com o «a carregar», repetir com `--wait 30`.
2. Juntar o site ao `frontend/hub/galeria/sites.json`: `id`, `nome`, `url`, `de` (estúdio), `tipo` (`produto`, `historia`,
   `estudio`, `jogo`), `quem` (`marco` se foi ele que mandou, `claude` se foi sugestão), `golpe` (uma frase), `roubar` (três
   coisas concretas), `stack` (o que se vê no código da página: `curl` e procurar three, gsap, lenis, next, astro, webflow…)
   e `skill`.
3. Subir o `?v=hubN` no `frontend/index.html`, commit e push.
