---
name: reel-stand-auto
description: Reel vertical (9:16) de stand de automóveis a partir de vídeo FILMADO — o apresentador fala, legendas palavra-a-palavra junto à cabeça, palavra-herói gigante atrás da pessoa, legendas pequenas no b-roll, cortes whip-pan, logótipo do stand, cartão final com morada e @, som real de escape quando o carro entra, insígnia M na legenda, marca TEN FOLD discreta. USE quando pedirem "reel do carro", "vídeo do stand", "editar o vídeo do Vasco", "reel para a F. Fernandes", "legendas no reel", "pôr som de escape", "pôr o M / pack M", "mudar a morada no vídeo", "marca Ten Fold no vídeo", "ролик машины", "видео для автосалона", "звук выхлопа", "М-пакет", или quando chega um vídeo de carro filmado para montar. Não é para motion graphics gerados do zero (isso é motion-reel-codigo).
---

# Reel de stand automóvel (vídeo filmado)

Exemplo real: `exemplo/BMW_330e_final.mp4` (F. Fernandes Automóveis, Benedita, 4 nov 2026) e `exemplo/folha.jpg` (5 momentos: fala, carro a entrar, legenda com insígnia M, morada, cartão final). Projeto original: `C:\Users\David\reel-cortes` no PC do David.

## Pipeline (3 comandos)
1. `python render.py` → `reel_novo.mp4` (≈20 min, 1080x1920, 30 fps). `python render.py 21.8 35.5` → `stills/` para ver frames sem render completo (stills saem a metade do tamanho).
2. `python extras.py` → `exhaust.wav` sintético (só de reserva) — o bom é `exhaust_real.wav` (gravação real, ver abaixo).
3. `python entregar.py` → `enviar/reel_BMW_330e.mp4` (marca TEN FOLD + som de escape) e `enviar/fragmentos/` (cortes).
Depois: copiar para `PRONTO/<CARRO>_FINAL_<dd-mm>.mp4` — uma só pasta, um só ficheiro, para ninguém se confundir.

## Onde mexer em render.py
- Linha do tempo: lista `P` de `dict(k=..., s=início, e=fim, L=[[(t, "PALAVRA", estilo), ...]])`. k: `talk` (fala junto à cabeça), `cap` (legenda pequena maiúscula no b-roll), `brand` (logótipo + «Vem visitar-nos» + morada), `end` (cartão com @), `sign`.
- Estilos: `l` fina, `b` bold itálico (destaque), `h` herói gigante atrás da pessoa (máscara rembg), `c` legenda.
- Morada: `draw_location` → `t2`. Confirmar SEMPRE a morada em auto.pt / piscapisca / Facebook do stand antes (F. Fernandes: «IC2 · Km 80,9 · Venda das Raparigas, Benedita»).
- @ do Instagram: no cartão `end`. Atenção: o Instagram sem login devolve página de erro mesmo para contas que existem — confirmar por pesquisa web, não pelo HTML.
- Insígnia M: `m_emblem()` — a palavra «M» com estilo `c` vira três riscas (azul claro, azul escuro, vermelho) + M itálico. Pôr a insígnia NO LUGAR da letra na legenda, nunca um crachá solto no meio do ecrã (o cliente achou «muito feio»).
- Logótipo do stand: `logo/logo_branco.png`, `logo/logo_cor.png` (marca de água a 42% em cima ao centro).

## entregar.py
- Marca TEN FOLD (`amg-site/img/tf-mark.png`): branca monocromática, 32% opacidade, 38 px, canto superior direito, margem 40 px. Pedido do Marco: transparente, sem cor, pequena num canto — «só para marcar presença», não somos grandes.
- Escape: `exhaust_real.wav` com `adelay` = momento em que o carro entra menos ~0,3 s (aqui 3300 ms → pico aos 3,64 s, carro nítido aos 3,8 s). Cauda baixada a 55% depois de 0,55 s; volume 0,85; a −18 LUFS. Regra do cliente: o som tem de casar com a imagem, curto (1,5–2 s), atrativo mas não alto.
- Codificação de envio: 3000k, aac 128k, faststart.

## Som de escape real
Sintético soa falso — usar gravação real. Fonte usada: Wikimedia Commons «BMW E46 – engine and exhaust sound», CC BY 3.0 (crédito na descrição do post; texto em `exemplo/SOM-LICENCA.txt`). Cortar 1,8 s com um único «blip», fade-in 30 ms, fade-out 400 ms, corte de agudos 6 kHz, compressão leve.

## Entrega ao cliente
- Abrir a pasta com o ficheiro selecionado e copiar o ficheiro para a área de transferência (PowerShell `Clipboard.SetFileDropList`) → no WhatsApp basta Ctrl+V no chat: fica anexado, NÃO enviado. Nunca enviar sem ele carregar em enviar.

## Erros que já aconteceram
- Render completo interrompido deixa `reel_novo.mp4` corrompido («moov atom not found») — voltar a renderizar.
- Mudanças que afetam todos os frames (marca, logótipo): parar o render em curso e juntar tudo num só render.
- `crop` em stills falha porque os stills são 540x960.
