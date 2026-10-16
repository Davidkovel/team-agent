# STARTER — site de consultor imobiliário

Um site de UMA página que já funciona, montado com o shell e as secções do kit.
Serve para duas coisas: provar que o kit funciona, e ser o ponto de partida de um
site novo.

Sem npm, sem build, sem CDN além das Google Fonts. HTML + CSS + JS vanilla.

```
starter/
├── index.html            home: fundo gbars, navbar, hero, ponte, cartão de imóvel, prova, rodapé
├── credito.html          simulador de crédito habitação, a funcionar
├── content.json          CONTRATO: todos os factos do site num só sítio
├── README.md             este ficheiro
└── assets/
    ├── shell.css         tokens, reset, botões, fundo, navbar, rodapé, reveals, a11y
    ├── shell.js          barras do fundo, menu, submenus, i18n, seletor de idioma, reveals
    ├── content.js        lê o content.json e reescreve o HTML e o dicionário do rodapé
    └── calculators.js    aritmética dos simuladores (zero DOM, testável em Node)
```

---

## Como correr

Tem de ser servido por HTTP. Em `file://` o `fetch` do `content.json` não passa
(a página continua a abrir, mas fica com os valores escritos à mão no HTML).

```bash
cd starter
python3 -m http.server 8777
# depois: http://localhost:8777/
```

Para parar: `Ctrl+C`.

---

## O que trocar primeiro, e por que ordem

### 1. `content.json` — os factos

É o contrato. Nome, função, cidade, telefone, WhatsApp, Instagram, agência, AMI,
domínio, textos das secções e os dados do imóvel vivem **só aqui**. O
`assets/content.js` lê o ficheiro e reescreve tudo o que estiver marcado com
`data-c`, `data-c-href` e `data-c-tel`, mais as strings do rodapé no dicionário
do shell.

Os mesmos valores estão também escritos à mão dentro do HTML. Não é descuido: é
o que se vê sem JS ou com o `fetch` a falhar. Depois de mexer no `content.json`,
correr uma vez pelos dois HTML e alinhar o texto estático (é uma busca e
substituição, os valores de exemplo são únicos: `Nome do Consultor`,
`Nome da Agência`, `Cidade`, `AMI 0000`, `wa.me/351000000000`,
`instagram.com/exemplo`, `+351000000000`, `exemplo.pt`, `© 2026`).

### 2. As imagens

O starter não traz ficheiros de imagem — traz **blocos de cor** no lugar deles,
já com a máscara, o véu e a caixa certos, para o layout não mudar quando entrar
a foto real. Trocar:

| Onde | Bloco actual | Substituir por |
|---|---|---|
| Hero | `.hero__block` | `<picture>` com o retrato recortado (PNG/WebP com alpha), `fetchpriority="high"` — é o LCP da página |
| Imóvel | `.pv-ph` | `<picture>` com a foto da sala, `loading="lazy"` + `fetchpriority="low"` |
| Rodapé | caixa de vidro com o nome da agência | `<img class="ft__logoimg" src="assets/logo-white.png" width="727" height="385">` com os width/height REAIS |
| Favicons | SVG embutido no `<head>` | `assets/favicon.svg`, `favicon-32.png`, `favicon-192.png`, `apple-touch-icon.png` |
| OG image | `https://exemplo.pt/assets/og-image.jpg` | gerar com `../skills/realtor-landing/assets/og-card.html` e apontar para o domínio real |

`width`/`height` intrínsecos são obrigatórios em todas as imagens: sem eles há CLS.
Ao pôr o retrato do hero, medir primeiro em que percentagem da caixa está a cabeça
e ajustar o `padding-top` até o título começar abaixo do queixo.

### 3. A assinatura visual

Cada cliente novo **troca o par tipográfico e a paleta** — é a única coisa que
muda de propósito entre sites do género. Um site novo com o mesmo par de um
anterior lê-se como um template.

- Cores: `:root` no topo de `assets/shell.css`. `--bg` é a cor de fundo que
  fica **por trás** das barras (o fundo do `<html>`, hoje `rgb(10,10,10)`),
  senão vê-se a costura nas margens. Não é o `GBARS.gradientFrom` do
  `shell.js` — esse é a cor **das barras** (hoje o azul `rgb(28,100,242)`) e
  igualá-lo ao `--bg` pinta o site inteiro de azul.
- Fontes: o `<link>` da Google Fonts no `<head>` das duas páginas **e** os tokens
  `--display` / `--sans` no `shell.css`. Só os pesos que a página usa.
- Acento **único**: uma cor de marca e mais nenhuma. `--accent` e `--accent-2`
  não são duas cores, são a mesma em dois níveis — a escolha entre elas é de
  contraste, não de gosto (`--accent-2` onde o texto assenta por cima do fundo
  animado).

### 4. As páginas que faltam

O starter tem duas páginas. O núcleo canónico do género tem oito
(`index`, `sobre`, `vender`, `imovel`, `credito`, `mais-valias`, `imt`,
`privacidade`). Enquanto não existirem, os links do menu apontam para âncoras
desta página — cada um tem um comentário `STARTER:` a dizer o que trocar.

Ordem sugerida: `imovel.html` (a ficha, é onde o cartão da home vai dar) →
`vender.html` → `imt.html` e `mais-valias.html` → `sobre.html` →
`privacidade.html`. As receitas estão em
`../skills/realtor-landing/references/sections.md` e `calculators.md`.

Ao criar cada página: copiar o `<head>`, a navbar e o rodapé de uma existente,
trocar o `aria-current="page"`, e registar a página nos **dois** menus (barra e
gaveta mobile) de **todas** as páginas.

### 5. Traduções

O dicionário do shell (`Shell.I18N`) já traz PT/EN/FR para a navegação e o
rodapé. O texto das secções está em PT no HTML; o padrão para o traduzir está
demonstrado no fim do `index.html` — estende-se `Shell.I18N.pt/en/fr` e marca-se
o HTML com `data-i18n`. As traduções EN/FR de um site real **têm de ser revistas
por um humano**: nomes de agência e designações legais (AMI, IMT, mais-valias)
não sobrevivem a uma tradução automática.

**O selector de idioma só traduz o que tem `data-i18n`.** Por isso o
`Shell.applyLang` **não** mexe no `lang` do `<html>` enquanto a página não se
declarar totalmente traduzida: põe-se o atributo `data-i18n-complete` no
`<html>` quando tudo estiver traduzido, e só aí o `lang` passa a acompanhar o
idioma escolhido. Sem isso, um `lang="en"` numa página com o hero em português
faz o leitor de ecrã ler português com fonética inglesa.

**Quando um elemento tem `data-c` e `data-i18n` ao mesmo tempo** (os botões do
hero, por exemplo), manda o `content.js`: o `content.json` escreve o texto de
base, em português. O `data-i18n` só entra quando o utilizador troca de idioma —
a partir daí manda o dicionário. Traduzir um botão é, portanto, editar o
`content.json` (PT) **e** a chave `pg.*` nos dicionários EN/FR.

---

## Regras deste género que não se mexem

- **Nunca `href="tel:"` num CTA de navegação.** Em macOS abre o FaceTime e o
  utilizador leva com um diálogo que não pediu. O único `tel:` aceitável é o
  ícone de telefone do rodapé, onde ligar é o que se espera.
- **"Imóveis" não navega**: é um botão que desce o submenu.
- **O `body` é transparente.** O fundo vive no `<html>`; um fundo no body pinta
  por cima da camada de barras (z-index negativo) e apaga-as.
- **O véu do hero tem de chegar a zero no fim da secção**, senão lê-se um risco
  horizontal na fronteira.
- **`prefers-reduced-motion` é obrigatório** em tudo o que se mexe, e o estado
  parado é o **final** da animação, nunca o inicial (senão fica conteúdo
  invisível).
- **Nada de números fiscais inventados** nos simuladores. O que caduca por
  Portaria pergunta-se ao utilizador; o que não se sabe calcular diz-se ("fale
  comigo") em vez de sair um número errado.

---

## Verificar que não se partiu nada

O simulador de crédito tem um valor de validação obrigatório
(`../skills/realtor-landing/references/calculators.md`). Qualquer mexida no
cálculo tem de voltar a dar exactamente estes dois números:

```bash
node -e "var C=require('./assets/calculators.js');
var c=C.simularCredito({valor:450000,entrada:90000,anos:30,tipo:'var',euribor:2.31,spread:1.2});
console.log(c.prestacao.toFixed(2), c.mtic.toFixed(2));"
# esperado: 1618.57 593753.02
```

E, com o servidor a correr, confirmar que nenhuma página pede um ficheiro que
não existe:

```bash
curl -s -o /dev/null -w '%{http_code} index.html\n'   http://localhost:8777/index.html
curl -s -o /dev/null -w '%{http_code} credito.html\n' http://localhost:8777/credito.html
for f in assets/shell.css assets/shell.js assets/content.js assets/calculators.js content.json; do
  curl -s -o /dev/null -w "%{http_code} $f\n" "http://localhost:8777/$f"
done
```

Tudo tem de dar `200`.
