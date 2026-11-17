/**
 * PlayerShortcutsDialog.tsx
 *
 * Keyboard Shortcuts Cheat Sheet modal dialog for Universal Video Player.
 * - Registered with playerOverlayStack at PLAYER_OVERLAY_PRIORITY.SHORTCUTS_DIALOG (400)
 * - Safe exit transition via closeWithExitTransition
 * - 100% localized via translations[lang].player.shortcuts
 */

import React, { useEffect, useRef } from 'react';
import {
  PLAYER_OVERLAY_LAYER_ATTR,
  PLAYER_OVERLAY_PRIORITY,
  registerPlayerOverlayLayer,
} from '../engine/playerOverlayStack';
import { closeWithExitTransition } from '../engine/playerMotion';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../types';

export interface PlayerShortcutsDialogProps {
  isOpen: boolean;
  language?: Language;
  triggerRef?: React.RefObject<HTMLElement | null>;
  disableAnimations?: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  labelKey: keyof typeof translations['en-US']['player']['shortcuts'];
}

const SHORTCUT_ROWS: ShortcutItem[] = [
  { keys: ['k', 'Space'], labelKey: 'playPause' },
  { keys: ['j'], labelKey: 'seekBackward10' },
  { keys: ['l'], labelKey: 'seekForward10' },
  { keys: ['←'], labelKey: 'seekBackward5' },
  { keys: ['→'], labelKey: 'seekForward5' },
  { keys: ['↑'], labelKey: 'volumeUp' },
  { keys: ['↓'], labelKey: 'volumeDown' },
  { keys: ['m'], labelKey: 'toggleMute' },
  { keys: ['f'], labelKey: 'toggleFullscreen' },
  { keys: ['t'], labelKey: 'toggleTheater' },
  { keys: ['p'], labelKey: 'toggleFill' },
  { keys: ['i'], labelKey: 'toggleMini' },
  { keys: ['<', '>'], labelKey: 'decreaseSpeed' },
  { keys: [',', '.'], labelKey: 'stepFrameForward' },
  { keys: ['0..9'], labelKey: 'seekFraction' },
];

export const PlayerShortcutsDialog: React.FC<PlayerShortcutsDialogProps> = ({
  isOpen,
  language = 'pt-BR',
  triggerRef,
  disableAnimations = false,
  onClose,
}) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closingRef = useRef(false);
  const closingGuardRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const t = translations[language]?.player || translations['pt-BR'].player;
  const shortcutsT = t.shortcuts || translations['en-US'].player.shortcuts;

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const guardEscape = () => {
      closingGuardRef.current = registerPlayerOverlayLayer({
        id: 'uvp-shortcuts-closing',
        priority: PLAYER_OVERLAY_PRIORITY.SHORTCUTS_DIALOG,
        onDismiss: guardEscape,
      });
    };
    guardEscape();
    const generation = generationRef.current;
    void closeWithExitTransition(overlayRef.current, undefined, () => {
      if (generation !== generationRef.current) return;
      closingGuardRef.current?.();
      closingGuardRef.current = null;
      closingRef.current = false;
      onClose();
      if (triggerRef?.current?.isConnected !== false) triggerRef?.current?.focus({ preventScroll: true });
    }, { disableAllAnimations: disableAnimations });
  };

  useEffect(() => {
    generationRef.current += 1;
    closingRef.current = false;
    if (isOpen) closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      generationRef.current += 1;
      closingGuardRef.current?.();
      closingGuardRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const unregister = registerPlayerOverlayLayer({
      id: 'uvp-shortcuts-dialog',
      priority: PLAYER_OVERLAY_PRIORITY.SHORTCUTS_DIALOG,
      onDismiss: handleClose,
      triggerElement: triggerRef?.current,
      dialogElement: dialogRef.current,
    });

    return () => {
      unregister();
    };
  }, [isOpen, triggerRef, disableAnimations]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      data-motion-disabled={disableAnimations}
      className="uvp-shortcuts-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        ref={dialogRef}
        {...{ [PLAYER_OVERLAY_LAYER_ATTR]: '' }}
        className="uvp-shortcuts-modal w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 text-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.shortcutsTitle}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--tl-border)] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" strokeLinecap="round" />
            </svg>
            <h2 className="text-base font-semibold text-[var(--tl-text-primary)]">
              {t.shortcutsTitle}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="uvp-btn p-1 text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)]"
            aria-label={t.bottomSheetClose}
            onClick={handleClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Shortcuts Table */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SHORTCUT_ROWS.map((row) => {
            const label = shortcutsT[row.labelKey] || String(row.labelKey);
            return (
              <div
                key={String(row.labelKey)}
                className="flex items-center justify-between p-2 rounded-lg bg-[var(--tl-surface-elevated)] border border-[var(--tl-border)]/50"
              >
                <span className="text-xs text-[var(--tl-text-secondary)] font-medium">
                  {label}
                </span>
                <div className="flex items-center gap-1">
                  {row.keys.map((k) => (
                    <kbd
                      key={k}
                      className="px-2 py-0.5 text-xs font-mono font-semibold rounded bg-[var(--tl-surface-elevated,var(--tl-surface))] text-[var(--tl-text-primary)] border border-[var(--tl-border-strong,var(--tl-border))] shadow-sm"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PlayerShortcutsDialog;
