/**
 * Desktop Platform Service (PyWebView Integration)
 *
 * Princípio Aberto/Fechado (OCP - SOLID):
 * Isola completamente a comunicação nativa com o executável Windows (.exe).
 * - No Google Chrome ou qualquer navegador padrão: 'isDesktopApp()' retorna false e
 *   'setDesktopFullscreen' não realiza nenhuma operação, garantindo que o comportamento
 *   original do Chrome (HTML5 requestFullscreen puro cobrindo a tela da foto) permaneça 100% intacto.
 * - No executável Windows (.exe / PyWebView): interage com a janela nativa do Windows Forms/WebView2,
 *   trazendo a janela física para tela cheia sem bordas (borderless fullscreen) cobrindo 100% do monitor,
 *   escondendo a barra de títulos do Windows e a barra de tarefas.
 */

if (typeof window !== 'undefined') {
  window.addEventListener('pywebviewready', () => {
    (window as any).__pywebview_ready__ = true;
  });
}

export const isDesktopApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).pywebview || (window as any).__pywebview_ready__);
};

const DESKTOP_FULLSCREEN_EVENT = 'imagex:desktop-fullscreen-change';
type FullscreenSetter = (fullscreen: boolean) => void;
const mediaFullscreenOwners = new WeakMap<FullscreenSetter, { openedWindow: boolean; revision: number }>();
const mediaRequests = new WeakMap<FullscreenSetter, number>();
let windowRevision = 0;

export const getDesktopFullscreen = async (): Promise<boolean | null> => {
  if (!isDesktopApp()) return null;
  try {
    const api = (window as any).pywebview?.api;
    if (typeof api?.is_fullscreen === 'function') return Boolean(await api.is_fullscreen());
  } catch (err) {
    console.warn('[desktopService] Falha ao consultar tela cheia:', err);
  }
  return null;
};

const notifyDesktopFullscreen = () => window.dispatchEvent(new Event(DESKTOP_FULLSCREEN_EVENT));
export const desktopFullscreenEvent = DESKTOP_FULLSCREEN_EVENT;

export const setDesktopFullscreen = async (fullscreen: boolean): Promise<boolean> => {
  if (!isDesktopApp()) return false;

  try {
    const pyApi = (window as any).pywebview?.api;
    if (pyApi && typeof pyApi.set_fullscreen === 'function') {
      const res = await pyApi.set_fullscreen(fullscreen);
      if (res) notifyDesktopFullscreen();
      return Boolean(res);
    }
  } catch (err) {
    console.warn('[desktopService] Falha ao sincronizar tela cheia nativa do desktop:', err);
  }
  return false;
};

export const toggleDesktopFullscreen = async (): Promise<boolean> => {
  if (!isDesktopApp()) return false;

  try {
    const pyApi = (window as any).pywebview?.api;
    if (pyApi && typeof pyApi.toggle_fullscreen === 'function') {
      const res = await pyApi.toggle_fullscreen();
      if (res) {
        windowRevision++;
        notifyDesktopFullscreen();
      }
      return Boolean(res);
    }
  } catch (err) {
    console.warn('[desktopService] Falha ao alternar tela cheia nativa do desktop:', err);
  }
  return false;
};

export const restoreDesktopWindow = async (): Promise<boolean> => {
  if (!isDesktopApp()) return false;

  try {
    const pyApi = (window as any).pywebview?.api;
    if (pyApi) {
      if (typeof pyApi.restore_window === 'function') {
        await pyApi.restore_window();
      } else if (typeof pyApi.set_fullscreen === 'function') {
        await pyApi.set_fullscreen(false);
      }
      windowRevision++;
      notifyDesktopFullscreen();
      return true;
    }
  } catch (err) {
    console.warn('[desktopService] Falha ao restaurar janela normal:', err);
  }
  return false;
};

/**
 * Alternador Universal de Tela Cheia (100% livre de conflitos e cliques duplos)
 * - No Desktop (.exe): controla exclusivamente a janela nativa física do Windows (evitando loops e bloqueios no WebView2).
 * - No Navegador (Chrome/Edge/Firefox/Safari): executa HTML5 requestFullscreen de forma pura e fluida.
 */
export const isAppFullscreen = (): boolean => {
  if (typeof document === 'undefined') return false;
  const doc = document as any;
  return Boolean(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement
  );
};

export const toggleAppFullscreen = async (
  currentIsFullscreen: boolean,
  setFullscreenState: (fs: boolean) => void
): Promise<boolean> => {
  // No desktop, a mídia só restaura a janela se ela própria a expandiu.
  if (isDesktopApp()) {
    if (currentIsFullscreen) {
      await exitAllFullscreen(setFullscreenState);
      return false;
    }
    const request = (mediaRequests.get(setFullscreenState) || 0) + 1;
    mediaRequests.set(setFullscreenState, request);
    const wasFullscreen = await getDesktopFullscreen();
    if (mediaRequests.get(setFullscreenState) !== request) return false;
    if (wasFullscreen === null) return false;
    const openedWindow = !wasFullscreen;
    const revision = windowRevision;
    if (openedWindow && !await setDesktopFullscreen(true)) return false;
    if (mediaRequests.get(setFullscreenState) !== request) {
      if (openedWindow && revision === windowRevision) await setDesktopFullscreen(false);
      return false;
    }
    mediaFullscreenOwners.set(setFullscreenState, { openedWindow, revision });
    setFullscreenState(true);
    return true;
  }

  // 2. No Navegador Web puro e Mobile (Chrome / Edge / Firefox / Safari):
  // Verifica o estado REAL do DOM para garantir sincronia perfeita
  const doc = typeof document !== 'undefined' ? (document as any) : null;
  const isCurrentlyFs = isAppFullscreen();
  const shouldEnter = !isCurrentlyFs;

  try {
    if (shouldEnter) {
      const el = doc?.documentElement as any;
      const req = el?.requestFullscreen || el?.webkitRequestFullscreen || el?.mozRequestFullScreen || el?.msRequestFullscreen;
      if (req) {
        await req.call(el);
        setFullscreenState(true);
        return true;
      }
    } else {
      const exit = doc?.exitFullscreen || doc?.webkitExitFullscreen || doc?.mozCancelFullScreen || doc?.msExitFullscreen;
      if (exit) {
        await exit.call(doc);
        setFullscreenState(false);
        return false;
      }
    }
  } catch (err) {
    console.warn('[toggleAppFullscreen] HTML5 requestFullscreen:', err);
  }

  setFullscreenState(!currentIsFullscreen);
  return !currentIsFullscreen;
};

/**
 * Fecha a tela cheia da mídia sem encerrar a imersão da janela que já existia.
 */
export const exitAllFullscreen = async (
  setFullscreenState?: (fs: boolean) => void
): Promise<void> => {
  if (setFullscreenState) {
    setFullscreenState(false);
  }

  if (isDesktopApp()) {
    if (setFullscreenState) {
      mediaRequests.set(setFullscreenState, (mediaRequests.get(setFullscreenState) || 0) + 1);
      const owner = mediaFullscreenOwners.get(setFullscreenState);
      mediaFullscreenOwners.delete(setFullscreenState);
      if (owner?.openedWindow && owner.revision === windowRevision) await setDesktopFullscreen(false);
    }
  }

  try {
    const doc = document as any;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
    if (exit && (document.fullscreenElement || (document as any).webkitFullscreenElement)) {
      await exit.call(doc);
    }
  } catch (_) {}
};
