# imogrow-realtor-kit

O sistema por trás dos sites de consultores imobiliários da Imogrow, destilado num kit que
qualquer sessão do Claude Code consegue correr.

Não é um template: é o **método** — o sistema visual, o sistema de movimento, o catálogo de
secções, a matemática dos três simuladores, e a receita da pré-visualização de link — extraído
de dois sites reais já entregues e reescrito genérico, sem dados de nenhum cliente lá dentro.

Tudo é HTML + CSS + JavaScript vanilla. **Sem build, sem npm, sem framework.** Uma pasta que se
serve por HTTP e está no ar.

---

## O que está aqui

```
imogrow-realtor-kit/
├── skills/realtor-landing/    a skill: SKILL.md + 6 referências + snippets prontos
├── agents/                    o agente que executa, e os prompts para o correr
└── starter/                   um site de arranque que já funciona
```

### `skills/realtor-landing/`

A skill. `SKILL.md` é o mapa — regras não negociáveis, o workflow em 8 fases, a tabela
"quero X, leio Y" e a checklist de entrega. O detalhe vive nas referências:

| Ficheiro | O que resolve |
|---|---|
| `references/design-system.md` | tokens, acento único, tipografia, receita do vidro, botões, raios, variante clara |
| `references/motion.md` | **o ficheiro da smoothness** — fundo animado, reveals, entrada do hero, navbar, sheen, desenho SVG, carrossel em leque, tabela de durações, reduced-motion, 11 armadilhas |
| `references/sections.md` | mapa de páginas e catálogo de secções, formulários sem backend, ordem e ritmo |
| `references/calculators.md` | crédito habitação, IMT + Selo, mais-valias: fórmulas, escalões, valores de validação |
| `references/link-preview.md` | o cartão que aparece no WhatsApp, o `<head>` completo, as três regras que partem a partilha |
| `references/shell.md` | o esqueleto partilhado por todas as páginas, i18n PT/EN/FR, acessibilidade |

E o código pronto a colar: `assets/shell/` (head, navbar, footer, CSS e JS partilhados),
`assets/calculators.js` (cálculo puro, testável em Node), `assets/og-card.html` e
`scripts/render-og.py`.

### `agents/`

- `realtor-site-builder.md` — a definição do subagente. Invoca a skill, trabalha a partir de um
  `content.json` único, nunca inventa factos do cliente, entrega com a checklist preenchida.
- `PROMPTS.md` — os prompts prontos a copiar: arrancar um site novo para um consultor ou para
  uma agência, acrescentar uma secção, acrescentar um quarto simulador, refazer o cartão de
  partilha, trocar a paleta mantendo o movimento, auditar, fazer deploy.

### `starter/`

Um site de arranque que **já funciona**: fundo animado, navbar com submenus e menu mobile, hero,
ponte com o desenho SVG em ciclo, cartão de imóvel, bloco de prova, footer, e o simulador de
crédito a dar os valores certos. Todos os factos vivem em `content.json`.

```bash
cd starter && python3 -m http.server 8777
# http://localhost:8777
```

---

## Instalar

```bash
git clone git@github.com:tomas476/imogrow-realtor-kit.git
cd imogrow-realtor-kit

# a skill e o agente, disponíveis em todas as sessões
mkdir -p ~/.claude/skills ~/.claude/agents
cp -R skills/realtor-landing ~/.claude/skills/
cp agents/realtor-site-builder.md ~/.claude/agents/
```

Para os manter ligados ao repositório (recebem as actualizações com um `git pull`), usa links
simbólicos em vez de cópias:

```bash
ln -s "$PWD/skills/realtor-landing" ~/.claude/skills/realtor-landing
ln -s "$PWD/agents/realtor-site-builder.md" ~/.claude/agents/realtor-site-builder.md
```

Confirma com `/skills` e `/agents` numa sessão nova.

---

## Como se usa

Duas vias, e a diferença importa:

**Invocar a skill** — ficas tu ao comando e a skill entra como método. É o certo para trabalho
incremental: uma secção nova, uma paleta trocada, um bug de scroll.

```
Usa a skill realtor-landing para acrescentar uma secção de testemunhos ao site em ~/sites/<cliente>.
```

**Despachar o agente** — passas a tarefa inteira a um subagente que trabalha sozinho até entregar.
É o certo para um site de raiz.

```
Despacha o agente realtor-site-builder para construir o site de <nome>, consultor na <agência>
em <cidade>. Os factos estão em <caminho>/briefing.md.
```

`agents/PROMPTS.md` tem os prompts completos, com o formulário de briefing incluído.

---

## As regras que não se negoceiam

Estão todas em `SKILL.md`, mas as que mais custaram a aprender:

1. **Zero traços decorativos.** Sem barrinhas junto a kickers, sem réguas atrás de logótipos, sem
   barras de acento ao lado de números. O kicker é texto e mais nada.
2. **Um só acento** e **um só easing** (`cubic-bezier(.4,0,.2,1)`). Misturar easings é o que faz
   um site parecer barato.
3. **Nunca `tel:` num CTA de navegação** — no macOS abre o FaceTime.
4. **Formulários sem backend abrem o WhatsApp** pré-preenchido. É decisão, não atalho: é o canal
   real destes clientes.
5. **Nunca inventar factos.** AMI, NIF, prémios, anos de mercado, imóveis vendidos: ou vêm do
   cliente, ou não entram no site.
6. **`prefers-reduced-motion` em tudo o que se mexe** — e `reduce` significa sem movimento, não
   sem conteúdo.
7. **Cada site novo troca paleta, par tipográfico e um ou dois mecanismos de assinatura.** A
   estrutura e o movimento mantêm-se. Dois sites com o mesmo par tipográfico leem-se como template.

---

## Valores de validação

Os simuladores são o diferencial do género — e são inúteis se estiverem errados. Estes três
números foram batidos contra fontes de referência e **qualquer alteração ao código tem de os
voltar a dar**:

| Simulador | Entrada | Resultado |
|---|---|---|
| Crédito | 450 000 € · entrada 90 000 € · 30 anos · Euribor 2,31 % + spread 1,2 % | prestação **1 618,57 €** · MTIC **593 753,02 €** |
| IMT | habitação própria permanente · 200 000 € · Continente | **3 747,08 €** |
| IMT Jovem | ≤ 35 anos | isenção até **316 772 €**, tecto **633 453 €** |

Mais-valias pede ao utilizador o coeficiente de desvalorização e a taxa marginal de IRS em vez de
embutir tabelas que caducam por Portaria todos os anos. É honestidade deliberada, não uma
funcionalidade por acabar.

---

## A pré-visualização do link

A imagem que aparece quando se envia o link no WhatsApp é tratada como funcionalidade de primeira
classe, não como detalhe de SEO. Três regras, todas aprendidas à custa de um erro real:

1. **`og:image` tem de ser URL absoluta num domínio que resolve agora.** Um site apontou para um
   domínio que nunca chegou a apontar para lado nenhum: o scraper pedia a imagem, levava erro de
   ligação, e a partilha saía sem pré-visualização — sem nada no site a denunciar o problema.
2. **O cartão tem de dizer quem é.** Nome, função e a linha de prova. Só o monograma sobre preto
   não identifica o link.
3. **Os scrapers fazem cache por URL.** Substituir o ficheiro no servidor não chega: muda-se o
   nome (`og-<slug>-v2.jpg`) e os metas, senão o WhatsApp continua a servir a versão antiga.

Receita completa e o renderizador em `references/link-preview.md` + `scripts/render-og.py`.
