# DIRETRIZES DE IMUTABILIDADE DO PROJETO (PROJECT RULES)

> [!IMPORTANT]
> **REGRA DE OURO PARA AGENTES, DESENVOLVEDORES E IAs:**
> Os componentes listados abaixo foram homologados, validados empiricamente por benchmarks e declarados **PERFEITOS E IMUTÁVEIS** pelo usuário em 17/10/2026.
> Nenhuma IA ou agente autônomo está autorizado a alterar, refatorar, reescrever ou degradar estes módulos sem consentimento explícito e por escrito do usuário.

---

## 1. Módulos Blindados e Imutáveis

### ⚡ Inteligência de Melhores Momentos & Smart Shorts
- **Arquivo Principal Backend:** [`src/server/smart_shorts_detector.py`](file:///c:/Users/jardi/Desktop/album-agent-main/src/server/smart_shorts_detector.py)
- **Integração de Vídeo Backend:** [`src/server/video_service.py`](file:///c:/Users/jardi/Desktop/album-agent-main/src/server/video_service.py) (Métodos `get_or_detect_smart_highlight` e rotas de highlight em `server.py`)
- **Top 3 Highlights & NMS:**
  - `hl_gold`: Clímax Principal (Ouro)
  - `hl_silver`: Destaque Secundário (Prata)
  - `hl_bronze`: Gancho Dinâmico (Bronze)
  - Supressão Não-Máxima Temporal (NMS) com raio mínimo de 55s para garantir diversidade e evitar cortes sobrepostos.
- **Janela de Duração Configurável:** Suporte a 15s, 30s e 60s (padrão 30s).
- **Curva de Audiência Heatmap:** Prioridade para dados virais do `yt-dlp`.
- **Suíte de Benchmarks & Prova de Conceito:** [`scripts/poc_moment_intelligence/`](file:///c:/Users/jardi/Desktop/album-agent-main/scripts/poc_moment_intelligence/)

### 📱 Experiência de Shorts & Player Frontend
- **Interface dos Shorts:** [`frontend-mobile-preview/src/components/views/ShortsView.tsx`](file:///c:/Users/jardi/Desktop/album-agent-main/frontend-mobile-preview/src/components/views/ShortsView.tsx)
  - Ciclagem de badges: `🥇 Clímax #1` $\rightarrow$ `🥈 Destaque #2` $\rightarrow$ `🥉 Destaque #3` $\rightarrow$ `▶️ Início (0:00)`.
  - Seletor de duração na gaveta de preferências (15s, 30s, 60s).
  - Autoplay contínuo com `playVideoSafely` (nunca travar a rolagem com `isPaused = true`).
- **Player Modal:** [`frontend-mobile-preview/src/components/common/VideoPlayerModal.tsx`](file:///c:/Users/jardi/Desktop/album-agent-main/frontend-mobile-preview/src/components/common/VideoPlayerModal.tsx)
  - Marcadores (notches) visuais no scrubber para os 3 destaques.
  - Botão de salto direto `⚡ Clímax`.

---

## 2. Regra de Não-Destrutividade
- **NUNCA** disparar reanálise ou sobrescrita em massa de metadados da biblioteca sem solicitação explícita do usuário.
- Manter estrita sincronia e paridade entre `album-agent-main` e o workspace irmão `imagex-ai-v5.0`.
