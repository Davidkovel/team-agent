---
name: plano-partilhado
description: Plano partilhado da equipa no Escritório: quando a pessoa manda um plano de trabalho com vários passos para os agentes fazerem («faz como um plano», «estou a acabar os tokens», «para o meu parceiro continuar»), ou pede para continuar um plano de outro sócio. O plano fica no Hub de todos os PCs, cada passo feito é marcado, e quem vem a seguir continua do primeiro passo por fazer sem parar o trabalho.
---

# plano-partilhado: uma cabeça só para a equipa

Pedido do David (23 out 2026): «eu mando o plano todo, ele começa a fazer; acabo os tokens, entra um parceiro lá no
escritório, vê as cenas e consegue acrescentar e continuar». O trabalho não pára quando um Claude pára.

O plano vive no Hub (`routers/plans.py`, tabela `plans`, vai por sync aos três PCs) e aparece no Escritório em
**Missões › Planos**: passos com quem fez o quê, notas de passagem, quem está nele agora. O sócio carrega
**«Continuar»** e cola o prompt numa janela nova do Claude dele.

Tudo com `scripts/plano.py` na pasta `team-agent` (`.venv\Scripts\python scripts\plano.py` no Windows).

## Quando recebes um plano novo

1. Parte-o em passos curtos e verificáveis (5 a 15), pela ordem em que se fazem. Cada passo diz o resultado, não a intenção
   («página X publicada com os 3 preços», não «trabalhar na página»).
2. Regista-o **antes de começar**, a partir da pasta do projeto (fica guardada a pasta e o git remote):
   `python <team-agent>\scripts\plano.py novo "Título" "Objetivo e regras em 2-4 frases" "passo 1" "passo 2" ...`
3. Diz à pessoa o número do plano numa linha.

## Enquanto trabalhas

- Cada passo acabado: `plano.py feito <n> <passo> "o que ficou feito, onde, e o commit"`. Logo, não no fim.
- Descobriste trabalho que falta: `plano.py passo <n> "passo novo"`.
- Faz commit e push do que acabaste em cada passo: o parceiro noutro PC só vê o que está no git.

## Antes de parar (tokens a acabar, limite do plano acima de ~85%, ou a pessoa sai)

Sempre, mesmo a meio de um passo:
`plano.py nota <n> "onde parei, o que está a meio e em que ficheiro, o que não fazer, o próximo comando"`
e commit + push do que estiver feito (um WIP claro é melhor que trabalho preso num PC). Depois `plano.py sai <n>`.

## Quando continuas um plano

1. `plano.py ver <n>`: objetivo, passos, notas. Lê a última nota com atenção: é a passagem de turno.
2. `plano.py estou <n>`, para o Escritório mostrar que és tu.
3. Se o plano é de outra pasta: `git pull` nela, ou clona o `git` que o plano mostra.
4. Segue do primeiro passo por fazer, sem perguntar o que já está decidido no plano. Marca como acima.
5. Todos feitos e verificados: `plano.py fechar <n>`.

## Regras

- Um plano por trabalho grande; uma tarefa de um passo não precisa de plano.
- Nada de segredos nas notas nem nos passos (passwords, tokens, chaves): vão por sync para toda a equipa.
- Notas curtas, em português de Portugal, escritas para alguém que nunca viu a conversa.
