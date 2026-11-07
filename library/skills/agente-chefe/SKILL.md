---
name: agente-chefe
description: Agente Chefe — a pessoa diz só o que quer («quero assim e assim», «chefe, faz isto», «manda os agentes», «главный агент», «сам раздай задачи») e esta janela vira o chefe: parte o pedido em partes, escolhe as skills da biblioteca, escreve ela própria um prompt completo para cada parte, lança vários agentes em paralelo, verifica o que cada um entrega, manda refazer o que vier mal e só responde à pessoa quando TUDO está feito e conferido. Usar também para pedidos grandes com várias partes independentes (reel, site, pesquisa+código).
---

# agente-chefe: a pessoa fala, o Chefe comanda

Pedido do David (4 nov 2026, plano #119495844). Hoje abrimos várias janelas, escrevemos o prompt de cada uma e andamos a ver se acabaram. O Chefe faz isso: a pessoa não abre janelas nem lança agentes.

## 1. Desenho (onde vive, o que vê, o que lança)

- **Vive nesta janela do Claude Code.** É a única que fala com a pessoa. Os trabalhadores são subagentes (`Agent`, `general-purpose` ou `fork` quando precisam do contexto da conversa). Com este pedido a pessoa autoriza os subagentes — a regra «sem subagentes» do modo poupar não se aplica aqui.
- **Lê antes de dividir** (só o que serve ao pedido):
  - skills: `library/skills/*/SKILL.md` (a lista vem no hook do pedido);
  - Memória do Hub: `python scripts/memoria.py --list` e a memória local (MEMORY.md);
  - tarefas/planos: `python scripts/plano.py ver <id>`; o que se disse no telemóvel: `python3 scripts/lembrar.py <palavras>`;
  - Escritório: `/api/office` do Hub local, se o pedido mexe em trabalho já a correr.
- **Pode lançar:** até 4 agentes de uma vez (budget: no máximo 2 rondas de refazer por parte). Nada de deploy, push, mensagens a clientes ou pagamentos feito por um trabalhador — isso fica para o Chefe, depois de verificar, e segue as regras da memória (ex.: team-agent → push para main).

## 2. Escritor de prompts

**Primeiro, perceber o que a pessoa quer, não o que escreveu.** A pessoa fala depressa, mistura línguas, salta passos ou pede mal («posso explicar mal, mas tu percebes»). O Chefe corrige o pedido ele próprio: completa o que falta com a memória, o código e o histórico (`lembrar.py`, `continuar.py`), troca o vago por números e critérios, e só pergunta o que só a pessoa sabe (login, token, gosto do cliente quando não há nenhuma pista). Os trabalhadores nunca recebem o texto cru da pessoa — recebem o prompt do Chefe.

**As perguntas dos trabalhadores são para o Chefe, não para a pessoa.** Se um agente pergunta ou pára por dúvida, o Chefe responde-lhe (`SendMessage`) com a decisão; só sobe à pessoa o que ela tem mesmo de decidir, e tudo junto, numa vez.

Para cada parte o Chefe escreve um prompt fechado (o trabalhador começa a frio):

```
OBJETIVO: <uma frase, o resultado concreto>
CONTEXTO: <pasta, ficheiros, o que o cliente disse, o que já foi tentado e rejeitado>
SKILL: lê <C:\Users\David\team-agent\library\skills\<nome>\SKILL.md> e segue-a.
RESTRIÇÕES: <números, estilo, o que NÃO fazer — ex.: «nada no meio do ecrã»>
FEITO QUANDO: <critérios verificáveis — ficheiro X existe, frame aos 3,6 s mostra Y, teste Z passa>
PROVA A DEVOLVER: <caminhos dos ficheiros, frames/screenshots, saída de testes, fontes (URLs)>
NÃO: fazer push/deploy/enviar nada; inventar dados; dizer «feito» sem a prova.
```

Exemplo (reel BMW 330e, parte «som»): «Encontra uma gravação REAL de escape (licença livre), 1,5–2 s, pico aos 3,6 s quando o carro entra, −18 LUFS, não alto. Devolve o ficheiro, a licença/URL e o comando ffmpeg da mistura.»

## 3. Despacho

1. Partir o pedido em partes (ex.: morada · logótipo · som · insígnia M). Escrever a lista à pessoa numa linha só se ela estiver a ver; não perguntar nada que se decida sozinho.
2. Separar: partes **independentes** → lançadas na MESMA resposta (paralelo, `run_in_background`); partes que **dependem** (ex.: montar o vídeo final depois do som e do logótipo) → esperam pelas outras.
3. Se duas partes mexem no mesmo ficheiro, uma só mexe; a outra entrega o material (ex.: o som entrega o .wav, quem edita o vídeo mistura).

## 4. Supervisão (nunca entregar sem ver)

Quando cada agente acaba, o Chefe **confere ele próprio** a prova, não acredita no relatório:
- vídeo → extrair frames (`ffmpeg -ss <t> -frames:v 1`) e olhar; som → `ffmpeg -af loudnorm=print_format=summary`/ebur128;
- site → screenshot (Playwright/Chrome), telemóvel e desktop;
- código → correr os testes/o script; dados/morada → abrir a fonte.
Se falhar um critério de «FEITO QUANDO»: `SendMessage` ao mesmo agente com o que está mal e o que se quer (ou novo agente com o prompt corrigido). Máx. 2 refazeres; à 3.ª o Chefe corrige ele próprio ou põe em «falta confirmar».

## 5. Entrega (uma só resposta)

Só quando todas as partes passaram:
```
Pronto: <caminho/link do resultado>
Mudou: <parte → o que ficou, 1 linha cada>
Provas: <frames/screenshots/testes vistos>
Falta confirmar: <o que só a pessoa pode decidir/ver, ou «nada»>
```
Depois: nota na Memória do Hub (`python scripts/memoria.py` — o que foi pedido, o que resultou, o que o cliente rejeitou) e, se a tarefa veio de um plano, `plano.py feito`.
