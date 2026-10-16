# Os três simuladores

Isto é o diferencial do género. Um consultor imobiliário com um site bonito tem um site bonito;
um consultor com três simuladores que funcionam tem uma razão para alguém abrir o site sem estar
à procura de um imóvel específico — e para voltar. Nenhum concorrente directo os tem. Quando se
corta orçamento a um site destes, corta-se tudo menos isto.

Cada simulador é uma página autónoma (`credito.html`, `imt.html`, `mais-valias.html`) que partilha
o mesmo layout, o mesmo painel de resultado e o mesmo objecto utilitário `TL`. O cálculo puro
está em [`../assets/calculators.js`](../assets/calculators.js) — sem DOM, testável a partir de Node.

Regra transversal: **não se inventa nenhum número fiscal**. Se um valor caduca por Portaria todos
os anos, pede-se ao utilizador em vez de o embutir. Se uma tabela não está no ficheiro (Regiões
Autónomas), diz-se isso em vez de mostrar um resultado errado. Esta contenção é o que distingue
um simulador que gera contactos de um que gera reclamações.

---

## 1. Crédito habitação

### A fórmula da prestação

Sistema francês, prestação constante (anuidade):

```
M = P · i / (1 − (1 + i)^−n)
```

- `P` — capital financiado = valor do imóvel − entrada (nunca negativo; a entrada é limitada ao
  valor do imóvel)
- `i` — taxa mensal = `TAN / 100 / 12`
- `n` — número de prestações = `anos × 12`

Quando `i = 0` a fórmula rebenta por divisão por zero. Nesse caso usa-se a amortização linear
`P / n`, que é o limite matemático correcto — não é um caso de erro.

### Como se compõe a taxa

Dois modos, escolhidos por botões segmentados:

- **Variável:** `TAN = cotação Euribor + spread`. Os defaults do original são Euribor 2,31 % e
  spread 1,2 %.
- **Fixa:** `TAN = taxa fixa proposta`, tal como o banco a apresenta. Default 3,3 %.

O selector de prazo da Euribor (3 / 6 / 12 meses, default 12) **não entra na conta**. É contexto
para o utilizador: ele escreve a cotação já correspondente ao prazo que escolheu. Vale a pena
manter — quem anda a comparar propostas sabe que a Euribor a 6 e a 12 meses não é a mesma —, mas
não se deve fingir que o simulador faz algo com esse campo.

O aviso ao lado do campo é deliberado e deve sobreviver a qualquer reescrita:
*"A Euribor muda todos os dias. O valor acima é um ponto de partida — substitua-o pela cotação do
dia antes de tirar conclusões."*

### O que entra no MTIC

MTIC = Montante Total Imputado ao Consumidor. Neste simulador:

```
selo_abertura = P × taxaSelo
totalPrest    = M × n
totalJuros    = max(0, totalPrest − P)
MTIC          = totalPrest + selo_abertura + totalJuros × 0,04
```

Escalões do Imposto do Selo de abertura, por prazo (TGIS, verba 17 — utilização de crédito):

| Prazo | Taxa |
|---|---|
| mais de 5 anos | 0,6 % |
| mais de 1 e até 5 anos | 0,5 % |
| até 1 ano | 0,04 % |

Os 4 % sobre os juros são o Imposto do Selo sobre juros (TGIS, verba 17.3). O painel mostra-o duas
vezes com significados diferentes: `isJuros1 = P × i × 0,04` é o selo sobre os juros **do primeiro
mês** (o número que se vê na primeira prestação), enquanto o MTIC leva 4 % sobre **o total** dos
juros de toda a vida do empréstimo.

O painel mostra ainda "Dinheiro necessário no início" = entrada + selo de abertura.

### Seguros e comissões: não existem no original

O simulador **não** calcula comissões do banco, comissão de avaliação, seguro de vida nem seguro
multirriscos, e não inclui o IMT nem o selo da compra. Isso está escrito no disclaimer da página,
não escondido. Não acrescentar campos para estes custos sem uma fonte real de valores — um seguro
de vida inventado é pior do que um seguro de vida ausente. O disclaimer remete explicitamente o
IMT para o simulador de IMT, o que também serve de ligação interna entre ferramentas.

Também não há tabela de amortização (mapa de prestações). Se for pedida, ver a secção final.

### Aviso de idade

`idadeFim = idade do comprador mais velho + anos de prazo`. Se ultrapassar 75, mostra-se um aviso:
a maioria dos bancos exige que o crédito termine até aos 75 anos, o que encurta o prazo possível.
Não bloqueia nada, só avisa.

### VALOR DE VALIDAÇÃO — obrigatório

```
valor do imóvel .... 450 000 €
entrada ............  90 000 €
prazo .............. 30 anos
taxa ............... variável, Euribor 2,31 % + spread 1,2 %  (TAN 3,51 %)

prestação mensal ... 1 618,57 €
MTIC ............... 593 753,02 €
```

Este par de valores foi **batido contra o site de referência do cliente** e confere ao cêntimo.
Qualquer alteração ao código de cálculo — refactor, mudança de fórmula, "limpeza", troca de
arredondamentos — tem de voltar a dar exactamente estes dois números antes de ser dada por
terminada. Verificação rápida:

```bash
node -e "var C=require('./assets/calculators.js');
var c=C.simularCredito({valor:450000,entrada:90000,anos:30,tipo:'var',euribor:2.31,spread:1.2});
console.log(c.prestacao.toFixed(2), c.mtic.toFixed(2));"
# esperado: 1618.57 593753.02
```

---

## 2. IMT + Imposto do Selo

### Escalões IMT 2025, Continente

Cada escalão tem taxa marginal e parcela a abater: `IMT = valor × taxa − parcela`. Os dois últimos
escalões são de taxa única, sem parcela. Percorre-se a tabela de cima para baixo e usa-se o
primeiro escalão cujo limite superior ainda comporta o valor. O resultado nunca é negativo.

**HPP — habitação própria e permanente**

| Até (€) | Taxa | Parcela a abater (€) |
|---|---|---|
| 104 261 | 0 % | 0 |
| 142 618 | 2 % | 2 085,22 |
| 194 458 | 5 % | 6 363,76 |
| 324 058 | 7 % | 10 252,92 |
| 648 022 | 8 % | 13 493,50 |
| 1 128 287 | 6 % | 0 |
| acima | 7,5 % | 0 |

**Habitação secundária ou para arrendamento**

| Até (€) | Taxa | Parcela a abater (€) |
|---|---|---|
| 104 261 | 1 % | 0 |
| 142 618 | 2 % | 1 042,61 |
| 194 458 | 5 % | 5 321,15 |
| 324 058 | 7 % | 9 210,31 |
| 621 501 | 8 % | 12 450,89 |
| 1 128 287 | 6 % | 0 |
| acima | 7,5 % | 0 |

A diferença que mais pesa: na HPP o primeiro escalão é isento, na secundária paga 1 % desde o
primeiro euro. E repare-se que o penúltimo limite difere entre as duas tabelas (648 022 vs
621 501) — não é gralha, está assim na lei e assim está no código.

**Taxas únicas**, sem escalões: terreno para construção 6,5 %, outros prédios urbanos 6,5 %,
prédios rústicos 5 %.

### Imposto do Selo da compra

`selo = valor × 0,008` — 0,8 % sobre o valor de aquisição (TGIS, verba 1.1). É plano, não tem
escalões, e é o custo que quase toda a gente esquece de contar.

### IMT Jovem

Constantes: isenção total até **316 772 €**, tecto de **633 453 €**, idade máxima **35 anos**.

- Até 316 772 €: IMT zero e Selo zero na parte beneficiada.
- Entre 316 772 € e 633 453 €: paga-se apenas sobre o **excedente**, à taxa marginal do escalão
  onde o valor cai — tanto no IMT como no Selo (0,8 % sobre o excedente).
- Acima de 633 453 €: sem benefício nenhum, nem sobre a parte de baixo.

**Pro-rata por quota de comprador.** O benefício é individual, por isso aplica-se à quota de cada
comprador elegível. Com dois compradores em que só um é elegível, `quota = 1/2` e:

```
IMT  = imtCheio × (1 − quota) + imtBeneficiado × quota
Selo = selo     × (1 − quota) + seloBeneficiado × quota
```

Elegível = idade ≤ 35 **e** primeira habitação própria. O simulador pergunta as duas coisas por
comprador, e o painel dos compradores só aparece quando o tipo de aquisição é HPP.

O painel de resultado mostra a linha "Poupança com o IMT Jovem" apenas quando ela é maior que
0,50 € — abaixo disso é ruído. E há quatro notas de texto conforme o estado: benefício total,
benefício só sobre a quota de N em M compradores, acima do tecto, ou sem benefício com explicação
dos requisitos.

### Regiões Autónomas: decisão deliberada

Escolher "Regiões Autónomas" **não produz um número**. O painel troca para uma mensagem:

> Os Açores e a Madeira têm escalões próprios, diferentes dos do Continente. Prefiro não lhe dar
> um número errado: diga-me o concelho e o valor e faço-lhe a conta certa.

Isto não é uma funcionalidade por acabar. É a decisão certa e converte melhor do que um número:
transforma uma limitação técnica num pedido de contacto directo, e protege o consultor de ser
citado por um valor que não bate com a escritura. Manter tal e qual.

### Nota sobre o valor de incidência

O IMT incide sobre o **maior** de dois valores: o preço da escritura ou o VPT (valor patrimonial
tributário). O simulador não vai buscar o VPT a lado nenhum — a dica sob o campo pede ao
utilizador que escreva o VPT se ele for superior ao preço. Manter essa dica.

### VALORES DE VALIDAÇÃO

```
HPP, 200 000 €, sem IMT Jovem  ->  IMT  3 747,08 €
   (200 000 × 0,07 − 10 252,92)

IMT Jovem: isenção total até 316 772 €, tecto 633 453 €, até 35 anos,
           aplicado pro-rata pela quota de cada comprador elegível.
```

---

## 3. Mais-valias (IRS)

### A conta

```
aquisição actualizada = valor de compra × coeficiente de desvalorização
mais-valia bruta      = valor de venda − aquisição actualizada − despesas
```

Despesas admitidas (só se o utilizador disser que as teve): obras e melhorias, IMT + Selo pagos na
aquisição, comissão imobiliária da venda, outros encargos. A dica lembra que as obras só contam se
tiverem sido feitas nos doze anos anteriores à venda e se houver facturas.

**Reinvestimento** (só quando o imóvel vendido era habitação própria):

```
base   = max(0, valor de venda − amortização do crédito na escritura)
fracção = min(1, valor a reinvestir / base)
isento  = mais-valia bruta × fracção
```

A base é o valor de realização **já deduzido do crédito amortizado** — é este detalhe que quase
todos os simuladores online falham.

**Tributação:**

```
tributável = (bruta − isento) × 0,50      // englobamento de 50 %, regra dos residentes
imposto    = tributável × taxa marginal de IRS / 100
```

Se a mais-valia bruta for ≤ 0 (venda com perda), o painel escreve que não há mais-valia em vez de
mostrar 0,00 €.

### Porque se PEDE o coeficiente e a taxa de IRS

Estes dois campos parecem um simulador por acabar. Não são — são a parte honesta do simulador.

**Coeficiente de desvalorização (default 1,00).** A tabela de coeficientes de desvalorização da
moeda é publicada por Portaria **todos os anos** e depende do ano da compra. Embutir a tabela
significa que, doze meses depois de o site ir para o ar, ele passa a dar números errados com ar de
certos — e ninguém vai lá actualizar. Pedir o coeficiente e explicar onde o ir buscar (Portal das
Finanças) mantém o simulador correcto para sempre. O default de 1,00 é o erro **seguro**: com 1,00
a mais-valia sai sobrestimada, portanto o imposto estimado é maior do que o real. Um simulador que
erra por excesso não cria uma expectativa que a escritura vai desmentir.

O texto do original diz isto ao utilizador em vez de o esconder:
*"deixei-o a 1,00 de propósito, para não lhe dar um número inventado. Com 1,00 a mais-valia sai
sobrestimada."*

**Taxa marginal de IRS.** Deduzir o escalão exigiria pedir rendimento anual, agregado familiar,
dependentes e deduções — quatro campos íntimos que fariam metade das pessoas fechar a página — e a
tabela de escalões também muda todos os anos. Em vez disso oferece-se uma lista de escalões
(13 %, 16,5 %, 22 %, 25 %, 32 %, 35,5 %, 43,5 %, 45 %, 48 %, com 32 % pré-seleccionado) e explica-se
que metade da mais-valia é somada ao rendimento e tributada à taxa do escalão em que cair.

Os anos de compra e de venda são recolhidos mas **não entram na aritmética** — servem de contexto
para o utilizador ir procurar o coeficiente do ano certo. Não fingir que são usados.

---

## 4. UX partilhada pelos três

Estas regras aplicam-se aos três simuladores e a qualquer quarto que se acrescente.

**Formatação pt-PT nos inputs.** O parser aceita `450 000`, `450.000,50` e `450000.5` sem se
enganar no separador. A regra: se houver vírgula, ela é o separador decimal e os pontos são
milhares; se não houver vírgula, o ponto é decimal (formato de máquina, para quem cola valores).
Espaço normal, espaço fino, `€` e `%` são ruído e caem fora antes do `parseFloat`. Os inputs são
`type="text"` com `inputmode="decimal"` — `type="number"` recusa a vírgula em teclados portugueses
e mostra setas inúteis.

Na saída, `Intl.NumberFormat('pt-PT', {style:'currency', currency:'EUR'})` com duas casas fixas.
Para percentagens há um detalhe: `0.07 * 100` dá `7.000000000000001` em vírgula flutuante, por isso
arredonda-se com `toFixed(3)` **antes** de formatar, senão a etiqueta do escalão sai com uma cauda
de dígitos.

**Sliders sincronizados.** Os três simuladores de referência usam apenas caixas de texto, botões
segmentados e `select` — não há sliders. Se acrescentar um slider a um campo, tem de o ligar nos
dois sentidos ao input de texto (`input` no slider escreve na caixa e recalcula; `input` na caixa
move o slider), e a caixa continua a ser a fonte de verdade para valores fora do intervalo do
slider.

**Recalcular em tempo real, sem botão.** Um botão "Calcular" só acrescenta um passo. Todos os
`input` e `select` dentro dos painéis recebem listeners de `input` **e** `change` (o `change` é
para os `select` e para o autofill), e a função de cálculo corre uma vez ao carregar para o painel
nunca aparecer vazio.

**Botões segmentados** em vez de radios para as escolhas binárias (variável/fixa, sim/não,
1 ou 2 compradores, Continente/Regiões Autónomas). Estado em `aria-pressed`, agrupados por
`role="group"` com `aria-label`, e o helper devolve uma função que lê o valor activo.

**O painel de resultado não pode saltar.** É `aria-live="polite"` para os leitores de ecrã
anunciarem o novo valor, e actualiza-se por `textContent` — nunca se reconstrói o HTML, nunca se
esconde e mostra. As linhas condicionais (poupança do IMT Jovem, isenção por reinvestimento) usam
o atributo `hidden` numa linha já existente, com um limiar (ex.: só mostra a poupança acima de
0,50 €) para não piscar com valores residuais. Campos derivados que aparecem no formulário
(montante a financiar, LTV, TAN resultante) são inputs `readonly`, escritos pelo mesmo cálculo.

**Campos que aparecem e desaparecem** (taxa fixa vs variável, o segundo comprador, a caixa de
despesas, os valores de reinvestimento) usam `hidden` e disparam recálculo na mesma acção.

**Disclaimer legal obrigatório.** Cada painel de resultado termina com um bloco de aviso com
ícone, antes do CTA. É inegociável e específico de cada simulador:

- Crédito: *"Simulação indicativa, sem valor contratual. Não inclui comissões do banco, avaliação,
  seguros de vida e multirriscos, nem o IMT e o selo da compra — esses estão no simulador de IMT."*
- IMT: escalões do Continente de **{{ANO}}**, actualizados todos os anos pelo Orçamento do Estado;
  confirmar que continuam em vigor. *"Simulação indicativa, sem valor oficial."*
- Mais-valias: *"Estimativa, não é aconselhamento fiscal."* + confirmar o coeficiente do ano da
  compra + falar com o contabilista.

Dizer o ano das tabelas no próprio aviso é o que permite a quem herdar o site saber que está a
olhar para dados velhos.

**CTA no fim do painel.** Botão sólido para WhatsApp, com texto próprio de cada ferramenta
("Quero ajuda com o crédito", "Quero ajuda com a compra", "Falar comigo sobre a venda"), sempre
`target="_blank" rel="noopener"`:

```html
<a class="btn btn--solid" href="https://wa.me/{{WHATSAPP}}" target="_blank" rel="noopener">…</a>
```

No original o link é simples: **não leva os valores da simulação pré-escritos na mensagem**. Se
quiser esse comportamento — e é uma boa ideia, porque chega uma conversa já qualificada —
constrói-se assim, actualizando o `href` no mesmo sítio onde se escreve o resultado:

```js
var msg = 'Olá, simulei no site: imóvel ' + money(valor) +
          ', entrada ' + money(entrada) + ', ' + anos + ' anos. ' +
          'Prestação estimada ' + money(M) + '. Pode ajudar-me?';
cta.href = 'https://wa.me/{{WHATSAPP}}?text=' + encodeURIComponent(msg);
```

Duas cautelas: `encodeURIComponent` sobre a mensagem inteira, e nada de dados pessoais no texto —
só os valores que o próprio utilizador escreveu.

**Movimento.** Os painéis entram por `IntersectionObserver` com atraso escalonado
(`--tl-d: .06s, .12s, .18s`) e o fio que liga os passos numerados é decorativo (`aria-hidden`).
Sob `prefers-reduced-motion: reduce`, ou sem `IntersectionObserver`, tudo aparece de imediato no
estado final — nunca fica conteúdo invisível à espera de uma animação que não vai correr.

**Ligação entre ferramentas.** As três páginas vivem sob o mesmo item de menu ("Ferramentas") e
citam-se umas às outras nos disclaimers. É o que faz o visitante passar de uma para as outras em
vez de sair.

---

## 5. Como adicionar um quarto simulador

Candidatos naturais: **arrendamento** (renda vs prestação, ponto de equilíbrio) ou
**rentabilidade** (yield bruto e líquido de um imóvel para investimento).

O molde:

1. **Copiar uma página existente** como esqueleto — `imt.html` é a mais completa em painéis
   condicionais. Ficam de graça: fundo, navbar, rodapé, i18n, `TL`, o fio dos passos, o reveal.
2. **Escolher um prefixo de IDs** de duas letras, como os existentes (`c-` crédito, `i-` IMT,
   `m-` mais-valias). Ex.: `r-` para rentabilidade. Todos os IDs da página usam esse prefixo.
3. **A guarda de arranque** é o primeiro input: `if(!document.getElementById('r-valor')) return;`
   — é assim que o mesmo bloco de JS pode viver em várias páginas sem rebentar.
4. **Escrever a função pura** em `assets/calculators.js`, com comentário de fórmula e fonte, e
   exportá-la na API. Nada de DOM lá dentro.
5. **Numerar os painéis** com `<span class="tl-panel__n">N</span>` — o fio mede as bolas sozinho e
   cronometra os clarões pelo instante em que a faísca lá chega. Não é preciso configurar nada.
6. **Painel de resultado** com a mesma estrutura: `tl-res__lab` + `tl-res__big` para o número
   principal, `tl-res__list` para a decomposição, `tl-res__tot` para o total destacado,
   `aria-live="polite"` no `<aside>`.
7. **Ligar com `TL.live(calc)`** e nada mais. Sem botão de submeter.
8. **Disclaimer específico** + CTA de WhatsApp com texto próprio.
9. **Registar nos menus** — dropdown "Ferramentas" da navbar de desktop e do menu mobile, nas
   **quatro** páginas de ferramentas (elas repetem o markup da navbar) — e nas chaves de i18n
   `nav.t*`.
10. **Definir e escrever o valor de validação** neste ficheiro, com um caso concreto e o resultado
    esperado ao cêntimo. Um simulador sem valor de validação não está terminado: é o único
    mecanismo que impede um refactor futuro de o partir em silêncio.

Regras que não se negoceiam no simulador novo: nenhum número fiscal inventado, nenhuma tabela que
caduque embutida sem o ano à vista, disclaimer sempre, e o estado "não sei calcular isto, fale
comigo" preferível a um resultado errado.
