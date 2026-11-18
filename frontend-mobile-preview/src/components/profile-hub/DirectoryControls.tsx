import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, X, Clock3, Heart, Trash2, ArrowUpRight } from 'lucide-react';
import { ModalPortal } from '../common/ModalPortal';
import { useProfileDirectoryLibraryStore, type ProfileShortcut } from '../../store/useProfileDirectoryLibraryStore';
import { profileDirectoryCopy } from '../../services/profileDirectoryCopy';

type Copy = typeof profileDirectoryCopy['pt-BR'];
export function DirectoryActionsMenu({ label, children, className = '', icon }: { label: string; children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) { ref.current?.removeAttribute('open'); setOpen(false); } };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return <details ref={ref} className={`pd-menu ${className}`} onToggle={event => setOpen(event.currentTarget.open)}
    onKeyDown={event => { if (event.key === 'Escape') { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); } }}>
    <summary aria-label={label} title={label}>{icon ?? <MoreHorizontal size={18} />}</summary>
    {open && <div className="pd-menu-content" onClick={event => {
      if ((event.target as Element).closest('button, a')) { ref.current?.querySelector('summary')?.focus({ preventScroll: true }); ref.current?.removeAttribute('open'); setOpen(false); }
    }}>{children}</div>}
  </details>;
}

export function DirectoryShortcutsDialog({ mode, copy, language, onClose, onOpen }: {
  mode: 'history' | 'favorites'; copy: Copy; language: string; onClose: () => void; onOpen: (item: ProfileShortcut) => void;
}) {
  useEffect(() => { if (mode === 'favorites') void useProfileDirectoryLibraryStore.getState().initSync(); }, [mode]);
  const ref = useRef<HTMLDialogElement>(null);
  const cancelClear = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const history = useProfileDirectoryLibraryStore(state => state.history);
  const favorites = useProfileDirectoryLibraryStore(state => state.favorites);
  const storageAvailable = useProfileDirectoryLibraryStore(state => state.storageAvailable);
  const entries = mode === 'history' ? history : favorites;
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (confirming) cancelClear.current?.focus(); }, [confirming]);
  return <ModalPortal><dialog ref={ref} className="pd-dialog" aria-labelledby="pd-shortcut-title" onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header><div>{mode === 'history' ? <Clock3 size={19} /> : <Heart size={19} />}<h2 id="pd-shortcut-title">{mode === 'history' ? copy.history : copy.favorites}</h2></div><button type="button" className="pd-icon-button" onClick={onClose} aria-label={copy.close}><X size={18} /></button></header>
    <div className="pd-dialog-body">
      {confirming ? <><h3>{copy.confirmClear}</h3><p>{copy.clearHistoryHint}</p><div className="pd-dialog-confirm"><button ref={cancelClear} type="button" className="pd-button" onClick={() => setConfirming(false)}>{copy.cancel}</button><button type="button" className="pd-button pd-danger" onClick={() => { useProfileDirectoryLibraryStore.getState().clearHistory(); setConfirming(false); }}>{copy.confirm}</button></div></>
      : <><p className="pd-muted">{mode === 'favorites' ? copy.favoritePersistence : copy.localOnly}</p>{!storageAvailable && <p role="status" className="pd-warning">{copy.storageError}</p>}
        {!entries.length ? <div className="pd-shortcut-empty">{mode === 'history' ? copy.emptyHistory : copy.emptyFavorites}</div> : <ul className="pd-shortcut-list">
          {entries.map(item => <li key={item.key}><button type="button" className="pd-shortcut-open" onClick={() => { onOpen(item); onClose(); }}>
            <span className="pd-shortcut-avatar" aria-hidden="true">{item.name?.slice(0, 1).toLocaleUpperCase() || (item.kind === 'directory' ? <Clock3 size={18} /> : <Heart size={18} />)}</span>
            <span><strong>{item.name || (item.kind === 'directory' ? copy.directory : copy.unnamed)}</strong><small>{new URL(item.url).hostname} · {new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(item.visitedAt)}</small></span><ArrowUpRight size={16} />
          </button><button type="button" className="pd-icon-button" aria-label={`${copy.remove}: ${item.name || item.url}`} onClick={() => mode === 'history' ? useProfileDirectoryLibraryStore.getState().removeHistory(item.key) : useProfileDirectoryLibraryStore.getState().toggleFavorite(item)}><Trash2 size={16} /></button></li>)}
        </ul>}
      </>}
    </div>
    {!confirming && mode === 'history' && entries.length > 0 && <footer><button type="button" className="pd-button" onClick={() => setConfirming(true)}><Trash2 size={15} />{copy.clearHistory}</button></footer>}
  </dialog></ModalPortal>;
}
