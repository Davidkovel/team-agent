/* =========================================================
   SHELL / JS — tudo o que TODAS as páginas partilham.
   Origem: site de referência do género (<script> inline do index), confirmado
   igual nas páginas vender e crédito.

   O que está aqui: barras do fundo, bloqueio de scroll, menu mobile
   com foco preso, submenus da navbar, i18n (dicionário + applyLang),
   seletor de idioma e o utilitário de reveal por scroll.

   O que NÃO está aqui: nada de secções nem simuladores. Isso vive no
   JS da página, que estende o dicionário assim:

     Object.assign(Shell.I18N.pt, { 'vd.h1':'…' });
     Object.assign(Shell.I18N.en, { 'vd.h1':'…' });
     Object.assign(Shell.I18N.fr, { 'vd.h1':'…' });
     Shell.applyLang(Shell.lang);          // re-aplica com as chaves novas
     Shell.reveal('.vd-rev');              // entrada por scroll da secção

   SUBSTITUIR: {{NOME}}, {{AGENCIA}}, {{AMI}}, {{CIDADE}}, {{ANO}} nas
   strings do rodapé, e as cores em GBARS se o fundo mudar.

   Carregar com <script defer src="assets/shell.js"></script> (no <head>)
   ou colado antes de </body>. Nos dois casos o DOM já existe quando corre,
   por isso não há DOMContentLoaded.
   ========================================================= */
var Shell = (function(){
'use strict';

var reduceMotion = window.matchMedia
  ? matchMedia('(prefers-reduced-motion:reduce)').matches
  : false;

/* a API pública nasce vazia aqui em cima porque os blocos abaixo escrevem
   nela (API.lang, API.syncLang) enquanto correm — preenchê-la só no fim
   dava TypeError */
var API = {};

/* =========================================================
   GRADIENT BARS — fundo fixo. Mesma matemática do componente React.
   Muda só este objeto para afinar o fundo.
   ========================================================= */
var GBARS = {
  numBars: 15,
  gradientFrom: 'rgb(28, 100, 242)',
  gradientTo: 'transparent',
  animationDuration: 2,          // segundos — base; cada barra desvia ligeiramente
  amplitude: 0.62,               // scaleY no fim do ciclo (menor = mais movimento)
};

(function renderGradientBars(cfg){
  var root = document.getElementById('gbars');
  if(!root) return;

  // perfil em U, mínimo 30% ao centro — as barras altas ficam nas pontas
  function barHeight(index, total){
    var position = total > 1 ? index / (total - 1) : 0;
    var maxHeight = 100, minHeight = 30, center = .5;
    var distanceFromCenter = Math.abs(position - center);
    var heightPercentage = Math.pow(distanceFromCenter * 2, 1.2);
    return minHeight + (maxHeight - minHeight) * heightPercentage;
  }

  var row = document.createElement('div');
  row.className = 'gbars__row';

  for(var i = 0; i < cfg.numBars; i++){
    var scale = barHeight(i, cfg.numBars) / 100;
    var bar = document.createElement('div');
    bar.className = 'gbars__bar';
    bar.style.flex = '1 0 calc(100% / ' + cfg.numBars + ')';
    bar.style.maxWidth = 'calc(100% / ' + cfg.numBars + ')';
    bar.style.background = 'linear-gradient(to top, ' + cfg.gradientFrom + ', ' + cfg.gradientTo + ')';
    bar.style.transform = 'scaleY(' + scale + ')';
    bar.style.animationDelay = (i * 0.1) + 's';
    bar.style.setProperty('--initial-scale', scale);
    bar.style.setProperty('--gb-amp', cfg.amplitude);
    /* duração ligeiramente diferente por barra: sem isto todas respiram ao
       mesmo compasso e o fundo lê-se mecânico em vez de vivo */
    bar.style.setProperty('--gb-dur', (cfg.animationDuration + (i % 4) * 0.28).toFixed(2) + 's');
    row.appendChild(bar);
  }
  root.appendChild(row);
})(GBARS);

/* =========================================================
   SCROLL LOCK — partilhado. É um contador, não um booleano: se o menu
   e um lightbox estiverem abertos ao mesmo tempo, fechar um não pode
   devolver o scroll enquanto o outro ainda está aberto.
   O paddingRight compensa a largura da barra de scroll, senão a página
   salta lateralmente ao abrir o menu.
   ========================================================= */
var scrollLocks = 0;
function lockScroll(on){
  var d = document.documentElement;
  if(on){
    if(!scrollLocks++){
      var g = window.innerWidth - d.clientWidth;
      d.style.overflow = 'hidden';
      if(g > 0) d.style.paddingRight = g + 'px';
    }
  } else if(scrollLocks > 0 && !--scrollLocks){
    d.style.overflow = '';
    d.style.paddingRight = '';
  }
}
window.__lockScroll = lockScroll;   // compatibilidade com código de página

/* =========================================================
   NAVBAR — menu mobile: abrir/fechar, Esc, foco preso, scroll bloqueado
   ========================================================= */
(function navbar(){
  var menu   = document.getElementById('nv-menu');
  var burger = document.getElementById('nv-burger');
  var close  = document.getElementById('nv-close');
  if(!menu || !burger || !close) return;

  var lastFocus = null;

  function setOpen(open){
    menu.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    lockScroll(open);
    /* o foco entra no menu e volta ao botão que o abriu: quem navega por
       teclado não pode ficar preso atrás de um painel invisível */
    /* o requestAnimationFrame não é enfeite: no mesmo tick em que a classe
       .open é acrescentada o painel ainda está com visibility:hidden, e um
       elemento invisível NÃO aceita foco — o close.focus() falha em silêncio
       e o Tab seguinte sai para o hero ou para o rodapé, por trás do painel.
       Esperar um frame dá tempo ao browser de aplicar o estilo. */
    if(open){ lastFocus = document.activeElement;
              requestAnimationFrame(function(){ close.focus(); }); }
    else if(lastFocus){ lastFocus.focus(); lastFocus = null; }
  }

  burger.addEventListener('click', function(){ setOpen(true); });
  close.addEventListener('click', function(){ setOpen(false); });
  Array.prototype.forEach.call(menu.querySelectorAll('a'), function(a){
    a.addEventListener('click', function(){ setOpen(false); });
  });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && menu.classList.contains('open')) setOpen(false);
    if(e.key !== 'Tab' || !menu.classList.contains('open')) return;
    // prende o foco dentro do menu enquanto está aberto
    var f = menu.querySelectorAll('a,button');
    if(!f.length) return;
    var first = f[0], last = f[f.length - 1];
    /* rede de segurança: se o foco ficou FORA do menu (o primeiro focus
       falhou, um clique atirou-o para a página, uma extensão mexeu no DOM),
       o Tab traz o foco de volta para dentro. Sem isto o bloco abaixo nunca
       dispara, porque só compara com o primeiro e o último do menu. */
    if(!menu.contains(document.activeElement)){
      e.preventDefault(); (e.shiftKey ? last : first).focus(); return;
    }
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  });

  // se passar a desktop com o menu aberto, fecha para não deixar o scroll travado
  var mq = matchMedia('(min-width:821px)');
  var onMq = function(e){ if(e.matches) setOpen(false); };
  if(mq.addEventListener) mq.addEventListener('change', onMq);
  else if(mq.addListener) mq.addListener(onMq);
})();

/* =========================================================
   NAVBAR — submenus. O item de topo NÃO reencaminha: desce o painel.
   Abre ao passar o rato e também ao clicar (teclado e trackpad).
   ========================================================= */
(function navDrop(){
  var items = Array.prototype.slice.call(document.querySelectorAll('.nv__item'));
  if(!items.length) return;

  function set(item, on){
    item.classList.toggle('open', on);
    item.querySelector('.nv__top').setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function closeAll(except){
    items.forEach(function(it){ if(it !== except) set(it, false); });
  }

  items.forEach(function(item){
    var btn  = item.querySelector('.nv__top');
    var drop = item.querySelector('.nv__drop');
    if(!btn || !drop) return;
    var t;

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var on = !item.classList.contains('open');
      closeAll(item); set(item, on);
    });
    item.addEventListener('pointerenter', function(){ clearTimeout(t); closeAll(item); set(item, true); });
    item.addEventListener('pointerleave', function(){
      /* um respiro antes de fechar: o rato tem de conseguir descer até ao painel */
      clearTimeout(t); t = setTimeout(function(){ set(item, false); }, 180);
    });
    item.addEventListener('focusout', function(e){
      if(!item.contains(e.relatedTarget)) set(item, false);
    });
    Array.prototype.forEach.call(drop.querySelectorAll('a'), function(a){
      a.addEventListener('click', function(){ set(item, false); });
    });
  });

  document.addEventListener('click', function(e){
    items.forEach(function(it){ if(!it.contains(e.target)) set(it, false); });
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeAll(null); });
})();

/* =========================================================
   i18n — PT (fonte) / EN / FR.
   PT é o original: é nele que se escreve primeiro e é o fallback.

   ATENÇÃO: as traduções EN/FR abaixo são um ponto de partida e TÊM DE
   SER REVISTAS POR UM HUMANO antes de ir para produção. Nomes próprios,
   nomes de agência, designações legais (AMI, IMT, mais-valias) e o tom
   comercial não sobrevivem a uma tradução automática.

   Marcação no HTML:
     data-i18n="chave"            → substitui textContent
     data-i18n="chave" data-i18n-html="1" → substitui innerHTML
        (só onde a frase precisa de <em>, <b> ou <br>; nunca com texto
        vindo do utilizador)
   ========================================================= */
var I18N = {
  pt:{
    /* navegação */
    'nav.home':'Início',
    'nav.imoveis':'Imóveis',
    'nav.comprar':'Comprar',
    'nav.comprarSub':'Os imóveis disponíveis para venda',
    'nav.vender':'Vender',
    'nav.venderSub':'Avaliação gratuita do seu imóvel',
    'nav.tools':'Ferramentas',
    'nav.tCred':'Simulador de Crédito',
    'nav.tCredSub':'Prestação, selos e custo total',
    'nav.tMv':'Mais-Valias',
    'nav.tMvSub':'IRS na venda de um imóvel',
    'nav.tImt':'Simulador de IMT',
    'nav.tImtSub':'IMT e Imposto do Selo na compra',
    'nav.sobre':'Sobre mim',
    'nav.sobreSub':'Conhecer melhor o consultor',
    'nav.cta':'Contactar',
    /* rodapé */
    'ft.role':'Consultor Imobiliário',
    'ft.brand':'{{NOME}}',
    'ft.brandBig':'{{NOME}}',
    'ft.desc':'Consultoria imobiliária em {{CIDADE}} e em todo o país, do primeiro contacto à escritura.',
    'ft.soc.ig':'Instagram','ft.soc.wa':'WhatsApp','ft.soc.tel':'Telefone',
    'ft.nav.home':'Início','ft.nav.buy':'Comprar','ft.nav.sell':'Vender',
    'ft.nav.social':'Instagram','ft.nav.about':'Sobre mim',
    'ft.privacy':'Política de Privacidade',
    'ft.ami':'{{AGENCIA}} · AMI {{AMI}}',
    'ft.copy':'© {{ANO}} {{NOME}} · Consultor Imobiliário {{AGENCIA}} · {{CIDADE}}, Portugal',
    'ft.net':'{{AGENCIA}} · {{CIDADE}}',
  },
  en:{ /* REVER ANTES DE PUBLICAR */
    'nav.home':'Home',
    'nav.imoveis':'Properties',
    'nav.comprar':'Buy',
    'nav.comprarSub':'The properties currently for sale',
    'nav.vender':'Sell',
    'nav.venderSub':'A free valuation of your property',
    'nav.tools':'Tools',
    'nav.tCred':'Mortgage calculator',
    'nav.tCredSub':'Instalment, duties and total cost',
    'nav.tMv':'Capital gains',
    'nav.tMvSub':'Income tax when you sell',
    'nav.tImt':'Transfer tax calculator',
    'nav.tImtSub':'IMT and stamp duty on the purchase',
    'nav.sobre':'About me',
    'nav.sobreSub':'Get to know the consultant',
    'nav.cta':'Get in touch',
    'ft.role':'Real Estate Consultant',
    'ft.brand':'{{NOME}}',
    'ft.brandBig':'{{NOME}}',
    'ft.desc':'Real estate consultancy in {{CIDADE}} and across Portugal, from first contact to the deed.',
    'ft.soc.ig':'Instagram','ft.soc.wa':'WhatsApp','ft.soc.tel':'Phone',
    'ft.nav.home':'Home','ft.nav.buy':'Buy','ft.nav.sell':'Sell',
    'ft.nav.social':'Instagram','ft.nav.about':'About me',
    'ft.privacy':'Privacy Policy',
    'ft.ami':'{{AGENCIA}} · AMI {{AMI}}',
    'ft.copy':'© {{ANO}} {{NOME}} · Real Estate Consultant, {{AGENCIA}} · {{CIDADE}}, Portugal',
    'ft.net':'{{AGENCIA}} · {{CIDADE}}',
  },
  fr:{ /* À FAIRE RELIRE AVANT PUBLICATION */
    'nav.home':'Accueil',
    'nav.imoveis':'Biens',
    'nav.comprar':'Acheter',
    'nav.comprarSub':'Les biens disponibles à la vente',
    'nav.vender':'Vendre',
    'nav.venderSub':'Estimation gratuite de votre bien',
    'nav.tools':'Outils',
    'nav.tCred':'Simulateur de crédit',
    'nav.tCredSub':'Mensualité, droits et coût total',
    'nav.tMv':'Plus-values',
    'nav.tMvSub':'Impôt sur la vente d’un bien',
    'nav.tImt':'Simulateur IMT',
    'nav.tImtSub':'IMT et droit de timbre à l’achat',
    'nav.sobre':'À propos',
    'nav.sobreSub':'Mieux connaître le conseiller',
    'nav.cta':'Contact',
    'ft.role':'Conseiller Immobilier',
    'ft.brand':'{{NOME}}',
    'ft.brandBig':'{{NOME}}',
    'ft.desc':'Conseil immobilier à {{CIDADE}} et dans tout le Portugal, du premier contact à l’acte.',
    'ft.soc.ig':'Instagram','ft.soc.wa':'WhatsApp','ft.soc.tel':'Téléphone',
    'ft.nav.home':'Accueil','ft.nav.buy':'Acheter','ft.nav.sell':'Vendre',
    'ft.nav.social':'Instagram','ft.nav.about':'À propos',
    'ft.privacy':'Politique de confidentialité',
    'ft.ami':'{{AGENCIA}} · AMI {{AMI}}',
    'ft.copy':'© {{ANO}} {{NOME}} · Conseiller Immobilier, {{AGENCIA}} · {{CIDADE}}, Portugal',
    'ft.net':'{{AGENCIA}} · {{CIDADE}}',
  },
};

/* o idioma sobrevive à navegação entre páginas (não há build nem router:
   cada página é um documento novo e o localStorage é a única memória) */
var LANG = 'pt';
try{ var saved = localStorage.getItem('lang'); if(I18N[saved]) LANG = saved; }catch(e){}

function applyLang(lang){
  if(!I18N[lang]) lang = 'pt';
  LANG = lang;
  API.lang = lang;
  try{ localStorage.setItem('lang', lang); }catch(e){}
  /* o lang do <html> só muda quando a PÁGINA INTEIRA estiver traduzida.
     Só o que tem data-i18n troca de idioma; secções ainda por marcar ficam
     em português. Pôr lang="en" numa página assim faz o leitor de ecrã ler
     texto português com fonética inglesa — pior do que não traduzir.
     Quando tudo estiver traduzido, põe data-i18n-complete no <html>. */
  if(document.documentElement.hasAttribute('data-i18n-complete')){
    document.documentElement.lang = lang;   // muda a hifenização e o leitor de ecrã
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function(el){
    /* PRECEDÊNCIA: em PT manda o content.json (data-c), não o dicionário.
       Um elemento pode ter os dois — data-c escreve o texto do cliente,
       data-i18n traduz para EN/FR. Sem esta guarda o dicionário corre depois
       e reescreve por cima, e mudar o content.json não tem efeito visível. */
    if(lang === 'pt' && el.hasAttribute('data-c')) return;
    var val = I18N[lang][el.getAttribute('data-i18n')];
    if(val == null) return;               // chave em falta: fica o texto do HTML
    if(el.hasAttribute('data-i18n-html')) el.innerHTML = val;
    else el.textContent = val;
  });
}

/* tradução de strings em JS (mensagens de formulário, resultados de
   simuladores): cai para PT quando a chave falta no idioma ativo */
function T(key){
  return (I18N[LANG] && I18N[LANG][key]) || I18N.pt[key] || key;
}

/* =========================================================
   SELETOR DE IDIOMA — os blocos [data-lang-root] vivem na barra e no
   menu mobile; os dois são sincronizados de uma vez.
   ========================================================= */
(function langSelect(){
  var META = {pt:['🇵🇹','PT'], en:['🇬🇧','EN'], fr:['🇫🇷','FR']};
  var roots = Array.prototype.slice.call(document.querySelectorAll('[data-lang-root]'));
  if(!roots.length) return;

  function setOpen(root, on){
    root.classList.toggle('open', on);
    root.querySelector('.lang__btn').setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function closeAll(){ roots.forEach(function(r){ setOpen(r, false); }); }

  /* o gatilho mostra sempre o idioma em vigor; a lista marca-o com o visto
     e com aria-selected, que é o que o leitor de ecrã anuncia */
  function sync(){
    var m = META[LANG] || META.pt;
    roots.forEach(function(r){
      r.querySelector('.lang__btn .lang__flag').textContent = m[0];
      r.querySelector('.lang__code').textContent = m[1];
      Array.prototype.forEach.call(r.querySelectorAll('.lang__opt'), function(o){
        o.setAttribute('aria-selected', o.getAttribute('data-lang') === LANG ? 'true' : 'false');
      });
    });
  }

  roots.forEach(function(r){
    r.querySelector('.lang__btn').addEventListener('click', function(e){
      e.stopPropagation();
      var on = !r.classList.contains('open');
      closeAll(); setOpen(r, on);
    });
    Array.prototype.forEach.call(r.querySelectorAll('.lang__opt'), function(o){
      o.addEventListener('click', function(e){
        e.stopPropagation();
        applyLang(o.getAttribute('data-lang'));
        sync(); closeAll();
      });
    });
  });

  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeAll(); });

  API.syncLang = sync;
  sync();
})();

/* =========================================================
   REVEAL — entrada por scroll, partilhada.
   A classe .rev-js no <html> é o que ATIVA o esconder no CSS: sem JS,
   ou com JS a falhar, o conteúdo fica visível em vez de invisível.
   Com prefers-reduced-motion mostra tudo de uma vez e não observa nada.
   ========================================================= */
function reveal(selector, opts){
  document.documentElement.classList.add('rev-js');
  var items = Array.prototype.slice.call(document.querySelectorAll(selector || '.rev'));
  if(!items.length) return;
  var show = function(){ items.forEach(function(el){ el.classList.add('is-in'); }); };
  if(!('IntersectionObserver' in window) || reduceMotion){ show(); return; }
  var o = opts || {};
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){ en.target.classList.add('is-in'); io.unobserve(en.target); }
    });
  }, {rootMargin: o.rootMargin || '0px 0px -12% 0px', threshold: o.threshold || .12});
  items.forEach(function(el){ io.observe(el); });
}

/* footer: entra em bloco (um só observer no <footer>), porque as peças
   escalonam-se por --ft-d e não por posição no ecrã */
(function footerReveal(){
  document.documentElement.classList.add('ft-js');
  var ft = document.getElementById('ft');
  if(!ft) return;
  var show = function(){ ft.classList.add('is-ft-in'); };
  if(!('IntersectionObserver' in window) || reduceMotion){ show(); return; }
  var io = new IntersectionObserver(function(entries){
    for(var i = 0; i < entries.length; i++){
      if(entries[i].isIntersecting){ show(); io.disconnect(); break; }
    }
  }, {rootMargin:'0px 0px -12% 0px', threshold:.12});
  io.observe(ft);
})();

/* =========================================================
   API pública — o JS da página usa só isto.
   ========================================================= */
API.I18N = I18N;
API.lang = LANG;
API.applyLang = applyLang;
API.T = T;
API.reveal = reveal;
API.lockScroll = lockScroll;
API.reduceMotion = reduceMotion;
API.GBARS = GBARS;

applyLang(LANG);
return API;
})();
