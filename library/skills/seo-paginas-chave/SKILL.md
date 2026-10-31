---
name: seo-paginas-chave
description: Encontra de graça pesquisas longas do Google que ninguém responde bem e faz uma página do site para cada uma (o método «keyword research for free» do BHW, aplicado no site Lingvo a 31.10.2026). Usar em "SEO", "páginas para o Google", "tráfego grátis do Google", "palavras-chave", "keyword research", "подобрать ключевые запросы", "страницы под запросы", "SEO для сайта", "чтобы сайт находили в Google", "как он говорил в гайде про ключевые слова".
---

# SEO: uma página por pesquisa

Ideia: pesquisas longas e concretas («police certificate translation for ircc») têm poucos concorrentes. Uma página feita exatamente para essa pesquisa sobe à 1.ª página do Google em semanas, sem pagar anúncios.

## 1. Juntar as pesquisas (grátis, 2 min)
Corre `sugestoes.js` (ao lado deste ficheiro) com as sementes do negócio. Ele usa as sugestões do Google (autocomplete) com sufixos " a", " f", " u", " c" e guarda só pesquisas com 4+ palavras.
- Sementes = serviço + «for», «of», «near me», «cost», nome da entidade (USCIS, IRCC, UK visa, embaixada…).
- Para outro país/língua muda `hl`/`gl` no topo do script.
```
node sugestoes.js "certified translation for" "marriage certificate translation" > pesquisas.txt
```

## 2. Tirar o que já existe
Compara com os `<title>` das páginas do site. Fica só o que ainda não tem página.

## 3. Ver a concorrência (o passo que decide)
Abre cada pesquisa no Google (no Edge do PC com CDP: `grab.py`, ver abaixo) e lê os 8 primeiros títulos.
- **Fraca** (boa): Reddit/fóruns no topo, sites que respondem a outra pergunta, páginas genéricas.
- **Forte** (saltar): o tema inteiro ocupado por sites grandes que respondem exatamente àquilo (ex.: «certified translation for uscis»).
- Volume: Ahrefs Keyword Generator grátis só serve para ver se há procura; o número real costuma ser 2–3× maior.

## 4. Fazer as páginas
- Uma página = uma pesquisa. Título = a pesquisa quase palavra por palavra + marca.
- Copiar uma página de serviço do próprio site como molde (mesmo design), trocar: `<title>`, description, canonical, og, JSON-LD (FAQPage + Service + BreadcrumbList), H1, texto.
- Conteúdo: para quem é (a entidade), 3 erros que fazem o pedido voltar, 3 passos, preço, 4 perguntas reais. Factos de requisitos só verdadeiros (ex.: USCIS = tradução completa + declaração do tradutor; UKVI = confirmação de exatidão, data, nome, assinatura, contactos).
- Não prometer o que não fazemos (ex.: não fazer página de «sworn translation Spain» sem tradutor jurado espanhol).
- Ligar as páginas novas no rodapé de todas as páginas + `sitemap.xml`.
- Gerar por script, para repetir: modelo em `C:\Users\David\glossa\_seo_pages.py` (lista PAGES → páginas, rodapé e sitemap; corre outra vez sem duplicar).

## 5. Publicar e pedir indexação
- Commit + push (GitHub Pages).
- Ele (não nós — precisa do login) em Search Console: barra de cima «Проверить любой URL / Inspecionar URL» → colar URL → «Запросить индексирование / Solicitar indexação», uma vez por página. Em «Sitemaps» reenviar `sitemap.xml`.

## 6. Depois de 3–4 semanas
Search Console → Desempenho: pesquisas com muitas impressões e sem página própria → nova volta deste método.

## Ferramentas no PC
- Edge com CDP (passa o Cloudflare do BHW e o Google): `msedge.exe --remote-debugging-port=9333 --user-data-dir=%TEMP%\edge-cdp`, depois `grab.py URL saída.txt "js"` (cópia em `grab.py` ao lado deste ficheiro).
- Google: títulos dos resultados com js `[...document.querySelectorAll('#search a h3')].slice(0,8).map(h=>h.innerText).join('\n')`.
