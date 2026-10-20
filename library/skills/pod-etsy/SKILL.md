---
name: pod-etsy
description: Loja de print-on-demand na Etsy feita pelos agentes (Fábrica Etsy do Hub). Usar quando o pedido é vender t-shirts, sweatshirts, canecas ou sacos com estampas na Etsy/Printify, encontrar nichos que vendem, desenhar estampas, escrever títulos e tags da Etsy, ou pôr os agentes a "farmar" dinheiro com print-on-demand.
---

# pod-etsy — print-on-demand na Etsy

Tirada a 20 out 2026 de um reel (androo.agi, «AI Ecosystem Tour»): agentes que correm três lojas Etsy de
print-on-demand e dizem ter feito ~16 000 $ em dois meses. O método dele é «copiar o que vende e mudar um bocadinho».
**Nós não copiamos desenhos** (a Etsy fecha a loja por isso): tiramos o tema, a frase-tipo e o público que vendem e
fazemos um desenho nosso.

## A linha de montagem (Hub › Fábrica Etsy, `#/etsy`, `backend/app/etsy.py`)

| Agente | Passo | Sai |
|---|---|---|
| **Riddler** (pesquisa) | Pesquisa na web o que vende agora e nas próximas 3–6 semanas (a Etsy dá 403 a pedidos de fora: usa listas de best-sellers, eRank/EverBee, Pinterest, datas) | `nicho`, `frase`, `publico`, `porque` (a prova), `produto`, `cor_peca`, `estilo`, `fontes` |
| **Catwoman** (design) | Desenha a estampa em SVG: tipografia + formas simples, fundo transparente, fontes do sistema | `design.svg` → PNG 4500 × 5400 pelo Chrome sem janela |
| **Joker** (marketing) | Título ≤ 140 caracteres, 13 tags ≤ 20, descrição com o aviso de IA, preço com margem | `titulo`, `tags`, `descricao`, `preco`, `printify` |
| **Alfred** (revisão) | Código, não IA: barra marcas/personagens/celebridades (`BLOCKED`) e anúncios incompletos | `blocked` com o motivo |

A pessoa aprova na página, faz o produto na Printify (PNG + textos copiados por botões), marca «Já está na Etsy» e
**regista cada venda**. O contador de dinheiro é só o que foi registado: nunca números inventados.

## Regras que não se quebram

1. **Nada de marcas de terceiros**: Disney, Taylor Swift, Stanley, equipas da NFL, Grinch, séries, letras de músicas…
   Se o nicho só vende com a marca, não é nicho para nós.
2. **Nada copiado**: frase e desenho nossos. A ideia (tema, público, ocasião) pode vir de quem vende.
3. **Declarar a IA**: a Etsy pede que se diga que o desenho foi feito com ferramentas de IA (vai na descrição).
4. **Margem real**: preço = custo Printify + ~6,5 % (transacção) + ~3 % + 0,25 € (pagamento) + 0,20 $ (anúncio) + ≥ 8 €.
5. **Nichos estreitos batem nichos largos**: «enfermeira de UCI que faz crochet» vende, «funny shirt» não.
6. **Nada é publicado sozinho** até a loja estar ligada pela API da Etsy e a pessoa o pedir.

## Correr à mão

```bash
# no Hub: Fábrica Etsy › «Fazer um lote agora», ou:
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/etsy/run
```

O interruptor «Ligar todos os dias» faz um lote por dia à hora marcada, **no PC onde está ligado** (gasta o plano
Claude desse PC; ~3 chamadas por desenho). Os ficheiros ficam em `~/.team-agent/etsy/<id>/`.

## O que falta (por ordem)

1. Loja Etsy + conta Printify (em nome da pessoa, com cartão e IBAN: não é coisa que um agente faça).
2. App na Etsy Open API v3 → vendas e publicação automáticas no contador, em vez de registadas à mão.
3. Maquetas (a estampa em cima da peça) para as fotos do anúncio; a Printify já gera as suas.
4. Fiverr (miniaturas de YouTube): o mesmo padrão, com o pedido do cliente em vez da pesquisa.
