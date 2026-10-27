# ⚡ IMAGEX.AI v5.6.1

Autonomous platform for intelligent extraction, organization, and inspection of web albums and videos in their original maximum resolution. 🚀🔍

---

## ⚡ What's New in v5.6.1 (Release Notes)

* 🎯 **Precision Media Classification (Zero False-Positive GIFs):**
  * **Strict Pure GIF Isolation:** Resolves an issue where ordinary image galleries containing preview animations were incorrectly classified under Animated GIFs. Albums are now strictly classified as Animated GIFs only when `photoCount === 0 && gifCount > 0`.
  * **Truncated Feeds & Preview Resilience:** Hardened `getAlbumMediaSummary` to accurately compute photo counts across truncated preview feeds and large galleries (e.g. 392+ items), preventing preview thumbnails from dominating gallery classification.
  * **Accurate Filter Matching:** Refined `matchesAlbumMediaFilter` and tags normalization to guarantee photo collections appear cleanly in the Photo Albums tab.

* 📁 **Folder Destination Sanitization & Healing:**
  * Cleaned up legacy corrupted folder tags (`"My Fun new Collection"`) across frontend views (`HomeView`, `MultiAlbumView`, `BatchQueueView`), client-side storage, and backend album persistence.
  * Standardized folder defaults cleanly to `"Geral"` or designated target collections.

---

## 🌟 What's New in v5.6 (Release Notes)

* 🔄 **Autonomous Auto-Update Engine (Dual-Mode):**
  * **GitHub Release Discovery:** Automated background version detection querying GitHub Releases with SemVer comparison and a 15-minute in-memory cache (`/api/updates/check`).
  * **One-Click Autonomous Update:** Performs end-to-end updates automatically with live step reporting, dependency validation, Vite production rebuilds, and safe application reloading.
  * **Dual Execution Architecture:**
    * **Source / Git Repository Mode:** Autonomous `git fetch` + `git pull origin main`, environment validation, and optimized frontend bundle generation.
    * **Windows Standalone Executable (.exe) Mode:** Downloads new compiled executable assets from GitHub releases and performs an atomic background binary swap via `apply_update.bat` after process termination.
  * **Modern Accessible Dialog:** Native `<dialog>` component adhering to modern web guidance with scroll containment (`overscroll-behavior: contain`), accessible naming (`aria-labelledby`), and in-progress cancel guards to avoid interrupted builds.
  * **Realtime Progress & Live Terminal Logs:** Visual progress bar (0% to 100%), 4-stage checklist, and collapsible terminal window streaming compilation and synchronization logs.
  * **User Choice & Version Dismissal:** Options to "Update Now", "Remind Later", or "Ignore this Version" (remembered in `localStorage`).
  * **UI & Settings Integration:**
    * Clickable version badge in the Sidebar header with animated pulsating update indicators.
    * Dedicated "System Updates" control card in Settings with a manual "Check for Updates" trigger.

---

## 🌟 What's New in v5.5 (Release Notes)

* ⚡ **High-Performance Library Streaming & Compression:**
  * In-memory serialization cache (`LibraryResponseCache`) with fast gzip compression for `/api/albums`, `/api/videos`, and `/api/jobs`.
  * Cursor-based pagination (`X-Library-Paging: cursor`) and HTTP ETag 304 caching for album and active task feeds.
  * Optimized folder discovery by passing pre-collected video arrays, avoiding redundant filesystem traversals.
* 📜 **Virtual Collections & Smooth Render Windowing:**
  * Zero-lag virtualization (`VirtualCollection.tsx`) with row geometry caching (`measuredHeights`) and binary search range windowing.
  * Preserved table column widths with `StableVirtualTable` across dynamic viewport transitions.
  * Coalesced `localStorage` writes (`deferredStorage.ts`) with automatic flush on page unload.
* 🎬 **Interactive Climax Shorts Experience:**
  * Drag-and-hover timeline scrubber with floating timestamp tooltips, thumb indicator, and seek precision.
  * Synchronized native desktop and browser fullscreen (`toggleAppFullscreen`).
  * Auto-hiding controls timeout, trackpad wheel debouncing, and video error recovery with automatic skip/retry.
  * Persistent `shortsActiveIndex` preserved across tab navigation in store.
* 🔍 **Advanced Duplicate & Similarity Scanning:**
  * Structural duplicate album scan (`duplicate_album_scan.py`) and exact video duplicate resolution (`duplicate_video_scan.py`).
  * Local video similarity detection (`video_similarity.py`) identifying identical and alternative resolution variants.
  * Guarded batch cleanup and atomic deletion with automatic state rollback on failure.
* 🧬 **Binary-Verified Media Classification:**
  * Container-level binary inspection (`media_classification.py` and `mediaClassification.ts`) checking `VP8X` flags for WebP and Pillow frame counts for GIF/PNG/WebP.
  * Authoritative binary facts (`is_animated`, `animation_checked`) override misleading URL extensions.
* 🛡️ **Copy Sanitization & Legitimate Media Framing:**
  * Streamlined UI descriptions focusing on legitimate web galleries, creative photography portfolios, and direct media pages.
  * Replaced ambiguous take-down notices with neutral unavailable/expired stream statuses.
* ☁️ **Local Data Safety & Cloud Isolation:**
  * Guarded all Hugging Face Cloud sync routines with explicit `is_auto_cloud_sync_enabled()` checks to prevent unexpected remote uploads when auto-sync is disabled.
* 🌐 **Automation & Cloudflare Utilities:**
  * Added `start_all.bat` and `start_cloudflare_tunnel.bat` for one-click orchestration on port 8100.

---

## 🌟 What's New in v5.4 (Release Notes)

* 🚀 **Multi-Page Deep Crawling & Live Streaming Scanner:**
  * Web Video Scraper now seeks up to 5,000 items and 50 subsequent pages with real-time SSE streaming (`/api/video-scraper/scan-page-stream`).
  * Multi-Album Explorer crawls up to 50 pages dynamically with live telemetry and instant abort capability.
* ⚡ **High-Performance Infinite Scroll & Virtualization:**
  * Progressive lazy rendering (48-item batches) via Intersection Observers in Web Video Scraper and Multi-Album views, eliminating DOM lag.
* 🔄 **Video Stream Renewal & Link Healing:**
  * Auto-renew expired direct video stream URLs via `/api/videos/renew-streams` while preserving IDs, folders, and favorites.
  * Album stream updates automatically propagate to the Video Gallery.
* 🏷️ **Categorical Video Origin Filtering:**
  * Filter video collections by origin: All, Local PC, Web Stream (0 MB local disk footprint), Hugging Face Cloud, and Broken links.
* ☁️ **Direct Cloud Storage Backup:**
  * Backup local videos directly to Hugging Face Cloud Storage with timestamp healing (`_migrate_origins`).
* 🛡️ **Trash Service & Filesystem Hardening:**
  * Full lifecycle support for stream-only videos in trash (move, restore, permanent delete) with complete climax highlight preservation.
  * Windows filename and folder sanitization preventing reserved device name conflicts.
* 📌 **Mini Task Dock & Enhanced Scraper:**
  * Multi-task switcher with interactive pills, task wrapping, and horizontal scrolling.
  * Unified standard port **8100** across all configurations and build scripts.

---

## 🌐 English Guide

### 🚀 How to Start the App and Server

#### 1. Native Desktop Mode (pywebview Window) 🖥️
Starts the background server and opens the native application window:
```powershell
python -m src.main
```

---

#### 2. Local Web Server Mode (Browser Only) 🌐
Runs exclusively the FastAPI backend without opening a native window (ideal for accessing via Chrome/Edge or from mobile devices on your local Wi-Fi):

```powershell
python -m src.main --server --port 8100
```

> 📱 **Browser Access:**
> * **On local PC:** `http://localhost:8100`
> * **On Mobile / Local Network:** `http://<YOUR_LOCAL_IP>:8100`

---

#### 3. Direct CLI Mode (Command Line Investigation) 🕵️‍♂️
Runs autonomous investigation directly for a specific URL via the terminal:

```powershell
python -m src.main "https://example.com/gallery" --headed
```

---

#### 4. Portable Executable (No Python Required) 📦
1. Download `IMAGEX.AI-v5.2-Windows.zip` from the GitHub **Releases** tab.
2. Extract the archive anywhere on Windows.
3. Double-click `main.exe` to run.

---

### 🛠️ Installation & Setup from Source

If setting up the project from scratch:

```powershell
# 1. Create and activate a virtual environment
python -m venv venv
.\venv\Scripts\activate

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Install Playwright Chromium browser
python -m playwright install chromium

# 4. Start the application
python -m src.main
```

To develop the frontend, start the server on port 8100 in one terminal and run
`npm install` followed by `npm run dev` inside `frontend-mobile-preview` in
another. Vite forwards API requests to `http://127.0.0.1:8100`.

---

### ⚙️ How to Build the Executable (.exe) 🔨

To compile the frontend with Vite and package everything into `dist/main.exe`:

1. Simply double-click the **`build_executable.bat`** script in the project root.
2. The script will automatically:
   * Build the frontend (`npm run build`).
   * Install the Python and PyInstaller dependencies from `requirements-build.txt` and verify Playwright Chromium.
   * Generate the standalone portable executable via PyInstaller in the `dist/` directory.

---

### 📂 Directory & Media Structure 📁

All downloaded media and metadata are dynamically persisted in the project root:

* 📁 `data/albums/` — Downloaded high-resolution galleries and images.
* 📁 `data/videos/` — Video media captured by the extractor.
* 📁 `data/trash/` — Recycled and discarded media items.

<br>

---

## 🇧🇷 Guia em Português

### 🌟 Novidades da Versão 5.2

* 🎬 **Experiência Imersiva nos Shorts:** Feed limpo de ponta a ponta com botão discreto de saída e detecção inteligente de clímax (Ouro, Prata, Bronze).
* 🔊 **Áudio Persistente:** Ao ativar o som em um vídeo, o áudio continua ligado nos próximos vídeos durante a rolagem.
* ⚡ **Pré-carregamento Inteligente com Proteção de Banda:** O próximo vídeo só inicia o pré-carregamento e detecção de clímax após o vídeo atual estar 100% bufferizado no navegador, garantindo prioridade total de rede ao vídeo em reprodução.
* 🌐 **Padronização na Porta 8100:** Porta padrão atualizada para 8100 em todos os lançadores e serviços.
* 🛡️ **Arquitetura Limpa e Modular:** Padronização de perfis de rede, suíte de testes e desacoplamento de provedores.

---

### 🚀 Como Iniciar o App e o Servidor

#### 1. Modo Desktop Nativo (Janela pywebview) 🖥️
Abre o servidor em segundo plano e exibe a janela nativa do aplicativo:
```powershell
python -m src.main
```

---

#### 2. Modo Servidor Web Local (Apenas Navegador) 🌐
Inicia exclusivamente o backend FastAPI sem abrir nenhuma janela na tela (ideal para acessar pelo Chrome/Edge ou por outros dispositivos como celular na rede local):

```powershell
python -m src.main --server --port 8100
```

> 📱 **Acesso no navegador:**
> * **No PC local:** `http://localhost:8100`
> * **No Celular/Wi-Fi:** `http://<SEU_IP_LOCAL>:8100`

---

#### 3. Modo CLI Direto (Investigação por Linha de Comando) 🕵️‍♂️
Executa a investigação autônoma diretamente para uma URL específica pelo terminal:

```powershell
python -m src.main "https://exemplo.com/galeria" --headed
```

---

#### 4. Executável Portátil (Sem precisar de Python) 📦
1. Baixe o arquivo `IMAGEX.AI-v5.2-Windows.zip` na aba de **Releases** do GitHub.
2. Extraia a pasta em qualquer lugar do Windows.
3. Dê dois cliques em `main.exe` para rodar.

---

### 🛠️ Como Instalar e Rodar pelo Código-Fonte

Caso esteja configurando o projeto do zero:

```powershell
# 1. Criar e ativar o ambiente virtual
python -m venv venv
.\venv\Scripts\activate

# 2. Instalar dependências Python
pip install -r requirements.txt

# 3. Instalar o navegador Chromium do Playwright
python -m playwright install chromium

# 4. Iniciar a aplicação
python -m src.main
```

Para desenvolver o frontend, inicie o servidor na porta 8100 em um terminal e
execute `npm install` e `npm run dev` dentro de `frontend-mobile-preview` em
outro. O Vite encaminha as chamadas da API para `http://127.0.0.1:8100`.

---

### ⚙️ Como Compilar o Executável (.exe) 🔨

Para compilar o frontend com Vite e empacotar tudo no `dist/main.exe`:

1. Basta dar dois cliques no script **`build_executable.bat`** na raiz do projeto.
2. O script vai automaticamente:
   * Rodar o build do frontend (`npm run build`).
   * Instalar as dependências Python e o PyInstaller de `requirements-build.txt` e verificar o Chromium do Playwright.
   * Gerar o executável único portátil via PyInstaller na pasta `dist/`.

---

### 📂 Estrutura de Pastas e Mídias 📁

Todas as mídias e dados baixados são persistidos dinamicamente na raiz:

* 📁 `data/albums/` — Galerias e imagens baixadas em alta resolução.
* 📁 `data/videos/` — Vídeos capturados pelo extrator.
* 📁 `data/trash/` — Lixeira e mídias descartadas.
