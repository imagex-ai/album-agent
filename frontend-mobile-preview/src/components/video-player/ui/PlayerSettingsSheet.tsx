/**
 * PlayerSettingsSheet.tsx
 *
 * Responsive Settings Menu & Bottom Sheet for Universal Video Player.
 * - Anchored popover (desktop) vs Bottom Sheet (<dialog> drawer obeying env(safe-area-inset-bottom))
 * - Registered with playerOverlayStack (PLAYER_OVERLAY_PRIORITY.MENU: 500 / BOTTOM_SHEET: 450)
 * - Safe exit transition via closeWithExitTransition + [data-closing="true"]
 * - 100% i18n compliant (translations[lang].player)
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  PLAYER_OVERLAY_LAYER_ATTR,
  PLAYER_OVERLAY_PRIORITY,
  registerPlayerOverlayLayer,
} from '../engine/playerOverlayStack';
import { closeWithExitTransition, isReducedMotionPreferred } from '../engine/playerMotion';
import { formatQualityLabel, type StreamQualityCandidate } from '../engine/videoPlayerCore';
import { translations } from '../../../i18n/translations';
import type { Language } from '../../../types';

export interface PlayerSettingsSheetProps {
  isOpen: boolean;
  qualities?: StreamQualityCandidate[];
  selectedQuality?: number | 'auto';
  playbackRate?: number;
  ambientGlowEnabled?: boolean;
  language?: Language;
  triggerRef?: React.RefObject<HTMLElement | null>;
  initialSection?: 'main' | 'quality' | 'speed';
  isBottomSheet?: boolean;
  disableAnimations?: boolean;
  closeRequestRef?: React.MutableRefObject<(() => void) | null>;
  onClose: () => void;
  onSelectQuality?: (quality: number | 'auto') => void;
  onSelectPlaybackRate?: (rate: number) => void;
  onToggleAmbientGlow?: () => void;
  onOpenShortcuts?: () => void;
}

type SettingsSection = 'main' | 'quality' | 'speed';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const PlayerSettingsSheet: React.FC<PlayerSettingsSheetProps> = ({
  isOpen,
  qualities = [],
  selectedQuality = 'auto',
  playbackRate = 1,
  ambientGlowEnabled,
  language = 'pt-BR',
  triggerRef,
  initialSection = 'main',
  isBottomSheet,
  disableAnimations = false,
  closeRequestRef,
  onClose,
  onSelectQuality,
  onSelectPlaybackRate,
  onToggleAmbientGlow,
  onOpenShortcuts,
}) => {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [sectionDirection, setSectionDirection] = useState<'forward' | 'back'>('forward');
  const sheetRef = useRef<HTMLElement | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const sectionAnimationRef = useRef<Animation | null>(null);
  const sectionGenerationRef = useRef(0);
  const sectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishSectionRef = useRef<(() => void) | null>(null);
  const returningFromRef = useRef<SettingsSection | null>(null);
  const closingRef = useRef(false);
  const closingGuardRef = useRef<(() => void) | null>(null);
  const closeGenerationRef = useRef(0);
  const t = translations[language]?.player || translations['pt-BR'].player;

  const [isCoarseOrNarrow, setIsCoarseOrNarrow] = useState<boolean>(() => {
    if (isBottomSheet !== undefined) return isBottomSheet;
    if (typeof window !== 'undefined') {
      const coarse =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;
      const narrow = window.innerWidth < 520;
      return Boolean(coarse || narrow);
    }
    return false;
  });

  useEffect(() => {
    if (isBottomSheet !== undefined) {
      setIsCoarseOrNarrow(isBottomSheet);
      return;
    }
    if (typeof window === 'undefined') return;
    const update = () => {
      const coarse =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;
      const narrow = window.innerWidth < 520;
      setIsCoarseOrNarrow(Boolean(coarse || narrow));
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isBottomSheet]);

  const effectiveIsBottomSheet = isBottomSheet ?? isCoarseOrNarrow;

  const cancelSectionAnimation = () => {
    if (sectionTimerRef.current !== null) clearTimeout(sectionTimerRef.current);
    sectionTimerRef.current = null;
    finishSectionRef.current = null;
    sectionAnimationRef.current?.cancel();
    sectionAnimationRef.current = null;
  };

  const navigateSection = (next: SettingsSection) => {
    if (closingRef.current || next === section) return;
    const generation = ++sectionGenerationRef.current;
    cancelSectionAnimation();
    const previous = section;
    const direction = next === 'main' ? 'back' : 'forward';
    const apply = () => {
      if (generation !== sectionGenerationRef.current || closingRef.current) return;
      returningFromRef.current = next === 'main' ? previous : null;
      setSectionDirection(direction);
      setSection(next);
    };
    const element = sectionRef.current;
    if (disableAnimations || isReducedMotionPreferred() || !element || typeof element.animate !== 'function') {
      apply();
      return;
    }
    const duration = Number.parseFloat(getComputedStyle(element).getPropertyValue('--uvp-motion-duration'));
    if (Number.isFinite(duration) && duration <= 0) {
      apply();
      return;
    }
    const animation = element.animate(
      [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${direction === 'forward' ? '-8px' : '8px'})` }],
      { duration: Number.isFinite(duration) ? duration / 2 : 175, easing: 'ease-in', fill: 'both' },
    );
    sectionAnimationRef.current = animation;
    const finish = () => {
      if (generation !== sectionGenerationRef.current) return;
      cancelSectionAnimation();
      apply();
    };
    finishSectionRef.current = finish;
    sectionTimerRef.current = setTimeout(finish, 2000);
    void animation.finished.then(finish, () => {});
  };

  useEffect(() => {
    if (disableAnimations) finishSectionRef.current?.();
  }, [disableAnimations]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { if (media.matches) finishSectionRef.current?.(); };
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  const handleClose = (afterClose?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    // The stack unregisters a dismissed layer on Escape; keep consuming further
    // Escapes until the exit has actually finished and the layer is gone.
    const guardEscape = () => {
      closingGuardRef.current = registerPlayerOverlayLayer({
        id: 'uvp-player-settings-closing',
        priority: effectiveIsBottomSheet ? PLAYER_OVERLAY_PRIORITY.BOTTOM_SHEET : PLAYER_OVERLAY_PRIORITY.MENU,
        onDismiss: guardEscape,
      });
    };
    guardEscape();
    sectionGenerationRef.current += 1;
    cancelSectionAnimation();
    const generation = closeGenerationRef.current;
    void closeWithExitTransition(sheetRef.current, undefined, () => {
      if (closeGenerationRef.current !== generation) return;
      closingGuardRef.current?.();
      closingGuardRef.current = null;
      closingRef.current = false;
      onClose();
      afterClose?.();
    }, { disableAllAnimations: disableAnimations });
  };

  useEffect(() => {
    closeGenerationRef.current += 1;
    closingRef.current = false;
    return () => {
      closeGenerationRef.current += 1;
      closingGuardRef.current?.();
      closingGuardRef.current = null;
      sectionGenerationRef.current += 1;
      cancelSectionAnimation();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!closeRequestRef) return;
    closeRequestRef.current = isOpen ? () => handleClose() : null;
    return () => { closeRequestRef.current = null; };
  });

  useEffect(() => {
    const dialog = effectiveIsBottomSheet ? sheetRef.current as HTMLDialogElement | null : null;
    if (!isOpen || !dialog) return;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      // A modal keeps outside elements inert until it is actually closed.
      // Restore focus afterwards, unless another player overlay took ownership.
      if (typeof document !== 'undefined' && !document.querySelector(`[${PLAYER_OVERLAY_LAYER_ATTR}]:not(.uvp-settings-sheet)`)) {
        triggerRef?.current?.focus({ preventScroll: true });
      }
    };
  }, [isOpen, effectiveIsBottomSheet, triggerRef]);

  useEffect(() => {
    if (isOpen && section !== 'main') {
      sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    } else if (isOpen && returningFromRef.current) {
      sheetRef.current?.querySelector<HTMLButtonElement>(`[data-settings-section="${returningFromRef.current}"]`)?.focus({ preventScroll: true });
      returningFromRef.current = null;
    }
  }, [isOpen, section]);

  useEffect(() => {
    if (!isOpen) {
      setSection(initialSection);
      return;
    }

    const priority = effectiveIsBottomSheet
      ? PLAYER_OVERLAY_PRIORITY.BOTTOM_SHEET
      : PLAYER_OVERLAY_PRIORITY.MENU;

    const unregister = registerPlayerOverlayLayer({
      id: 'uvp-player-settings-sheet',
      priority,
      onDismiss: () => handleClose(),
      triggerElement: triggerRef?.current,
      dialogElement: sheetRef.current,
    });

    return () => {
      unregister();
    };
  }, [isOpen, triggerRef, initialSection, effectiveIsBottomSheet, disableAnimations]);

  if (!isOpen) return null;

  const sheetContent = (
    <>
      {effectiveIsBottomSheet && <div className="uvp-sheet-handle" />}

      {/* Header with Title and Optional Back Button */}
      <div className="flex items-center justify-between border-b border-[var(--tl-border)] pb-2 mb-2">
        <div className="flex items-center gap-2">
          {section !== 'main' && (
            <button
              type="button"
              className="uvp-btn p-1 text-[var(--tl-text-primary)] hover:text-[var(--tl-text-secondary)]"
              aria-label={language === 'pt-BR' ? 'Voltar' : 'Back'}
              onClick={() => navigateSection('main')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <span className="font-semibold text-[var(--tl-text-primary)]">
            {section === 'quality'
              ? t.quality
              : section === 'speed'
                ? t.speed
                : t.settingsTitle}
          </span>
        </div>
        <button
          type="button"
          className="uvp-btn p-1 text-[var(--tl-text-primary)] hover:text-[var(--tl-text-secondary)]"
          aria-label={t.bottomSheetClose}
          onClick={() => handleClose()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      <div
        key={section}
        ref={sectionRef}
        className="uvp-settings-section"
        data-direction={sectionDirection}
        data-motion-disabled={disableAnimations}
        onClickCapture={event => {
          if (sectionAnimationRef.current && !(event.target instanceof Element && event.target.closest('[data-settings-section]'))) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
      {/* Main Settings Navigation */}
      {section === 'main' && (
        <div className="flex flex-col gap-1">
          {/* Quality Submenu Trigger */}
          {qualities.length > 0 && onSelectQuality && (
            <button
              type="button"
              data-settings-section="quality"
              className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--tl-surface-hover)] transition-colors text-left"
              onClick={() => navigateSection('quality')}
            >
              <span className="flex items-center gap-2 text-[var(--tl-text-primary)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
                </svg>
                {t.quality}
              </span>
              <span className="text-xs text-[var(--tl-text-muted)] flex items-center gap-1">
                {selectedQuality === 'auto'
                  ? t.qualityAuto
                  : formatQualityLabel(selectedQuality)}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          )}

          {/* Speed Submenu Trigger */}
          {onSelectPlaybackRate && (
            <button
              type="button"
              data-settings-section="speed"
              className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--tl-surface-hover)] transition-colors text-left"
              onClick={() => navigateSection('speed')}
            >
              <span className="flex items-center gap-2 text-[var(--tl-text-primary)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" strokeLinecap="round" />
                </svg>
                {t.speed}
              </span>
              <span className="text-xs text-[var(--tl-text-muted)] flex items-center gap-1">
                {playbackRate === 1 ? t.speedNormal : `${playbackRate}x`}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          )}

          {/* Ambient Glow Toggle */}
          {ambientGlowEnabled !== undefined && onToggleAmbientGlow && (
            <button
              type="button"
              aria-pressed={ambientGlowEnabled}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--tl-surface-hover)] transition-colors text-left"
              onClick={onToggleAmbientGlow}
            >
              <span className="flex items-center gap-2 text-[var(--tl-text-primary)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                {t.ambientGlow}
              </span>
              <span className="text-xs px-2 py-0.5 rounded text-[var(--tl-text-muted)]">
                {ambientGlowEnabled ? t.ambientGlowOff : t.ambientGlowOn}
              </span>
            </button>
          )}

          {/* Keyboard Shortcuts Trigger */}
          {onOpenShortcuts && (
            <button
              type="button"
              data-settings-shortcuts
              className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--tl-surface-hover)] transition-colors text-left"
              onClick={() => {
                handleClose(onOpenShortcuts);
              }}
            >
              <span className="flex items-center gap-2 text-[var(--tl-text-primary)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" strokeLinecap="round" />
                </svg>
                {t.shortcutsTitle}
              </span>
              <span className="text-xs text-[var(--tl-text-muted)]">Shift+?</span>
            </button>
          )}
        </div>
      )}

      {/* Quality Submenu */}
      {section === 'quality' && (
        <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
          {/* Auto Quality Option */}
          <button
            type="button"
            aria-pressed={selectedQuality === 'auto'}
            className={`flex items-center justify-between p-2 rounded-lg transition-colors text-left ${selectedQuality === 'auto' ? 'bg-[var(--tl-accent-soft)] text-[var(--tl-accent)] font-semibold' : 'hover:bg-[var(--tl-surface-hover)] text-[var(--tl-text-primary)]'}`}
            onClick={() => {
              onSelectQuality?.('auto');
              handleClose();
            }}
          >
            <span>{t.qualityAuto}</span>
            {selectedQuality === 'auto' && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
              </svg>
            )}
          </button>

          {/* Explicit Qualities List */}
          {qualities.map((q) => {
            const isSelected = selectedQuality === q.height;
            return (
              <button
                key={q.streamUrl || q.label || q.height}
                type="button"
                aria-pressed={isSelected}
                className={`flex items-center justify-between p-2 rounded-lg transition-colors text-left ${isSelected ? 'bg-[var(--tl-accent-soft)] text-[var(--tl-accent)] font-semibold' : 'hover:bg-[var(--tl-surface-hover)] text-[var(--tl-text-primary)]'}`}
                onClick={() => {
                  if (typeof q.height === 'number') {
                    onSelectQuality?.(q.height);
                  }
                  handleClose();
                }}
              >
                <span>{q.label || formatQualityLabel(q.height)}</span>
                {isSelected && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Speed Submenu */}
      {section === 'speed' && (
        <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
          {SPEED_OPTIONS.map((rate) => {
            const isSelected = playbackRate === rate;
            return (
              <button
                key={rate}
                type="button"
                aria-pressed={isSelected}
                className={`flex items-center justify-between p-2 rounded-lg transition-colors text-left ${isSelected ? 'bg-[var(--tl-accent-soft)] text-[var(--tl-accent)] font-semibold' : 'hover:bg-[var(--tl-surface-hover)] text-[var(--tl-text-primary)]'}`}
                onClick={() => {
                  onSelectPlaybackRate?.(rate);
                  handleClose();
                }}
              >
                <span>{rate === 1 ? t.speedNormal : `${rate}x`}</span>
                {isSelected && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
      </div>
    </>
  );

  if (effectiveIsBottomSheet) {
    return (
        <dialog
          ref={node => { sheetRef.current = node; }}
          {...{ [PLAYER_OVERLAY_LAYER_ATTR]: '' }}
          className="uvp-bottom-sheet uvp-settings-sheet text-sm shadow-2xl backdrop-blur-md"
          aria-label={t.settingsTitle}
          onCancel={event => event.preventDefault()}
          onClick={event => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) handleClose();
          }}
        >
          {sheetContent}
        </dialog>
    );
  }

  return (
    <div
      ref={node => { sheetRef.current = node; }}
      {...{ [PLAYER_OVERLAY_LAYER_ATTR]: '' }}
      className="uvp-settings-sheet uvp-settings-popover absolute right-2.5 z-40 w-72 max-w-[calc(100%-20px)] overflow-y-auto overscroll-contain p-2.5 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {sheetContent}
    </div>
  );
};

export default PlayerSettingsSheet;
