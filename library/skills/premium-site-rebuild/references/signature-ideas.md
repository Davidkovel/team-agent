# A ideia-assinatura

No De Antonio a assinatura é **a travessia**: o produto (o iate visto de cima) é o fio condutor
da página, liga as secções e acaba no ponto de contacto (o porto de Barcelona no mapa). Funciona
porque é literal para o negócio (barcos navegam), porque reage ao gesto da pessoa (o scroll é o
leme) e porque acaba onde a empresa quer que a pessoa acabe (o dealer, o pedido).

## Como encontrar a do cliente

1. Qual é o **objecto** que resume a empresa? (o produto, a ferramenta, o símbolo da marca)
2. Qual é o **percurso** que o cliente faz com ela? (da dúvida à decisão, do anonimato à
   referência, do problema ao resultado)
3. Onde acaba a página? (o contacto, o diagnóstico, a reserva) — a assinatura tem de lá chegar.
4. Consegue-se fazer só com `transform`/`opacity`/`clip-path`/canvas, a 60 fps no telemóvel?
5. Com reduced motion, a ideia continua a ler-se parada?

Uma assinatura por site. O resto do movimento é discreto e serve a leitura.

## Exemplos de transposição

| Negócio | Objecto / percurso | Assinatura |
|---|---|---|
| Iates (De Antonio) | o iate, a navegação | o iate desce pela página e atraca no mapa |
| Agência de marketing + IA de luxo | um sinal/luz que se torna marca; dois departamentos que se juntam | uma linha de luz que o scroll desenha, liga as secções e acaba a assinar o nome do cliente; as duas metades (marketing / IA) aproximam-se até serem uma |
| Relojoaria | o movimento, as horas | os ponteiros andam com o scroll; cada secção é uma hora do dia; o mostrador explode em peças (raio X) |
| Hotel | o dia de um hóspede | a luz da página muda do amanhecer à noite com o scroll; o quarto abre como uma porta |
| Automóveis | a estrada, a velocidade | a estrada desenha-se e o carro (vista de cima) segue-a; conta-rotações que lê a velocidade do scroll |
| Joalharia | a pedra, a luz | a pedra roda em 3D e a refracção muda com o scroll; cada facet abre uma colecção |
| Imobiliário de luxo | a planta, a chave | a planta desenha-se em traço e as divisões enchem-se de fotografia |
| Advocacia / finanças | o documento, a assinatura | uma assinatura que se escreve ao longo da página; selos que se gravam |
| Restaurante | o prato, o fogo | os ingredientes caem e compõem o prato; a chama dá a cor da secção |
| Arquitectura | a linha, o volume | o desenho técnico vira fotografia por janelas que abrem |

## Técnicas que servem várias assinaturas

- **Objecto que segue uma rota SVG** pela página (o motor da travessia: rota construída a partir
  de faixas `data-via` por secção, tabela de pontos, posição por scroll suavizado, rotação pela
  tangente). Ver `motion-engine.md` › Rota.
- **Traço que se desenha** com o scroll (`stroke-dasharray`/`dashoffset`, ou uma janela que só
  muda `transform` quando a rota é monótona).
- **Raio X** (duas camadas e uma linha `clip-path` que o scroll leva e que se pode arrastar).
- **Janela que abre** (`clip-path: inset()` animado por `--j`).
- **Escala honesta** (todas as peças à mesma escala, com régua).
- **Mapa com rotas** que acendem a partir da sede.
- **Formulário-viagem** em passos sobre a mesma rota, com uma "placa" que regista as escolhas.
- **Visor 3D** (three.js local) para o produto, carregado só com o scroll parado perto.
