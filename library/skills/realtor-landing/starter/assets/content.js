/* =========================================================
   CONTENT — liga o content.json ao HTML.

   PORQUÊ ISTO EXISTE. Sem build, o costume é espalhar o nome, o telefone
   e a cidade por sete ficheiros e depois esquecer um deles. Aqui há um
   contrato: content.json. Este ficheiro lê-o e reescreve:
     1. tudo o que estiver marcado com data-c="caminho" (texto);
     2. tudo o que estiver marcado com data-c-href="caminho" (href);
     3. as strings do rodapé e do CTA no dicionário do shell (Shell.I18N),
        porque essas são escritas por JS e não vivem no HTML.

   O HTML continua a trazer os MESMOS valores escritos à mão. Não é
   duplicação por descuido: é o estado que se vê sem JS, com o fetch a
   falhar, ou em file://. A página nunca aparece com buracos.

   Carregar SEMPRE depois do shell.js (precisa do objecto Shell).
   ========================================================= */
(function(){
  'use strict';

  /* "consultor.nome" -> valor, sem rebentar a meio caminho */
  function pick(obj, path){
    return path.split('.').reduce(function(o, k){
      if(o == null) return null;
      /* índices de array: "prova.itens.0.valor" */
      return o[k];
    }, obj);
  }

  /* substitui {nome}, {cidade}, {agencia}… numa string do dicionário */
  function fill(tpl, vars){
    return String(tpl).replace(/\{(\w+)\}/g, function(m, k){
      return vars[k] != null ? vars[k] : m;
    });
  }

  function apply(c){
    document.querySelectorAll('[data-c]').forEach(function(el){
      var v = pick(c, el.getAttribute('data-c'));
      if(v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-c-href]').forEach(function(el){
      var v = pick(c, el.getAttribute('data-c-href'));
      if(v != null) el.setAttribute('href', v);
    });

    /* o <html lang> e o telefone em formato de marcação */
    document.querySelectorAll('[data-c-tel]').forEach(function(el){
      var v = pick(c, el.getAttribute('data-c-tel'));
      /* tel: só aqui, num ícone que diz "Telefone". Nunca em CTAs de
         navegação: em macOS o tel: abre o FaceTime sem ninguém pedir. */
      if(v != null) el.setAttribute('href', 'tel:' + v);
    });

    /* ---- strings que o shell escreve por JS (rodapé) ---- */
    if(window.Shell && Shell.I18N){
      var p = c.consultor || {};
      var vars = {
        nome: p.nome, agencia: p.agencia, ami: p.ami,
        cidade: p.cidade, ano: p.ano, funcao: p.funcao
      };
      var modelos = {
        pt:{ 'ft.role':'{funcao}', 'ft.brand':'{nome}', 'ft.brandBig':'{nome}',
             'ft.desc': (c.footer && c.footer.desc) || '',
             'ft.ami':'{agencia} · AMI {ami}',
             'ft.copy':'© {ano} {nome} · {funcao} {agencia} · {cidade}, Portugal',
             'ft.net':'{agencia} · {cidade}' },
        en:{ 'ft.brand':'{nome}', 'ft.brandBig':'{nome}',
             'ft.ami':'{agencia} · AMI {ami}',
             'ft.copy':'© {ano} {nome} · Real Estate Consultant, {agencia} · {cidade}, Portugal',
             'ft.net':'{agencia} · {cidade}' },
        fr:{ 'ft.brand':'{nome}', 'ft.brandBig':'{nome}',
             'ft.ami':'{agencia} · AMI {ami}',
             'ft.copy':'© {ano} {nome} · Conseiller Immobilier, {agencia} · {cidade}, Portugal',
             'ft.net':'{agencia} · {cidade}' }
      };
      Object.keys(modelos).forEach(function(lang){
        Object.keys(modelos[lang]).forEach(function(k){
          if(modelos[lang][k]) Shell.I18N[lang][k] = fill(modelos[lang][k], vars);
        });
      });
      /* re-aplicar com as chaves novas, no idioma que estiver activo */
      Shell.applyLang(Shell.lang);
    }
  }

  /* fetch precisa de HTTP (python3 -m http.server chega). Em file:// falha,
     e a página fica com os valores escritos no HTML — que são os mesmos. */
  if(!window.fetch) return;
  fetch('content.json', {cache:'no-store'})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(c){ if(c) apply(c); })
    .catch(function(){ /* silêncio: o HTML já tem o texto certo */ });
})();
