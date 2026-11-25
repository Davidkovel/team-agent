# Radar de Anúncios (Anúncios em alta)

Pedido do David, 25 nov 2026: em cada país, achar os anúncios da Meta (Facebook/Instagram) que **começaram há pouco e
continuam no ar há 2+ dias**. Um anúncio que fica no ar está a ser pago, por isso o produto vende.

## Abrir

- No Hub: **03 · Negócios › Anúncios** (`#/anuncios`). «Ligar o radar» arranca o coletor neste PC; ele lê de 6 em 6 horas
  e o Hub volta a ligá-lo se o PC reiniciar. «Ler agora» faz uma volta já (~15 min para os três países).
- À mão, nesta pasta: `python adsradar.py uma` (uma volta), `python adsradar.py top UZ` (tendências no ecrã).

## Como funciona

- Fonte: a Biblioteca de Anúncios pública (`facebook.com/ads/library`), sem login nem chave, num Chrome sem janela
  (Selenium). Cada pesquisa traz a 1.ª página ordenada por impressões (~30 anúncios); sem login a Meta recusa a página
  seguinte («Rate limit exceeded»), por isso há várias pesquisas por país (`config/pesquisas.json`, editáveis na página).
- Cada anúncio guarda: data de arranque, se está ativo, cópias do criativo, lugar nas impressões, página e gostos, site,
  texto, imagem. Tudo em `ads.db` (fora do git).
- **Tendência** = anunciante + site com anúncios ativos que começaram há 2–14 dias (ou 7–30, «Aguenta 7+ dias»).
  Nota 0–100: dias no ar (30) + cópias do criativo (25) + lugar nas impressões (25) + nº de anúncios (10) + nº de pesquisas
  onde aparece (5).
- **Categoria** (Loja, Cripto e investimento, Crédito e banca, Apostas, Cursos, Apps, Beleza, Imobiliário, Auto, Viagens,
  Comida, Emprego e renda, Serviços): palavras em PT/EN/RU/UK/UZ + a categoria da página na Meta.
- **Risco** (Limpo / Atenção / Provável burla), com o porquê: promessa de ganhos, media/famosos como isco num anúncio de
  dinheiro, link para Telegram/WhatsApp ou encurtado, domínio barato (.xyz, .top…), página pequena a falar de dinheiro,
  nome da página ≠ site (cripto/apostas), apostas. Por omissão a página esconde as prováveis burlas.
- Depois de mudar as palavras: `python adsradar.py reclassificar`.
