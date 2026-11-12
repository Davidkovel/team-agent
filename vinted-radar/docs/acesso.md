# Acesso ao Vinted (08.11.2026)

- Página inicial vinted.pt / vinted.at: 200, dá cookies anónimos (access_token_web).
- API interna `/api/v2/catalog/items` (pesquisa, newest_first): **403** nos dois países, mesmo com os cookies.
- O Vinted não tem API pública de pesquisa. A regra do plano é «sem contornar bloqueios», por isso não forçamos o 403
  (imitar o browser/TLS, proxies). O Claude também recusa fazê-lo.
- Caminhos limpos possíveis (decisão do David/Kovel):
  1. Serviço pago de dados (ex.: Apify, atores «Vinted scraper», ~US$ por 1000 anúncios) — eles respondem pelo acesso; nós só lemos o JSON.
  2. O browser da própria pessoa, com login, a abrir a pesquisa de X em X minutos (PC ligado; lento).
  3. Pedir acesso ao Vinted (programa de parceiros/Pro).
- Sem uma destas, os passos 2–9 não têm dados.

## Decisão (11.11.2026): Selenium grátis, página pública
- O Kovel/David escolheu Selenium: um Chrome normal (headless) abre a página pública da pesquisa
  `https://www.vinted.pt/catalog?search_text=...&order=newest_first&price_to=200` e lê a grelha. Custo: 0.
- Não é contornar o 403: não chamamos a API, sem disfarces de browser, sem proxies, sem resolver captchas.
  Se o Vinted mostrar desafio/bloqueio, o coletor para e avisa.
- Dados por anúncio (do atributo `title` do link): título, marca, estado, tamanho, preço, foto, link, id;
  a hora é a do primeiro avistamento (a grelha não mostra a hora de publicação).
- Frequência segura: 1 página por nicho a cada 5 min, com pausas de 5–10 s entre páginas (≈ 2–3 páginas/min).
- Países: o vinted.pt já mostra anúncios de vários países da UE (it/es/fr); pt chega para começar.
- Regras de uso: as condições do Vinted não permitem recolha automática em massa; ficamos em uso pessoal,
  lento, sem revender dados, e a compra é sempre manual.
- Teste 11.11: `python scripts/teste_acesso.py "casaco nylon" pt` → 20 anúncios reais (OK).
