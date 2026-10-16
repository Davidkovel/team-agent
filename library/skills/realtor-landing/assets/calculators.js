/* =========================================================
   CALCULATORS — núcleo de cálculo dos três simuladores do kit:
   crédito habitação, IMT + Imposto do Selo, e mais-valias de IRS.

   Regras deste ficheiro:
   - ZERO DOM. Nenhuma função aqui toca em document, window ou eventos.
     A camada de interface (ler inputs, escrever no painel de resultado)
     vive na página; isto é só aritmética, para poder ser testada.
   - Escalões e constantes copiados TAL E QUAL do original. Não "melhorar",
     não arredondar, não reordenar: os valores de validação em
     references/calculators.md dependem de cada casa decimal.
   - ES5 puro, sem build, sem npm. Carrega-se com <script src="...">
     e fica em window.CALC (ou em module.exports, se houver bundler).
   ========================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CALC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =========================================================
     0. HELPERS PUROS DE NÚMERO
     ========================================================= */

  /* Aceita "450 000", "450.000,50" e "450000.5" sem se enganar no separador.
     Regra: se houver vírgula, ela é o separador decimal e os pontos são
     milhares; se não houver vírgula, o ponto é decimal (formato de máquina).
     Espaço fino, espaço normal, € e % são ruído e caem fora. */
  function parseNumPT(input) {
    if (typeof input === 'number') return isFinite(input) ? input : 0;
    var raw = String(input == null ? '' : input).replace(/\s| |€|%/g, '');
    if (raw.indexOf(',') > -1) raw = raw.replace(/\./g, '').replace(',', '.');
    var v = parseFloat(raw);
    return isFinite(v) ? v : 0;
  }

  /* Formatadores pt-PT. Ficam aqui porque são puros (valor -> string) e porque
     os três simuladores têm de mostrar exactamente o mesmo formato. */
  var _eur = new Intl.NumberFormat('pt-PT', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var _pct = new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 2, maximumFractionDigits: 3
  });

  function money(v) { return isFinite(v) ? _eur.format(v) : '—'; }
  function pc(v) { return isFinite(v) ? _pct.format(v) + ' %' : '—'; }

  /* 0.07*100 dá 7.000000000000001 em vírgula flutuante: arredondar antes de
     mostrar, senão a etiqueta do escalão sai com uma cauda de dígitos. */
  function rate(frac) {
    return Number((frac * 100).toFixed(3)).toLocaleString('pt-PT') + ' %';
  }

  /* =========================================================
     1. CRÉDITO HABITAÇÃO
     ========================================================= */

  /* Prestação mensal — sistema francês (prestação constante, anuidade):

         M = P * i / (1 - (1 + i)^-n)

     P = capital financiado, i = taxa mensal (TAN/100/12), n = nº de meses.
     Quando i = 0 a fórmula degenera (divisão por zero): nesse caso é a
     amortização linear P/n, que é o limite matemático correcto.

     Fonte: fórmula da anuidade usada pela banca portuguesa para crédito
     habitação de prestação constante. Original: credito.html, função calc(). */
  function prestacao(capital, taxaAnualPct, anos) {
    var P = Math.max(0, capital);
    var i = taxaAnualPct / 100 / 12;
    var n = anos * 12;
    if (i > 0) return P * i / (1 - Math.pow(1 + i, -n));
    return n ? P / n : 0;
  }

  /* Imposto do Selo na ABERTURA do crédito, sobre o capital financiado.
     Escalões por prazo, tal como no original:
       > 5 anos ....... 0,6 %
       > 1 e <= 5 anos  0,5 %
       <= 1 ano ....... 0,04 %
     Fonte: Tabela Geral do Imposto do Selo, verba 17 (utilização de crédito).
     Original: credito.html — var taxaSelo = anos > 5 ? 0.006 : (anos > 1 ? 0.005 : 0.0004); */
  function taxaSeloCredito(anos) {
    return anos > 5 ? 0.006 : (anos > 1 ? 0.005 : 0.0004);
  }

  /* TAN resultante. Taxa variável = cotação Euribor + spread; taxa fixa = a
     taxa proposta pelo banco, tal como está. O prazo da Euribor (3/6/12 meses)
     é uma escolha de interface: NÃO entra na conta — o utilizador escreve a
     cotação já correspondente ao prazo que escolheu. */
  function tanDe(tipo, euribor, spread, taxaFixa) {
    return (tipo === 'var') ? (euribor + spread) : taxaFixa;
  }

  /* Simulação completa do crédito.
     Devolve tudo o que o painel de resultado mostra, já calculado.

     Composição do MTIC (Montante Total Imputado ao Consumidor) tal como no
     original — prestações de toda a vida do empréstimo + selo de abertura +
     4 % sobre o total dos juros:

         mtic = M*n + selo + totalJuros * 0.04

     O 4 % é o Imposto do Selo sobre juros (verba 17.3 da TGIS), aqui aplicado
     ao total dos juros do empréstimo. `isJuros1` é o mesmo imposto mas só
     sobre os juros do 1.º mês, que é o número que se vê na primeira prestação.

     NÃO entram no MTIC (e é dito no aviso legal da página): comissões do banco,
     avaliação, seguro de vida, seguro multirriscos, IMT e selo da compra.

     VALIDAÇÃO OBRIGATÓRIA (ver references/calculators.md):
       valor 450000, entrada 90000, 30 anos, Euribor 2,31 + spread 1,2
       -> prestacao 1618.57 e mtic 593753.02 */
  function simularCredito(o) {
    var valor = o.valor || 0;
    var entrada = Math.min(o.entrada || 0, valor);
    var P = Math.max(0, valor - entrada);
    var anos = o.anos || 30;
    var tan = tanDe(o.tipo || 'var', o.euribor || 0, o.spread || 0, o.taxaFixa || 0);

    var i = tan / 100 / 12;
    var n = anos * 12;
    var M = prestacao(P, tan, anos);

    var taxaSelo = taxaSeloCredito(anos);
    var selo = P * taxaSelo;
    var isJuros1 = P * i * 0.04;          /* selo sobre os juros do 1.º mês */
    var totalPrest = M * n;
    var totalJuros = Math.max(0, totalPrest - P);
    var mtic = totalPrest + selo + totalJuros * 0.04;

    return {
      financiado: P,
      ltv: valor > 0 ? (P / valor * 100) : NaN,
      tan: tan,
      taxaMensal: i,
      meses: n,
      prestacao: M,
      taxaSelo: taxaSelo,
      selo: selo,
      isJuros1: isJuros1,
      totalPrestacoes: totalPrest,
      totalJuros: totalJuros,
      dinheiroInicio: entrada + selo,     /* entrada + selo de abertura */
      mtic: mtic,
      /* a banca costuma exigir que o crédito termine até aos 75/80 anos */
      idadeFim: (o.idade || 0) + anos,
      avisoIdade: ((o.idade || 0) + anos) > 75
    };
  }

  /* =========================================================
     2. IMT + IMPOSTO DO SELO (Continente, 2025)

     Cada escalão tem taxa marginal e parcela a abater:
         IMT = valor x taxa - parcela
     Os dois últimos escalões são de taxa única, sem parcela.
     Aferido: HPP 200 000 EUR -> 3 747,08 EUR.
     ========================================================= */

  /* [limiteSuperior, taxaMarginal, parcelaAAbater] */
  var ESCALOES = {
    /* HPP = habitação própria e permanente */
    hpp: [
      [104261,    0,       0],
      [142618,    0.02,    2085.22],
      [194458,    0.05,    6363.76],
      [324058,    0.07,   10252.92],
      [648022,    0.08,   13493.50],
      [1128287,   0.06,       0],
      [Infinity,  0.075,      0]
    ],
    /* sec = habitação secundária ou para arrendamento */
    sec: [
      [104261,    0.01,       0],
      [142618,    0.02,    1042.61],
      [194458,    0.05,    5321.15],
      [324058,    0.07,    9210.31],
      [621501,    0.08,   12450.89],
      [1128287,   0.06,       0],
      [Infinity,  0.075,      0]
    ]
  };

  /* Tipos sem escalões: taxa única sobre todo o valor. */
  var PLANA = { terreno: 0.065, outros: 0.065, rustico: 0.05 };

  /* Imposto do Selo da compra: 0,8 % sobre o valor de aquisição.
     Fonte: TGIS, verba 1.1 (aquisição onerosa de imóveis). */
  var SELO_COMPRA = 0.008;

  /* IMT Jovem: isenção até ao primeiro limite, e entre os dois limites
     paga-se apenas sobre o excedente. Acima do segundo, não há benefício. */
  var JOVEM_ISENTO = 316772, JOVEM_TETO = 633453, JOVEM_IDADE = 35;

  /* IMT bruto, sem qualquer benefício. Percorre a tabela de baixo para cima e
     usa o primeiro escalão cujo limite superior ainda comporta o valor. */
  function imtDe(tipo, valor) {
    if (PLANA[tipo] !== undefined) return valor * PLANA[tipo];
    var tab = ESCALOES[tipo] || ESCALOES.sec;
    for (var i = 0; i < tab.length; i++) {
      if (valor <= tab[i][0]) return Math.max(0, valor * tab[i][1] - tab[i][2]);
    }
    return 0;
  }

  /* Taxa marginal do escalão onde o valor cai — só para etiquetar o resultado
     e para calcular o IMT Jovem sobre o excedente. */
  function taxaMarginal(tipo, valor) {
    var tab = ESCALOES[tipo];
    if (!tab) return PLANA[tipo] || 0;
    for (var i = 0; i < tab.length; i++) { if (valor <= tab[i][0]) return tab[i][1]; }
    return 0;
  }

  /* Simulação completa de IMT + Selo, com IMT Jovem.

     O benefício é POR QUOTA de comprador: se só um de dois compradores é
     elegível, metade da aquisição paga cheio e metade paga com benefício.
     Elegível = até 35 anos (inclusive) E primeira habitação própria.
     Só se aplica a tipo 'hpp'.

     Regiões Autónomas: NÃO são calculadas aqui de propósito. Têm tabelas
     próprias, diferentes das do Continente; a página mostra "tabelas próprias,
     fale comigo" em vez de um número errado.

     VALIDAÇÃO: hpp 200000, 1 comprador não elegível -> imt 3747.08 */
  function simularIMT(o) {
    var tipo = o.tipo || 'hpp';
    var valor = o.valor || 0;
    var n = o.compradores || 1;

    var imtCheio = imtDe(tipo, valor);
    var selo = valor * SELO_COMPRA;
    var imt = imtCheio, poupanca = 0, quota = 0, estado = 'normal';
    var elegiveis = 0;

    if (tipo === 'hpp') {
      /* quem tem direito ao benefício: até 35 anos e primeira habitação própria */
      if ((o.idade1 || 0) <= JOVEM_IDADE && o.primeira1) elegiveis++;
      if (n === 2 && (o.idade2 || 0) <= JOVEM_IDADE && o.primeira2) elegiveis++;

      if (elegiveis > 0 && valor <= JOVEM_TETO) {
        quota = elegiveis / n;                       /* o benefício é por quota */
        var imtQuota;
        if (valor <= JOVEM_ISENTO) {
          imtQuota = 0;
        } else {
          imtQuota = (valor - JOVEM_ISENTO) * taxaMarginal(tipo, valor);
        }
        imt = imtCheio * (1 - quota) + imtQuota * quota;
        selo = selo * (1 - quota) +
               (valor <= JOVEM_ISENTO ? 0 : (valor - JOVEM_ISENTO) * SELO_COMPRA) * quota;
        poupanca = (imtCheio + valor * SELO_COMPRA) - (imt + selo);
        estado = (elegiveis === n) ? 'jovem-total' : 'jovem-quota';
      } else if (elegiveis > 0) {
        estado = 'acima-do-teto';                    /* elegível mas valor > tecto */
      } else {
        estado = 'sem-beneficio';
      }
    }

    return {
      imtCheio: imtCheio,
      imt: imt,
      selo: selo,
      total: imt + selo,
      poupanca: poupanca,
      quota: quota,
      elegiveis: elegiveis,
      compradores: n,
      taxaEtiqueta: PLANA[tipo] !== undefined ? PLANA[tipo] : taxaMarginal(tipo, valor),
      taxaUnica: PLANA[tipo] !== undefined,
      estado: estado                                 /* para escolher a nota de texto */
    };
  }

  /* =========================================================
     3. MAIS-VALIAS (IRS, residentes)

     A aritmética é toda aqui; os números oficiais (coeficiente de
     desvalorização e escalão de IRS) são escolhidos por quem usa, de
     propósito: mudam por Portaria e inventá-los seria pior do que pedi-los.
     ========================================================= */

  /* Englobamento: só metade da mais-valia é somada ao rendimento (regra dos
     residentes, CIRS art. 43.º n.º 2). */
  var ENGLOBAMENTO = 0.5;

  /* Mais-valia bruta:
         bruta = venda - (compra x coeficiente) - despesas
     O coeficiente actualiza o valor de aquisição pela inflação. É PEDIDO ao
     utilizador (default 1,00) em vez de embutido: a tabela sai por Portaria
     todos os anos e uma tabela desactualizada dá um número errado com ar de
     certo. Com 1,00 a mais-valia sai sobrestimada — é o erro seguro.

     Despesas admitidas no original: obras e melhorias (12 anos anteriores à
     venda, com factura), IMT + Selo da aquisição, comissão imobiliária da
     venda, outros encargos. */
  function maisValiaBruta(venda, compra, coef, despesas) {
    var aq = compra * (coef || 1);
    return venda - aq - (despesas || 0);
  }

  /* Simulação completa.

     Reinvestimento: isenta na proporção do que se reinveste, e a base é o
     valor de realização já deduzido do crédito amortizado na escritura:
         base = max(0, venda - amortizacao)
         fracao = min(1, reinvestimento / base)
     Só se aplica quando o imóvel vendido era habitação própria.

     O imposto final:
         tributavel = (bruta - isento) * 0.5
         imposto    = tributavel * taxaMarginalIRS/100

     A taxa marginal de IRS é ESCOLHIDA pelo utilizador de uma lista de
     escalões, não deduzida do rendimento: calcular o escalão exigiria pedir o
     agregado, dependentes e deduções — e a tabela muda todos os anos. */
  function simularMaisValias(o) {
    var compra = o.compra || 0;
    var venda = o.venda || 0;
    var coef = o.coef || 1;
    var aq = compra * coef;
    var despesas = o.despesas || 0;

    var bruta = venda - aq - despesas;

    var isentoFrac = 0, isentoVal = 0;
    if (o.reinveste && bruta > 0) {
      var base = Math.max(0, venda - (o.amortizacao || 0));
      isentoFrac = base > 0 ? Math.min(1, (o.reinvestimento || 0) / base) : 0;
      isentoVal = bruta * isentoFrac;
    }

    var liquida = Math.max(0, bruta - isentoVal);
    var tributavel = liquida * ENGLOBAMENTO;
    var imposto = tributavel * ((o.taxaIRS || 0) / 100);

    return {
      aquisicaoActualizada: aq,
      coef: coef,
      despesas: despesas,
      bruta: bruta,
      isentoFrac: isentoFrac,
      isentoValor: isentoVal,
      liquida: liquida,
      tributavel: tributavel,
      imposto: imposto,
      semMaisValia: bruta <= 0        /* venda com perda: não há imposto a pagar */
    };
  }

  /* Escalões de IRS oferecidos na lista do original (valor em %). O 32 é o
     pré-seleccionado. São opções de interface, não uma tabela de cálculo. */
  var ESCALOES_IRS = [13, 16.5, 22, 25, 32, 35.5, 43.5, 45, 48];

  /* =========================================================
     API
     ========================================================= */
  return {
    /* helpers */
    parseNumPT: parseNumPT,
    money: money,
    pc: pc,
    rate: rate,

    /* crédito */
    prestacao: prestacao,
    taxaSeloCredito: taxaSeloCredito,
    tanDe: tanDe,
    simularCredito: simularCredito,

    /* IMT */
    ESCALOES: ESCALOES,
    PLANA: PLANA,
    SELO_COMPRA: SELO_COMPRA,
    JOVEM_ISENTO: JOVEM_ISENTO,
    JOVEM_TETO: JOVEM_TETO,
    JOVEM_IDADE: JOVEM_IDADE,
    imtDe: imtDe,
    taxaMarginal: taxaMarginal,
    simularIMT: simularIMT,

    /* mais-valias */
    ENGLOBAMENTO: ENGLOBAMENTO,
    ESCALOES_IRS: ESCALOES_IRS,
    maisValiaBruta: maisValiaBruta,
    simularMaisValias: simularMaisValias
  };
});
