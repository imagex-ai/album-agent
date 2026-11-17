/**
 * useExternalPictureInPicture.ts
 *
 * Hybrid 3-tier OS Picture-in-Picture bridge + opt-in Auto-PiP on tab switch:
 *   Tier 1: Document Picture-in-Picture (window.documentPictureInPicture.requestWindow)
 *   Tier 2: Classic <video>.requestPictureInPicture() / Safari webkitSetPresentationMode
 *   Tier 3: App Floating Mini-Player fallback (onEnterMiniPlayer)
 *
 * Defensively validates runtime methods alongside detectPipCapabilities() and
 * ensures zero unhandled promise rejections when browser policies block Auto-PiP.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { detectPipCapabilities, type PipCapabilities } from './videoPlayerCore';

export type ExternalPipMode = 'none' | 'document' | 'video' | 'mini';

export interface ExternalPipCapabilities extends PipCapabilities {
  hasExternalPip: boolean;
}

export interface DocumentPipWindowLike {
  document: Document;
  addEventListener: (type: string, listener: (event: any) => void, options?: AddEventListenerOptions | boolean) => void;
  removeEventListener?: (type: string, listener: (event: any) => void, options?: EventListenerOptions | boolean) => void;
  close?: () => void;
}

export interface UseExternalPictureInPictureOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  autoPipOnTabSwitch?: boolean;
  autoPipEligible?: boolean;
  autoExitOnTabReturn?: boolean;
  closeDocumentPipOnUnmount?: boolean;
  documentPipWidth?: number;
  documentPipHeight?: number;
  allowMiniFallback?: boolean;
  onEnterMiniPlayer?: () => void;
  onExitMiniPlayer?: () => void;
  onPipEnter?: (mode: Exclude<ExternalPipMode, 'none'>, pipWindow?: Window | null) => void;
  onPipExit?: (previousMode: Exclude<ExternalPipMode, 'none'>) => void;
}

export interface UseExternalPictureInPictureResult {
  pipMode: ExternalPipMode;
  capabilities: ExternalPipCapabilities;
  hasExternalPip: boolean;
  pipWindow: Window | null;
  pipContainer: HTMLElement | null;
  enterPip: (options?: { allowMiniFallback?: boolean }) => Promise<ExternalPipMode>;
  exitPip: () => Promise<void>;
  togglePip: () => Promise<ExternalPipMode>;
}

const DEFAULT_DOC_PIP_WIDTH = 420;
const DEFAULT_DOC_PIP_HEIGHT = 260;

interface VideoElementWithWebkitPip extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
}

interface WindowWithDocumentPip extends Window {
  documentPictureInPicture?: {
    requestWindow?: (options?: { width?: number; height?: number }) => Promise<DocumentPipWindowLike>;
    window?: DocumentPipWindowLike | null;
  };
}

/**
 * Inspects runtime PiP capabilities defensively (checking actual requestWindow /
 * requestPictureInPicture / setActionHandler methods beyond property presence).
 */
export function resolveExternalPipCapabilities(video?: HTMLVideoElement | null): ExternalPipCapabilities {
  const base = detectPipCapabilities();

  const hasWindow = typeof window !== 'undefined';
  const docPipApi = hasWindow ? (window as WindowWithDocumentPip).documentPictureInPicture : undefined;
  const documentPip = Boolean(
    base.documentPip &&
      docPipApi &&
      typeof docPipApi.requestWindow === 'function' &&
      window.isSecureContext !== false
  );

  const hasDoc = typeof document !== 'undefined';
  const vid = video as VideoElementWithWebkitPip | null | undefined;
  const videoElementPermitted = !vid || (typeof vid.requestPictureInPicture === 'function' && !vid.disablePictureInPicture);
  const elementPip = Boolean(
    base.elementPip &&
      hasDoc &&
      (document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled &&
      videoElementPermitted
  );

  const webkitPresentationPip = Boolean(
    vid && typeof vid.webkitSupportsPresentationMode === 'function'
      ? typeof vid.webkitSetPresentationMode === 'function' &&
          vid.webkitSupportsPresentationMode('picture-in-picture')
      : base.webkitPresentationPip
  );

  const hasMsActionHandler = Boolean(
    typeof navigator !== 'undefined' &&
      (navigator as unknown as { mediaSession?: { setActionHandler?: unknown } }).mediaSession &&
      typeof (navigator as unknown as { mediaSession?: { setActionHandler?: unknown } }).mediaSession?.setActionHandler === 'function'
  );
  const autoPipAction = Boolean(base.autoPipAction && hasMsActionHandler && (documentPip || elementPip || webkitPresentationPip));

  return {
    documentPip,
    elementPip,
    webkitPresentationPip,
    autoPipAction,
    hasExternalPip: documentPip || elementPip || webkitPresentationPip,
  };
}

function areCapabilitiesEqual(a: ExternalPipCapabilities, b: ExternalPipCapabilities): boolean {
  return (
    a.documentPip === b.documentPip &&
    a.elementPip === b.elementPip &&
    a.webkitPresentationPip === b.webkitPresentationPip &&
    a.autoPipAction === b.autoPipAction &&
    a.hasExternalPip === b.hasExternalPip
  );
}

function cloneHostStylesToPipWindow(sourceDoc: Document, pipWin: DocumentPipWindowLike): HTMLElement | null {
  const targetDoc = pipWin.document;
  if (!targetDoc) return null;

  try {
    const srcRoot = sourceDoc.documentElement;
    const dstRoot = targetDoc.documentElement;
    if (srcRoot && dstRoot) {
      if (srcRoot.className) dstRoot.className = srcRoot.className;
      const themeAttr = typeof srcRoot.getAttribute === 'function' ? srcRoot.getAttribute('data-theme') : null;
      if (themeAttr && typeof dstRoot.setAttribute === 'function') {
        dstRoot.setAttribute('data-theme', themeAttr);
      }
      if (srcRoot.style?.cssText && dstRoot.style) {
        dstRoot.style.cssText = srcRoot.style.cssText;
      }
    }
    if (sourceDoc.body?.className && targetDoc.body) {
      targetDoc.body.className = sourceDoc.body.className;
    }
  } catch {
    // Best-effort theme sync
  }

  try {
    const sheets = Array.from((sourceDoc as unknown as { styleSheets?: StyleSheetList }).styleSheets || []);
    for (const sheet of sheets) {
      try {
        const rules = Array.from((sheet as CSSStyleSheet).cssRules || []);
        const styleEl = targetDoc.createElement('style');
        styleEl.textContent = rules.map((r) => r.cssText).join('\n');
        targetDoc.head?.appendChild(styleEl);
      } catch {
        const href = (sheet as CSSStyleSheet).href;
        if (href) {
          const linkEl = targetDoc.createElement('link');
          if (typeof linkEl.setAttribute === 'function') {
            linkEl.setAttribute('rel', 'stylesheet');
            linkEl.setAttribute('href', href);
          } else {
            (linkEl as HTMLLinkElement).rel = 'stylesheet';
            (linkEl as HTMLLinkElement).href = href;
          }
          targetDoc.head?.appendChild(linkEl);
        }
      }
    }
  } catch {
    // Graceful fallback when styleSheets unavailable
  }

  if (targetDoc.body && typeof targetDoc.createElement === 'function') {
    const container = targetDoc.createElement('div');
    if (typeof container.setAttribute === 'function') {
      container.setAttribute('data-uvp-doc-pip-root', 'true');
    }
    if (container.style) {
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.margin = '0';
    }
    targetDoc.body.appendChild(container);
    return container;
  }
  return null;
}

/**
 * React hook managing 3-tier OS Picture-in-Picture (Document PiP -> Video PiP -> Floating Mini-Player)
 * and opt-in background Auto-PiP on tab switch.
 */
export function useExternalPictureInPicture(
  options: UseExternalPictureInPictureOptions
): UseExternalPictureInPictureResult {
  const {
    videoRef,
    isPlaying,
    autoPipOnTabSwitch = false,
    autoPipEligible = true,
    autoExitOnTabReturn = false,
    closeDocumentPipOnUnmount = true,
    documentPipWidth = DEFAULT_DOC_PIP_WIDTH,
    documentPipHeight = DEFAULT_DOC_PIP_HEIGHT,
    allowMiniFallback = true,
  } = options;

  const [pipMode, setPipMode] = useState<ExternalPipMode>('none');
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);

  const mountedRef = useRef<boolean>(true);
  const pipModeRef = useRef<ExternalPipMode>('none');
  pipModeRef.current = pipMode;

  const pipWindowRef = useRef<DocumentPipWindowLike | null>(null);
  const docPageHideCleanupRef = useRef<(() => void) | null>(null);
  const enteringPromiseRef = useRef<Promise<ExternalPipMode> | null>(null);

  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  const flagsRef = useRef({
    autoPipOnTabSwitch,
    autoPipEligible,
    autoExitOnTabReturn,
    closeDocumentPipOnUnmount,
    documentPipWidth,
    documentPipHeight,
    allowMiniFallback,
  });
  flagsRef.current = {
    autoPipOnTabSwitch,
    autoPipEligible,
    autoExitOnTabReturn,
    closeDocumentPipOnUnmount,
    documentPipWidth,
    documentPipHeight,
    allowMiniFallback,
  };

  const callbacksRef = useRef({
    onEnterMiniPlayer: options.onEnterMiniPlayer,
    onExitMiniPlayer: options.onExitMiniPlayer,
    onPipEnter: options.onPipEnter,
    onPipExit: options.onPipExit,
  });
  callbacksRef.current = {
    onEnterMiniPlayer: options.onEnterMiniPlayer,
    onExitMiniPlayer: options.onExitMiniPlayer,
    onPipEnter: options.onPipEnter,
    onPipExit: options.onPipExit,
  };

  const [capabilities, setCapabilities] = useState<ExternalPipCapabilities>(() =>
    resolveExternalPipCapabilities(videoRef.current)
  );

  const cleanupDocPipListeners = useCallback(() => {
    if (docPageHideCleanupRef.current) {
      docPageHideCleanupRef.current();
      docPageHideCleanupRef.current = null;
    }
  }, []);

  const resetPipState = useCallback(
    (notifyExit: boolean) => {
      const prevMode = pipModeRef.current;
      cleanupDocPipListeners();
      pipWindowRef.current = null;
      pipModeRef.current = 'none';
      if (mountedRef.current) {
        setPipWindow(null);
        setPipContainer(null);
        setPipMode('none');
      }
      if (notifyExit && prevMode !== 'none') {
        callbacksRef.current.onPipExit?.(prevMode);
      }
    },
    [cleanupDocPipListeners]
  );

  const commitVideoPipEntry = useCallback(() => {
    if ((pipModeRef.current as ExternalPipMode) === 'video') return;
    pipModeRef.current = 'video';
    if (mountedRef.current) {
      setPipMode('video');
    }
    callbacksRef.current.onPipEnter?.('video', null);
  }, []);

  const enterPip = useCallback(
    async (overrideOpts?: { allowMiniFallback?: boolean }): Promise<ExternalPipMode> => {
      if (pipModeRef.current !== 'none') {
        return pipModeRef.current;
      }
      if (enteringPromiseRef.current) {
        return enteringPromiseRef.current;
      }

      const task = (async (): Promise<ExternalPipMode> => {
        const currentCaps = resolveExternalPipCapabilities(videoRef.current);

        // Tier 1: Document Picture-in-Picture
        if (currentCaps.documentPip && typeof window !== 'undefined' && typeof document !== 'undefined') {
          const docPipApi = (window as WindowWithDocumentPip).documentPictureInPicture;
          if (docPipApi && typeof docPipApi.requestWindow === 'function') {
            try {
              const win = await docPipApi.requestWindow({
                width: flagsRef.current.documentPipWidth,
                height: flagsRef.current.documentPipHeight,
              });
              if (!mountedRef.current) {
                try {
                  win?.close?.();
                } catch {
                  // ignore
                }
                return 'none';
              }
              if (win) {
                const container = cloneHostStylesToPipWindow(document, win);
                const onPageHide = () => {
                  resetPipState(true);
                };
                win.addEventListener('pagehide', onPageHide, { once: true });
                docPageHideCleanupRef.current = () => {
                  win.removeEventListener?.('pagehide', onPageHide);
                };
                pipWindowRef.current = win;
                pipModeRef.current = 'document';
                if (mountedRef.current) {
                  setPipWindow(win as unknown as Window);
                  setPipContainer(container);
                  setPipMode('document');
                }
                callbacksRef.current.onPipEnter?.('document', win as unknown as Window);
                return 'document';
              }
            } catch {
              // Fall through gracefully to Tier 2
            }
          }
        }

        // Tier 2: Classic Element PiP or Safari WebKit Presentation Mode
        const video = videoRef.current as VideoElementWithWebkitPip | null;
        if (video) {
          if (
            typeof document !== 'undefined' &&
            (document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled &&
            typeof video.requestPictureInPicture === 'function' &&
            !video.disablePictureInPicture
          ) {
            try {
              await video.requestPictureInPicture();
              if (!mountedRef.current) {
                const docAny = document as unknown as {
                  pictureInPictureElement?: unknown;
                  exitPictureInPicture?: () => Promise<void>;
                };
                if (
                  docAny.pictureInPictureElement === video &&
                  typeof docAny.exitPictureInPicture === 'function'
                ) {
                  try {
                    await docAny.exitPictureInPicture();
                  } catch {
                    // Ignore cleanup errors on already-unmounted video
                  }
                }
                return 'none';
              }
              commitVideoPipEntry();
              return 'video';
            } catch {
              // Fall through gracefully to Tier 3
            }
          } else if (
            typeof video.webkitSetPresentationMode === 'function' &&
            video.webkitSupportsPresentationMode?.('picture-in-picture')
          ) {
            try {
              video.webkitSetPresentationMode('picture-in-picture');
              if (!mountedRef.current) {
                return 'none';
              }
              commitVideoPipEntry();
              return 'video';
            } catch {
              // Fall through gracefully to Tier 3
            }
          }
        }

        // Tier 3: App Floating Mini-Player fallback
        const allowFallback =
          overrideOpts?.allowMiniFallback !== undefined
            ? overrideOpts.allowMiniFallback
            : flagsRef.current.allowMiniFallback;
        if (allowFallback && callbacksRef.current.onEnterMiniPlayer) {
          try {
            callbacksRef.current.onEnterMiniPlayer();
          } catch {
            // Safe guard
          }
          pipModeRef.current = 'mini';
          if (mountedRef.current) {
            setPipMode('mini');
          }
          callbacksRef.current.onPipEnter?.('mini', null);
          return 'mini';
        }

        return 'none';
      })().finally(() => {
        if (enteringPromiseRef.current === task) {
          enteringPromiseRef.current = null;
        }
      });

      enteringPromiseRef.current = task;
      return task;
    },
    [resetPipState, videoRef]
  );

  const exitPip = useCallback(async (): Promise<void> => {
    const prevMode = pipModeRef.current;
    if (prevMode === 'none') return;

    if (prevMode === 'document') {
      const activeWin = pipWindowRef.current;
      resetPipState(true);
      try {
        activeWin?.close?.();
      } catch {
        // Window may already be closed
      }
      return;
    }

    if (prevMode === 'video') {
      const video = videoRef.current as VideoElementWithWebkitPip | null;
      try {
        if (
          typeof document !== 'undefined' &&
          (document as unknown as { pictureInPictureElement?: unknown }).pictureInPictureElement === video &&
          typeof (document as unknown as { exitPictureInPicture?: () => Promise<void> }).exitPictureInPicture === 'function'
        ) {
          await (document as unknown as { exitPictureInPicture: () => Promise<void> }).exitPictureInPicture();
        } else if (
          video &&
          video.webkitPresentationMode === 'picture-in-picture' &&
          typeof video.webkitSetPresentationMode === 'function'
        ) {
          video.webkitSetPresentationMode('inline');
        }
      } catch {
        // Safe cleanup if browser already exited PiP
      }
      resetPipState(true);
      return;
    }

    if (prevMode === 'mini') {
      try {
        callbacksRef.current.onExitMiniPlayer?.();
      } catch {
        // Safe guard
      }
      resetPipState(true);
    }
  }, [resetPipState, videoRef]);

  const togglePip = useCallback(async (): Promise<ExternalPipMode> => {
    if (pipModeRef.current !== 'none') {
      await exitPip();
      return 'none';
    }
    return enterPip();
  }, [enterPip, exitPip]);

  // Sync native <video> PiP events (commit-time ref tracking binds on mount even for plain useRef(null))
  const boundVideoElRef = useRef<VideoElementWithWebkitPip | null>(null);
  const videoListenersCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const video = videoRef.current as VideoElementWithWebkitPip | null;
    if (boundVideoElRef.current === video) return;

    if (videoListenersCleanupRef.current) {
      videoListenersCleanupRef.current();
      videoListenersCleanupRef.current = null;
    }
    boundVideoElRef.current = video;

    const nextCaps = resolveExternalPipCapabilities(video);
    setCapabilities((prev) => (areCapabilitiesEqual(prev, nextCaps) ? prev : nextCaps));

    if (!video || typeof video.addEventListener !== 'function') return;

    const handleEnter = () => {
      if (!mountedRef.current) return;
      commitVideoPipEntry();
    };

    const handleLeave = () => {
      if (pipModeRef.current === 'video') {
        resetPipState(true);
      }
    };

    const handleWebkitMode = () => {
      if (video.webkitPresentationMode === 'picture-in-picture') {
        handleEnter();
      } else if (pipModeRef.current === 'video') {
        resetPipState(true);
      }
    };

    video.addEventListener('enterpictureinpicture', handleEnter);
    video.addEventListener('leavepictureinpicture', handleLeave);
    video.addEventListener('webkitpresentationmodechanged', handleWebkitMode);

    videoListenersCleanupRef.current = () => {
      video.removeEventListener('enterpictureinpicture', handleEnter);
      video.removeEventListener('leavepictureinpicture', handleLeave);
      video.removeEventListener('webkitpresentationmodechanged', handleWebkitMode);
    };
  });

  useEffect(() => {
    return () => {
      if (videoListenersCleanupRef.current) {
        videoListenersCleanupRef.current();
        videoListenersCleanupRef.current = null;
      }
      boundVideoElRef.current = null;
    };
  }, []);

  // Opt-in Auto-PiP on tab switch (visibilitychange -> document.hidden) + MediaSession action
  useEffect(() => {
    if (!autoPipOnTabSwitch || !autoPipEligible) return undefined;

    const caps = resolveExternalPipCapabilities(videoRef.current);
    let registeredMediaSessionAction = false;

    const handleAutoPipTrigger = () => {
      if (!flagsRef.current.autoPipOnTabSwitch || !flagsRef.current.autoPipEligible) return;
      if (!isPlayingRef.current || pipModeRef.current !== 'none') return;
      void enterPip({ allowMiniFallback: false }).catch(() => 'none');
    };

    if (
      caps.autoPipAction &&
      typeof navigator !== 'undefined' &&
      typeof (navigator as unknown as { mediaSession?: { setActionHandler?: Function } }).mediaSession?.setActionHandler === 'function'
    ) {
      try {
        (navigator as unknown as { mediaSession: MediaSession }).mediaSession.setActionHandler(
          'enterpictureinpicture' as MediaSessionAction,
          handleAutoPipTrigger
        );
        registeredMediaSessionAction = true;
      } catch {
        registeredMediaSessionAction = false;
      }
    }

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (!flagsRef.current.autoPipOnTabSwitch || !flagsRef.current.autoPipEligible) return;
        if (!isPlayingRef.current || pipModeRef.current !== 'none') return;
        const currentCaps = resolveExternalPipCapabilities(videoRef.current);
        if (!currentCaps.hasExternalPip) return;
        void enterPip({ allowMiniFallback: false }).catch(() => 'none');
      } else if (flagsRef.current.autoExitOnTabReturn && pipModeRef.current !== 'none') {
        void exitPip().catch(() => {});
      }
    };

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (
        registeredMediaSessionAction &&
        typeof navigator !== 'undefined' &&
        typeof (navigator as unknown as { mediaSession?: { setActionHandler?: Function } }).mediaSession?.setActionHandler === 'function'
      ) {
        try {
          (navigator as unknown as { mediaSession: MediaSession }).mediaSession.setActionHandler(
            'enterpictureinpicture' as MediaSessionAction,
            null
          );
        } catch {
          // Safe cleanup
        }
      }
    };
  }, [autoPipOnTabSwitch, autoPipEligible, enterPip, exitPip, videoRef]);

  // Mount tracking + unmount cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupDocPipListeners();
      if (flagsRef.current.closeDocumentPipOnUnmount && pipWindowRef.current) {
        try {
          pipWindowRef.current.close?.();
        } catch {
          // Ignore close errors
        }
      }
      pipWindowRef.current = null;
    };
  }, [cleanupDocPipListeners]);

  return {
    pipMode,
    capabilities,
    hasExternalPip: capabilities.hasExternalPip,
    pipWindow,
    pipContainer,
    enterPip,
    exitPip,
    togglePip,
  };
}
