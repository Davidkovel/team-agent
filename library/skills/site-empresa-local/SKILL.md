---
name: site-empresa-local
description: Faz um site premium para um negócio local ou PME portuguesa (escolas de condução, clínicas, construção, energia, serviços): perguntas ao cliente, conteúdo, páginas, design, componentes, SEO, formulário sem backend, deploy. Método Blue Magnitude.
---

# Site para um negócio local ou PME (método Blue Magnitude)

## O que é

Um método para entregar, a uma empresa pequena portuguesa, um site que parece de uma empresa muito maior.
Vem de dois sites do Tomás (tomas476, parceiro da equipa, que autorizou o uso):

- **Blue Magnitude** (`tomas476/bluemagnitude`): instalações fotovoltaicas em Leiria. Next.js 16 + React 19 + Tailwind 4, exportado como site estático. Código completo, 10 rondas de revisão no iPhone. É a fonte principal.
- **Detalhes Cautelosos** (`tomas476/detalhes-cautelosos`): construtora em Rio Maior. Só existe o build (HTML + JS compilado + CSS). Serve para o mapa de páginas, a página de orçamento e o estilo.

O que dá qualidade não são efeitos. São estas coisas:

- **Só conteúdo verdadeiro.** Facto que o cliente não confirmou não vai para o ecrã. Vai para a lista de perguntas.
- **Um sistema, não um tema.** Cores com nome, uma família de letra, escala fluida, uma curva, poucas durações. Tudo vem de `:root`/`@theme`.
- **Um caminho claro para o contacto.** Um botão ("Pedir proposta" ou "Pedir orçamento") em todas as páginas, que leva a um formulário em passos, que acaba numa conversa de WhatsApp ou num email já escrito.
- **Telemóvel primeiro.** O cliente final abre o site no iPhone. Testa-se a 390 px antes de 1440 px.
- **Movimento curto e que nunca esconde conteúdo.** Entradas de 420 ms, `prefers-reduced-motion` respeitado.

## Regras de qualidade (não negociáveis)

1. **Zero factos inventados.** Nada de NIF, anos, equipa, números, testemunhos ou certificações que o cliente não deu. O que falta fica numa lista (`references/perguntas-ao-cliente.md`), nunca no ecrã. Se uma obra/projeto não tem local e ano, não entra.
2. **O logótipo é do cliente.** Usa os ficheiros dele recortados. Nunca o redesenhes nem o recomponhas noutra letra.
3. **Cor medida, não à vista.** Tira as cores do logótipo. Mede o contraste: a cor da marca pode não servir para texto (o verde `#84C885` sobre claro dá 1,9:1; o oliva `#50752A` sobre o verde `#205532` dá 1,63:1). Cria uma variante de texto (`--color-accent-ink`, `--dc-oliva-claro`).
4. **Uma família de letra, escala em `clamp()`** sem breakpoints de tamanho. Texto de formulário a 16 px (abaixo disso o iOS faz zoom).
5. **Uma curva para o que entra, outra para o que desliza.** Blue Magnitude: `--ease-land: cubic-bezier(0.16, 1, 0.3, 1)` e `--ease-glide: cubic-bezier(0.32, 0.72, 0, 1)`.
6. **Só `transform` e `opacity` animam.** Nunca a altura de um `<details>`; anima-se o conteúdo.
7. **Entradas ao scroll sem esconder o rodapé.** `IntersectionObserver` com `threshold: 0` e **nenhum `rootMargin` negativo** (o azarado é sempre o rodapé, onde estão os contactos). Dois `requestAnimationFrame` encadeados antes de marcar como visível.
8. **`prefers-reduced-motion` no fim do CSS**, e toda a animação em ciclo leva uma regra que repõe o estado final (senão fica invisível).
9. **Sem backend.** O formulário abre `wa.me/<número>?text=...` ou `mailto:` já escrito, com ecrã de sucesso, link de recurso e botão de copiar. Escreve no ecrã "Nada fica guardado neste site". Sem recolha de dados, sem caixa de consentimento.
10. **Nunca `tel:` num botão de navegação.** Em macOS abre o FaceTime. `tel:` só em linhas que digam "Ligar".
11. **O documento acaba no rodapé.** `html { overflow-x: clip; overscroll-behavior-y: none }` e `body { overflow-x: clip }`. `clip`, nunca `hidden` (o `hidden` cria contexto de scroll e parte o `sticky`).
12. **Texto sem travessões a meio de frase** nos sites do Tomás (regra da casa dele). Confirma com o cliente/o Marco antes de mudar.
13. **Português de Portugal**, tratamento por "tu" no Blue Magnitude e por "você" no Detalhes Cautelosos. Pergunta qual ao cliente.
14. **Obrigatórios por lei no rodapé**: NIF/NIPC, nome legal, morada, link do livro de reclamações eletrónico (`livroreclamacoes.pt`), política de privacidade. Alvará/licença quando o setor o exige.
15. **Enquanto for proposta**: `<meta name="robots" content="noindex, nofollow">` e `robots.txt` com `Disallow: /` (é o que o Detalhes Cautelosos faz). Tira-se na publicação oficial.

## Método, passo a passo

### 1. Perguntas ao cliente
Lê `references/perguntas-ao-cliente.md`. Antes de desenhar, tem a lista do que é obrigatório (NIF, nome legal, livro de reclamações), da prova (números, equipa, testemunhos, certificações) e das confirmações rápidas (horário, WhatsApp, morada). Se já existir site antigo, faz a auditoria dele: todo o texto sai de lá, e os defeitos dele (texto de tema, secções vazias, links que não levam a lado nenhum) entram na lista de erros corrigidos.

### 2. Conteúdo
Tudo o que é do cliente vive num só ficheiro tipado, `src/content/site.ts` (ver `assets/bluemagnitude/src/content/site.ts`): `EMPRESA`, `HERO`, `QUEM_SOMOS`, `SERVICOS`, `PROJETOS`, `PROCESSO`, `PERGUNTAS`, `CONTACTO`, `PRIVACIDADE`, `SOBRE`. Nenhum componente escreve texto de marca, números ou contactos. Realces com `**duas estrelas**` no texto (componente `texto-realcado.tsx`), nunca HTML dentro do conteúdo. Cuidado ao editar o ficheiro por script: cortar por `index()` de uma string que aparece em dois blocos apaga o que está pelo meio.

### 3. Estrutura de páginas
Lê `references/anatomia-bluemagnitude.md` (mapa de páginas e componentes) e `references/caso-detalhes-cautelosos.md` (outro mapa, para uma empresa de obras). Base para quase qualquer PME:

`/` · `/sobre/` · `/servicos/` + `/servicos/<slug>/` · `/projetos/` (ou obras/casos) + `/projetos/<slug>/` · `/contacto/` · `/privacidade/` · 404 · `robots.txt` · `sitemap.xml`.

Home por ordem: hero → quem somos → prova (reels/obras) → serviços → projetos → processo → perguntas → CTA e rodapé. O formulário vive em `/contacto/`, não na home. Escolhe do que o negócio tem; corta o que repete.

### 4. Design
Lê `references/sistema-design.md` e abre `assets/bluemagnitude/src/app/globals.css` (tokens e componentes de CSS) e `assets/detalhes-cautelosos/` (`estilo.css`, `tipo.css`, `marca/dc-cores.css`). Decide: paleta tirada do logótipo (marca, acento, tinta, fundo nunca branco puro), letra, superfícies (`field-shell`, `field-plate`, `field-deep`), raios, ritmo (`--s-xs` a `--s-xl`).

### 5. Construção
Cria o projeto como `package.json` e `next.config.ts` de `assets/bluemagnitude/` (Next com `output: "export"`, `trailingSlash: true`, `images.unoptimized`). Copia e adapta os componentes de `assets/bluemagnitude/src/components/`:

| Preciso de | Ficheiro |
|---|---|
| entradas ao scroll | `reveal.tsx` |
| navbar que pousa, submenu, folha mobile | `site-nav.tsx` |
| rodapé curto com CTA | `site-footer.tsx` |
| formulário em 3 passos com WhatsApp | `contacto-form.tsx` |
| perguntas frequentes | `ui/acordeao.tsx` |
| cabeçalho de secção | `ui/cabecalho-seccao.tsx` |
| luz de fundo depois do hero | `ui/campo-luz.tsx` |
| molde de página interior | `ui/pagina.tsx` |
| realce de palavras | `ui/texto-realcado.tsx` |
| título escrito à máquina | `ui/titulo-teclado.tsx` |
| processo em passos | `ui/passos.tsx` |
| lista com gota de luz | `ui/lista-luz.tsx` |
| hero com vídeo robusto no iPhone | `hero/hero.tsx`, `hero/video-backdrop.tsx` |
| caminhos com prefixo (GitHub Pages) | `lib/caminho.ts`, `scripts/prefixar.mjs` |
| página de serviço dinâmica | `src/app/servicos/slug/page.tsx` (no projeto real a pasta chama-se `[slug]`) |

Os componentes têm comentários com as armadilhas. Lê-os antes de os mudar.

### 6. SEO
Em `layout.tsx` (ver `assets/bluemagnitude/src/app/layout.tsx`): `metadataBase`, `title.template` (`%s · Nome`), `description`, Open Graph com `images` de **1200x630 e `type`**, `twitter.card: summary_large_image`, `lang="pt-PT"`, `locale: "pt_PT"`, ícones. Por página: `generateMetadata` com título e descrição próprios. `robots.ts` e `sitemap.ts` estáticos (`dynamic = "force-static"`). Adiciona JSON-LD `LocalBusiness` com dados reais (os repositórios do Tomás não o têm; é um acrescento recomendado, com os dados do `EMPRESA`). O nome do ficheiro do cartão é a versão dele (`og-nome-v2.jpg` quando muda).

### 7. Deploy
Lê `references/deploy.md`. Primeiro GitHub Pages (workflow em `assets/bluemagnitude/deploy/pages.yml`), para o cliente ver num link. Depois, se for preciso domínio próprio, Docker + Caddy (`deploy/Dockerfile`, `deploy/bluemagnitude.Caddyfile`). DNS primeiro, vhost depois.

### 8. Verificação antes de dizer "feito"
- Ver a 390 px e 1440 px (iframe do tamanho pedido ou Chrome headless). O Chrome headless sozinho não chega para um hero de `100svh`.
- Consola sem erros; links todos a funcionar no Pages (com o prefixo da subpasta).
- Reduced motion ligado: tudo visível.
- Contraste medido nos textos pequenos.
- Cartão de partilha: abre o link no WhatsApp e confirma que sai com imagem.
- Lista do que falta ao cliente entregue.

## Quero X, leio Y

| Quero | Leio |
|---|---|
| saber o que perguntar ao cliente | `references/perguntas-ao-cliente.md` |
| ver páginas e componentes do Blue Magnitude | `references/anatomia-bluemagnitude.md` |
| cores, letra, espaço, raios, animações com valores | `references/sistema-design.md` |
| decisões, armadilhas e como o Tomás revê | `references/processo-e-contexto.md` |
| um site de obras: mapa, orçamento em 3 passos, estilo | `references/caso-detalhes-cautelosos.md` |
| publicar (Pages, Docker, Caddy, DNS) | `references/deploy.md` |
| código verdadeiro de um componente | `assets/bluemagnitude/src/...` |
| CSS de um site sem build (Vite) | `assets/detalhes-cautelosos/` |

## Checklist de entrega

- [ ] Lista de perguntas enviada; o que falta não está no ecrã.
- [ ] `site.ts` único com todo o conteúdo; nenhum componente com texto de marca.
- [ ] Paleta do logótipo com contrastes medidos; variante de texto onde a cor da marca falha.
- [ ] Um botão de contacto em todas as páginas; formulário em passos sem backend.
- [ ] Hero com poster e vídeo que não mostra o botão de play do iOS.
- [ ] Testado a 390 px e 1440 px; `overflow-x: clip` no `html` e no `body`.
- [ ] Reduced motion testado.
- [ ] Open Graph 1200x630, `generateMetadata` por página, `sitemap.xml`, `robots.txt`.
- [ ] Rodapé com NIF, nome legal, morada, livro de reclamações, privacidade.
- [ ] Publicado no Pages; links testados; (opcional) domínio próprio.
- [ ] `noindex` enquanto for proposta.
