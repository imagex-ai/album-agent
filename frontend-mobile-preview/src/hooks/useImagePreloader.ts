import { useEffect, useRef } from 'react';

// Cache global de URLs decodificadas com sucesso na GPU
const preloadedUrls = new Set<string>();
const pendingUrls = new Set<string>();

/**
 * Verifica de forma síncrona se uma imagem já foi pré-carregada e decodificada na GPU.
 */
export function isImagePreloaded(url: string): boolean {
  if (!url) return false;
  return preloadedUrls.has(url);
}

/**
 * Pré-carrega e decodifica na GPU uma única imagem de forma assíncrona.
 * Utilizado para pré-aquecimento instantâneo ao passar o mouse (hover) em cards ou miniaturas.
 * Inclui timeout de proteção de 8s e prevenção contra memory leak.
 */
export function preloadSingleImage(url?: string): void {
  if (!url || preloadedUrls.has(url) || pendingUrls.has(url)) return;
  pendingUrls.add(url);
  const img = new Image();
  img.decoding = 'async';

  let cleaned = false;
  const timeoutId = setTimeout(() => {
    if (!cleaned) {
      cleaned = true;
      pendingUrls.delete(url);
      img.onload = null;
      img.onerror = null;
      img.src = '';
    }
  }, 8000);

  const onDone = (success: boolean) => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timeoutId);
    pendingUrls.delete(url);
    if (success) {
      preloadedUrls.add(url);
    }
  };

  img.src = url;

  if ('decode' in img && typeof img.decode === 'function') {
    img
      .decode()
      .then(() => onDone(true))
      .catch(() => {
        img.onload = () => onDone(true);
        img.onerror = () => onDone(false);
      });
  } else {
    img.onload = () => onDone(true);
    img.onerror = () => onDone(false);
  }
}

export interface PreloadableImage {
  originalUrl?: string;
  rawOriginalUrl?: string;
  thumbnailUrl?: string;
  [key: string]: any;
}

export interface UseImagePreloaderOptions {
  images: PreloadableImage[];
  currentIndex: number;
  enabled?: boolean;
  windowSize?: number;
  mode?: 'thumbnail' | 'original' | 'hybrid';
  debounceMs?: number;
  waitForCurrentLoaded?: boolean;
  isCurrentLoaded?: boolean;
}

/**
 * useImagePreloader v5.5 (Active-Focus & Zero-Congestion Pipeline)
 *
 * Realiza o pré-carregamento preditivo e assíncrono em background
 * das fotos adjacentes (i+1, i+2, i-1) utilizando HTMLImageElement.decode()
 * com CANCELAMENTO IMEDIATO de requisições obsoletas e PRIORIDADE ABSOLUTA
 * para a foto ativa na tela.
 *
 * 1. Debounce Adaptativo: não sobrecarrega a rede quando o usuário navega rapidamente por setas/slider.
 * 2. Abort Imediato: ao trocar de foto, todas as requisições de preload anteriores têm img.src = ''
 *    imediatamente, liberando as 6 conexões TCP do navegador para a foto em foco.
 * 3. Foco na Foto Ativa: se waitForCurrentLoaded=true, aguarda a foto atual estar pronta na GPU
 *    antes de permitir que as fotos vizinhas comecem a consumir largura de banda.
 */
export function useImagePreloader({
  images,
  currentIndex,
  enabled = true,
  windowSize = 2,
  mode = 'original',
  debounceMs = 250,
  waitForCurrentLoaded = true,
  isCurrentLoaded = true,
}: UseImagePreloaderOptions): void {
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Rastreia recursos ativos para cancelamento imediato ao navegar
  const activeResourcesRef = useRef<{
    images: HTMLImageElement[];
    timeouts: NodeJS.Timeout[];
    urls: string[];
  }>({ images: [], timeouts: [], urls: [] });

  // Limpa e aborta todas as requisições de preload em andamento
  const abortActivePreloads = () => {
    activeResourcesRef.current.timeouts.forEach((t) => clearTimeout(t));
    activeResourcesRef.current.images.forEach((img) => {
      img.onload = null;
      img.onerror = null;
      img.src = ''; // Libera o socket HTTP/1.1 imediatamente no navegador
    });
    activeResourcesRef.current.urls.forEach((u) => {
      pendingUrls.delete(u);
    });
    activeResourcesRef.current = { images: [], timeouts: [], urls: [] };
  };

  useEffect(() => {
    // Aborta requisições do índice anterior imediatamente
    abortActivePreloads();

    // Se desabilitado, ou álbum vazio, ou apenas 1 foto, ou índice inválido
    if (!enabled || !imagesRef.current || imagesRef.current.length <= 1 || currentIndex < 0) {
      return;
    }

    const currentIdx = currentIndex;

    // Se configurado para aguardar a foto atual e ela ainda não carregou:
    // NUNCA inicia preload de outras imagens para não competir por banda/sockets com a foto em foco!
    if (waitForCurrentLoaded && !isCurrentLoaded) {
      return;
    }

    const initialDelay = debounceMs;

    const settleTimer = setTimeout(() => {
      if (currentIdx !== currentIndex) return;

      const total = imagesRef.current.length;
      const targetIndices = new Set<number>();

      // Adiciona as próximas imagens à frente (prioridade máxima para navegação para a direita)
      for (let offset = 1; offset <= windowSize; offset++) {
        targetIndices.add((currentIdx + offset) % total);
      }

      // Adiciona a imagem anterior para retorno instantâneo (navegação para a esquerda)
      targetIndices.add((currentIdx - 1 + total) % total);

      // Remove o próprio índice atual
      targetIndices.delete(currentIdx);

      // Coleta as URLs candidatas ao preload de acordo com o modo
      const urlsToPreload: string[] = [];
      for (const idx of targetIndices) {
        const item = imagesRef.current[idx];
        if (!item) continue;

        const origUrl = item.originalUrl || item.rawOriginalUrl;
        const thumbUrl = item.thumbnailUrl;

        if (mode === 'thumbnail') {
          const u = thumbUrl || origUrl;
          if (u && !preloadedUrls.has(u) && !pendingUrls.has(u) && !urlsToPreload.includes(u)) {
            urlsToPreload.push(u);
          }
        } else {
          const u = origUrl || thumbUrl;
          if (u && !preloadedUrls.has(u) && !pendingUrls.has(u) && !urlsToPreload.includes(u)) {
            urlsToPreload.push(u);
          }
        }
      }

      // Pré-carrega de forma sequencial (1 imagem por vez) para nunca saturar o pool de conexões
      let preloadIndex = 0;
      const loadNext = () => {
        if (preloadIndex >= urlsToPreload.length || currentIdx !== currentIndex) return;
        const url = urlsToPreload[preloadIndex++];
        pendingUrls.add(url);
        activeResourcesRef.current.urls.push(url);

        const img = new Image();
        img.decoding = 'async';
        activeResourcesRef.current.images.push(img);

        let cleaned = false;
        const tId = setTimeout(() => {
          if (!cleaned) {
            cleaned = true;
            pendingUrls.delete(url);
            img.onload = null;
            img.onerror = null;
            img.src = '';
            loadNext();
          }
        }, 8000);
        activeResourcesRef.current.timeouts.push(tId);

        const onDone = (success: boolean) => {
          if (cleaned) return;
          cleaned = true;
          clearTimeout(tId);
          pendingUrls.delete(url);
          if (success) {
            preloadedUrls.add(url);
          }
          // Avança para a próxima miniatura/imagem apenas após a conclusão da anterior
          loadNext();
        };

        img.src = url;

        if ('decode' in img && typeof img.decode === 'function') {
          img
            .decode()
            .then(() => onDone(true))
            .catch(() => {
              img.onload = () => onDone(true);
              img.onerror = () => onDone(false);
            });
        } else {
          img.onload = () => onDone(true);
          img.onerror = () => onDone(false);
        }
      };

      loadNext();

      // Mantém o cache sob controle para não consumir memória infinita no navegador/WebView2
      if (preloadedUrls.size > 500) {
        const urlsArray = Array.from(preloadedUrls);
        const toRemove = urlsArray.slice(0, 150);
        toRemove.forEach((u) => preloadedUrls.delete(u));
      }
    }, initialDelay);

    return () => {
      clearTimeout(settleTimer);
      abortActivePreloads();
    };
  }, [currentIndex, enabled, windowSize, mode, debounceMs, waitForCurrentLoaded, isCurrentLoaded]);
}
