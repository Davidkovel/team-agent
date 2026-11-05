---
name: telemovel
description: Liga o telemóvel e o computador num cérebro só, em qualquer PC da equipa. Usar quando a pessoa escreve só «telemóvel», ou pede para trabalhar no telemóvel como no computador, controlar o computador pelo telemóvel, ou ter o mesmo que o David tem.
---

# telemovel: a palavra que liga tudo

Pedido do David (5 nov 2026): «eles só precisarem de escrever uma palavra e tu instalar tudo o que for preciso para eles e
dizer a informação toda que foi feita e o que eu fiz». A pessoa pode não saber nada de terminal. Faz tudo tu, sem perguntar.
Só lhe pedes o que só ela pode fazer: entrar numa conta, autorizar numa página, carregar num botão, no telemóvel.

## O que fazer

1. Vai à pasta do team-agent e faz `git pull`.
2. Corre `python scripts/nuvem/tudo.py` (no Mac, `python3`). Pode correr as vezes que for preciso.
3. **Sai com 2 (ainda sem nuvem):** segue `docs/nuvem.md`, secção «Marco e Kovel», até ao fim. Pede só o que aquela secção diz
   que só a pessoa pode fazer, um passo de cada vez, em linguagem simples. Depois volta ao passo 2.
4. **Linhas FALTA:** resolve cada uma. Se só a pessoa pode (login do Claude, GitHub), corre o comando por ela e diz-lhe
   exatamente o que carregar. Volta ao passo 2 até só faltar o que ela não quiser fazer.
5. **Testa a sério, com uma mensagem real**, entrando na nuvem:
   `tailscale ssh ubuntu@amg-nuvem` e, lá, `POST http://127.0.0.1:8000/api/auth/auto` dá o token;
   `POST /api/conversas` com `{"text": "..."}` e depois com `{"text": "...", "where": "pc"}`; `GET /api/conversas/<id>` mostra a resposta.
   O teste com `where: "pc"` tem de correr neste computador. Depois do teste, `python scripts/lembrar.py <palavra do teste>`
   encontra a conversa da nuvem ao fim de ~3 min. Só digas que funciona o que viste funcionar.
6. Grava na Memória do Hub, com `scripts/memoria.py`, que esta pessoa ficou ligada, e o que faltou.
7. Diz à pessoa, com palavras simples, o que está abaixo em «O que dizer no fim», com o endereço da app dela.

## O que dizer no fim

**O que o David pediu e está feito (4 e 5 nov):**
- Falas com o Claude no telemóvel (`#/claude` na app da nuvem). Cada conversa continua a mesma sessão, mesmo com o computador desligado.
- A memória é uma só: o que dizes ao Claude no computador chega à nuvem em ~3 min, e o que dizes no telemóvel chega ao
  computador. As conversas são só tuas: nunca vão para os outros sócios.
- Ao começar uma conversa, «No computador» corre o trabalho na pasta real do projeto, com o computador ligado. O que for mais sensível pede-te aprovação no telemóvel.
- Os agentes leem o e-mail da empresa. Nenhum e-mail sai sem um clique teu.

**O que tens de saber:**
- Abre as conversas sempre na app da nuvem. O `#/claude` do Hub do computador não tem agente.
- Com o computador desligado, a nuvem só vê o que está no git.
- Para desligar o agente do computador: `python scripts/nuvem/ligar_pc.py desligar`.

Acrescenta o estado real desta pessoa: as linhas FEITO e FALTA do `tudo.py`, e o que testaste. Se a Memória do Hub tiver novidades sobre isto (`python scripts/memoria.py --list`), conta-as também.
