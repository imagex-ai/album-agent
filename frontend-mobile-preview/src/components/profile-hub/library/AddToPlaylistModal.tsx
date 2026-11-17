import React, { useEffect, useRef, useState } from 'react';
import { Check, ListPlus, ListVideo, Plus, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useProfileHubLibraryStore } from '../../../store/useProfileHubLibraryStore';
import { translations } from '../../../i18n/translations';
import { isItemInPlaylist } from '../../../services/profileHubLibraryModel';
import { closeWithExitTransition } from '../../video-player/engine/playerMotion';
import { getSpeedMs } from '../../../services/motionConfig';
import './playlist-modal-motion.css';

export const AddToPlaylistModal: React.FC = () => {
  const language = useAppStore((state) => state.settings.language);
  const disableMotion = useAppStore((state) => Boolean(state.settings.disableAllAnimations));
  const animationSpeed = useAppStore((state) => state.settings.animationSpeed);
  const addNotification = useAppStore((state) => state.addNotification);
  const t = translations[language].profileHubLibrary;

  const item = useProfileHubLibraryStore((state) => state.playlistModalItem);
  const playlists = useProfileHubLibraryStore((state) => state.playlists);
  const hydrated = useProfileHubLibraryStore((state) => state.hydrated);
  const hydrateLibrary = useProfileHubLibraryStore((state) => state.hydrateLibrary);
  const closePlaylistModal = useProfileHubLibraryStore((state) => state.closePlaylistModal);
  const createPlaylist = useProfileHubLibraryStore((state) => state.createPlaylist);
  const setPlaylistItem = useProfileHubLibraryStore((state) => state.setPlaylistItem);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const createFormRef = useRef<HTMLFormElement | null>(null);
  const newPlaylistButtonRef = useRef<HTMLButtonElement | null>(null);
  const formClosingRef = useRef(false);
  const formGenerationRef = useRef(0);
  const formItemRef = useRef<typeof item>(null);
  const returnFocusRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const closeGenerationRef = useRef(0);
  useEffect(() => {
    closeGenerationRef.current += 1;
    closingRef.current = false;
    formClosingRef.current = false;
    formGenerationRef.current += 1;
    returnFocusRef.current = false;
    setCreating(false);
    overlayRef.current?.removeAttribute('data-closing');
    panelRef.current?.removeAttribute('inert');
  }, [item]);

  const requestClose = () => {
    if (closingRef.current || !item) return;
    closingRef.current = true;
    panelRef.current?.setAttribute('inert', '');
    const closingItem = item;
    const generation = closeGenerationRef.current;
    void closeWithExitTransition(overlayRef.current, undefined, () => {
      if (generation !== closeGenerationRef.current) return;
      if (useProfileHubLibraryStore.getState().playlistModalItem === closingItem) closePlaylistModal();
      closingRef.current = false;
    }, { disableAllAnimations: disableMotion });
  };

  useEffect(() => {
    const itemChanged = formItemRef.current !== item;
    formItemRef.current = item;
    if (!item) return;
    if (!hydrated) void hydrateLibrary();
    // A successful create changes playlists before its promise resolves. Keep
    // the form mounted until the explicit exit transition has finished.
    if ((creating && !itemChanged) || formClosingRef.current) return;
    setShowCreateForm(useProfileHubLibraryStore.getState().playlists.length === 0);
  }, [item, hydrated, hydrateLibrary]);

  useEffect(() => {
    if (item && showCreateForm) {
      inputRef.current?.focus();
    } else if (item && returnFocusRef.current) {
      returnFocusRef.current = false;
      newPlaylistButtonRef.current?.focus({ preventScroll: true });
    }
  }, [item, showCreateForm]);

  const cancelCreateForm = () => {
    if (formClosingRef.current) return;
    formClosingRef.current = true;
    formGenerationRef.current += 1;
    setCreating(false);
    createFormRef.current?.setAttribute('inert', '');
    const generation = closeGenerationRef.current;
    void closeWithExitTransition(createFormRef.current, undefined, () => {
      if (generation !== closeGenerationRef.current || closingRef.current) return;
      formClosingRef.current = false;
      returnFocusRef.current = true;
      setShowCreateForm(false);
      setNewName('');
    }, { disableAllAnimations: disableMotion });
  };

  useEffect(() => {
    if (!item) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [item, closePlaylistModal, disableMotion]);

  if (!item) return null;

  const handleTogglePlaylist = async (playlistId: string, playlistName: string, currentlyPresent: boolean) => {
    const nextPresent = !currentlyPresent;
    await setPlaylistItem(playlistId, item, nextPresent);
    const template = nextPresent ? t.addedToPlaylistToast : t.removedFromPlaylistToast;
    addNotification({
      type: 'success',
      title: playlistName,
      message: template.replace('{name}', playlistName),
    });
  };

  const handleCreateAndAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    const generation = closeGenerationRef.current;
    const creatingItem = item;
    const formGeneration = formGenerationRef.current;
    setCreating(true);
    try {
      const created = await createPlaylist(trimmed, '', item);
      if (generation !== closeGenerationRef.current || formGeneration !== formGenerationRef.current || closingRef.current ||
          useProfileHubLibraryStore.getState().playlistModalItem !== creatingItem) return;
      if (created) {
        addNotification({
          type: 'success',
          title: created.name,
          message: t.addedToPlaylistToast.replace('{name}', created.name),
        });
        cancelCreateForm();
      }
    } finally {
      if (generation === closeGenerationRef.current && formGeneration === formGenerationRef.current) setCreating(false);
    }
  };

  return (
    <div
      key={item.key}
      ref={overlayRef}
      data-motion-disabled={disableMotion}
      style={{ '--playlist-motion-duration': `${getSpeedMs(animationSpeed)}ms` } as React.CSSProperties}
      className="playlist-modal-overlay fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-playlist-title"
        data-playlist-modal
        className="playlist-modal-panel tl-themed w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[var(--tl-surface)] border border-[var(--tl-border-strong)] shadow-2xl overflow-hidden text-[var(--tl-text-primary)] flex flex-col max-h-[85dvh]"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--tl-border)]">
          <div className="flex items-center gap-2 min-w-0">
            <ListPlus className="w-4 h-4 text-[var(--tl-accent-text)] shrink-0" aria-hidden="true" />
            <h2 id="add-to-playlist-title" className="text-sm font-bold text-[var(--tl-text-primary)] truncate">
              {t.addToPlaylist}
            </h2>
          </div>
          <button
            type="button"
            data-playlist-modal-close
            onClick={requestClose}
            aria-label={t.closeModal}
            className="w-8 h-8 rounded-full bg-[var(--tl-surface-elevated)] hover:bg-[var(--tl-surface-hover)] text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2.5 bg-[var(--tl-bg)] border-b border-[var(--tl-border)] flex items-center gap-3 min-w-0">
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              className="w-12 h-8 rounded-lg object-cover bg-black/50 shrink-0"
            />
          ) : (
            <div className="w-12 h-8 rounded-lg bg-[var(--tl-surface-elevated)] flex items-center justify-center shrink-0">
              <ListVideo className="w-4 h-4 text-[var(--tl-accent-text)]" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--tl-text-primary)] truncate">
              {item.title || t.unknownTitle}
            </p>
            {(item.creatorName || item.creatorHandle) && (
              <p className="text-[11px] text-[var(--tl-text-muted)] truncate">
                {item.creatorName || item.creatorHandle}
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {playlists.map((playlist) => {
            const present = isItemInPlaylist(playlist, item);
            const countLabel =
              playlist.items.length === 1 ? t.itemsCountSingular : t.itemsCountPlural;
            return (
              <button
                key={playlist.id}
                type="button"
                data-playlist-option={playlist.id}
                aria-pressed={present}
                onClick={() => void handleTogglePlaylist(playlist.id, playlist.name, present)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)] ${
                  present
                    ? 'bg-[var(--tl-accent-soft)] border-[var(--tl-accent-border)] text-[var(--tl-text-primary)]'
                    : 'bg-[var(--tl-surface-elevated)] border-[var(--tl-border)] text-[var(--tl-text-secondary)] hover:border-[var(--tl-accent-border)]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate">{playlist.name}</div>
                  <div className="text-[11px] text-[var(--tl-text-muted)]">
                    {playlist.items.length} {countLabel}
                  </div>
                </div>
                <span
                  className={`playlist-option-check w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                    present
                      ? 'bg-[var(--tl-accent)] border-[var(--tl-accent-hover)] text-[var(--tl-accent-contrast)]'
                      : 'border-[var(--tl-border-strong)] bg-[var(--tl-bg)] text-transparent'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-[var(--tl-border)] bg-[var(--tl-surface-elevated)]">
          {showCreateForm ? (
            <form ref={createFormRef} onSubmit={(e) => void handleCreateAndAdd(e)} className="playlist-create-form space-y-2.5">
              <label htmlFor="modal-new-playlist-name" className="block text-[11px] font-semibold text-[var(--tl-text-secondary)]">
                {t.playlistNameLabel}
              </label>
              <input
                ref={inputRef}
                id="modal-new-playlist-name"
                type="text"
                data-new-playlist-name-input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t.playlistNamePlaceholder}
                maxLength={120}
                className="w-full rounded-xl bg-[var(--tl-bg)] border border-[var(--tl-border-strong)] px-3 py-2 text-xs text-[var(--tl-text-primary)] placeholder:text-[var(--tl-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--tl-accent-hover)]"
              />
              <div className="flex items-center justify-end gap-2">
                {playlists.length > 0 && (
                  <button
                    type="button"
                    onClick={cancelCreateForm}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[var(--tl-text-secondary)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)] transition-colors"
                  >
                    {t.cancel}
                  </button>
                )}
                <button
                  type="submit"
                  data-create-playlist-submit
                  disabled={!newName.trim() || creating}
                  className="px-3.5 py-1.5 rounded-xl bg-[var(--tl-accent)] hover:bg-[var(--tl-accent-hover)] disabled:opacity-50 text-xs font-bold text-[var(--tl-accent-contrast)] transition-colors"
                >
                  {t.createAndAdd}
                </button>
              </div>
            </form>
          ) : (
            <button
              ref={newPlaylistButtonRef}
              type="button"
              data-open-create-playlist-form
              onClick={() => setShowCreateForm(true)}
              className="playlist-create-trigger w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-[var(--tl-surface)] hover:bg-[var(--tl-surface-hover)] border border-[var(--tl-border-strong)] text-xs font-bold text-[var(--tl-accent-text)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"
            >
              <Plus className="w-4 h-4" />
              <span>{t.newPlaylist}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
