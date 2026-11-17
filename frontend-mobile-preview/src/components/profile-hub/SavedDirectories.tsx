import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Bookmark, Plus, Search, X, Pencil, Trash2, MoreHorizontal } from 'lucide-react';

import { AppDialog } from '../common/AppDialog';

import { useAppStore } from '../../store/useAppStore';

import { directoryIdentity, useSavedDirectoriesStore, type SavedDirectory } from '../../store/useSavedDirectoriesStore';

import { resolveProfileHubInput } from '../../services/profileDirectoryApi';

import './saved-directories.css';



const messages = {

  'pt-BR': { title: 'Diretórios salvos', intro: 'Suas listas de perfis, sempre à mão.', search: 'Buscar por nome ou endereço…', all: 'Todos os diretórios', pinned: 'Fixados no topo', add: 'Adicionar diretório', edit: 'Editar diretório', remove: 'Remover atalho', name: 'Nome do diretório', url: 'Link da lista de perfis', save: 'Salvar diretório', cancel: 'Cancelar', close: 'Fechar', empty: 'Nenhum diretório encontrado.', local: 'Salvos neste aplicativo.', error: 'Informe nome e URL de um diretório reconhecido, sem duplicar um endereço salvo.', storage: 'Persistência não confirmada. Alterações mantidas; reabra este painel para tentar novamente.', undo: 'Desfazer', removeHint: 'Somente o atalho será removido. A lista aberta e suas mídias serão preservadas.', removed: 'Atalho removido. A lista aberta e suas mídias foram preservadas.', pin: 'Fixar no topo', unpin: 'Desafixar', working: 'Validando…', confirm: 'Remover somente este atalho?', clear: 'Limpar busca' },

  'en-US': { title: 'Saved directories', intro: 'Your profile lists, always within reach.', search: 'Search by name or address…', all: 'All directories', pinned: 'Pinned first', add: 'Add directory', edit: 'Edit directory', remove: 'Remove shortcut', name: 'Directory name', url: 'Profile directory URL', save: 'Save directory', cancel: 'Cancel', close: 'Close', empty: 'No directories found.', local: 'Saved in this app.', error: 'Enter a name and a recognized directory URL without duplicating a saved address.', storage: 'Persistence is unconfirmed. Changes were retained; reopen this panel to retry.', undo: 'Undo', removeHint: 'Only this shortcut will be removed. The open list and your media will be preserved.', removed: 'Shortcut removed. The open list and your media were preserved.', pin: 'Pin first', unpin: 'Unpin', working: 'Validating…', confirm: 'Remove this shortcut only?', clear: 'Clear search' },

};

// Small anchor gap and viewport inset keep the measured action popup separate
// from its trigger and away from the screen edge in either responsive layout.
const MENU_ANCHOR_GAP = 4;
const MENU_VIEWPORT_INSET = 12;
// Geometry is browser-only; isolated server renders have no DOM to measure.
const useMenuLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;



export function SavedDirectories({ onOpenUrl, currentUrl = '', active = true }: { onOpenUrl: (url: string) => void; currentUrl?: string; active?: boolean }) {

  const language = useAppStore(s => s.settings.language);

  const copy = messages[language];

  const items = useSavedDirectoriesStore(s => s.items);

  const available = useSavedDirectoriesStore(s => s.available);

  const [open, setOpen] = useState(false);

  const [query, setQuery] = useState('');

  const [pinned, setPinned] = useState(false);

  const [editing, setEditing] = useState<SavedDirectory | null>(null);

  const [removing, setRemoving] = useState<SavedDirectory | null>(null);

  const [removed, setRemoved] = useState<SavedDirectory | null>(null);

  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ item: SavedDirectory; top: number; left: number } | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  useMenuLayoutEffect(() => {
    if (!menu || !menuElement.current || !menuTrigger.current) return;
    const trigger = menuTrigger.current.getBoundingClientRect();
    const popup = menuElement.current.getBoundingClientRect();
    const below = trigger.bottom + MENU_ANCHOR_GAP;
    const preferredTop = below + popup.height <= window.innerHeight - MENU_VIEWPORT_INSET
      ? below : trigger.top - MENU_ANCHOR_GAP - popup.height;
    const clampToViewport = (value: number, viewport: number, size: number) => Math.max(
      MENU_VIEWPORT_INSET, Math.min(value, viewport - size - MENU_VIEWPORT_INSET),
    );
    const top = clampToViewport(preferredTop, window.innerHeight, popup.height);
    const left = clampToViewport(trigger.right - popup.width, window.innerWidth, popup.width);
    setMenu(current => current && current.item.id === menu.item.id ? { ...current, top, left } : current);
  }, [menu?.item.id, language]);
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector('button')?.focus();
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.sd-popover, .sd-menu-trigger')) setMenu(null); };
    const resize = () => setMenu(null);
    document.addEventListener('pointerdown', close); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', resize); };
  }, [menu?.item.id]);

  const search = useRef<HTMLInputElement>(null);

  const nameInput = useRef<HTMLInputElement>(null);

  const request = useRef<AbortController | null>(null);

  useEffect(() => { if (active) void useSavedDirectoriesStore.getState().initSync(); }, [active]);
  useEffect(() => { if (open) void useSavedDirectoriesStore.getState().initSync(); }, [open]);

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => { if (open && !editing && !removing) search.current?.focus(); }, [open, editing, removing]);

  useEffect(() => { if (!active) { setMenu(null); request.current?.abort(); setBusy(false); setOpen(false); setEditing(null); setRemoving(null); } }, [active]);

  const closeEditor = () => { request.current?.abort(); setBusy(false); setEditing(null); setError(''); search.current?.focus(); };

  const closePanel = () => { setMenu(null); closeEditor(); setRemoving(null); setOpen(false); };

  const filtered = items.filter(d => (!pinned || d.pinned) && `${d.name} ${d.url}`.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language))).sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const submit = async (event: React.FormEvent) => {

    event.preventDefault(); if (!editing || busy) return;

    if (!editing.name.trim()) { setError(copy.error); nameInput.current?.focus(); return; }

    const controller = new AbortController(); request.current?.abort(); request.current = controller; setBusy(true); setError('');

    try {

      const result = await resolveProfileHubInput(editing.url, controller.signal);

      if (controller.signal.aborted) return;

      if (result.kind !== 'directory' || !useSavedDirectoriesStore.getState().save({ ...editing, url: result.url })) { setError(copy.error); return; }

      closeEditor();

    } catch { if (!controller.signal.aborted) setError(copy.error); }

    finally { if (!controller.signal.aborted) setBusy(false); }

  };

  return <>

    <button type="button" className="pd-button sd-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}><Bookmark size={15} />{copy.title}<span className="sd-trigger-count">{items.length}</span></button>

    {open && <AppDialog titleId="saved-directories-title" descriptionId="saved-directories-description" className="pd-dialog sd-panel" initialFocusRef={search} onClose={menu ? () => { setMenu(null); menuTrigger.current?.focus(); } : closePanel}>

      <header><div className="sd-heading"><div className="sd-title-line"><Bookmark size={21} /><h2 id="saved-directories-title">{copy.title}</h2><span className="pd-count">{items.length}</span></div><p id="saved-directories-description" className="pd-muted">{copy.intro}</p></div><button type="button" className="pd-icon-button" aria-label={copy.close} onClick={closePanel}><X size={18} /></button></header>

      <div className="sd-tools"><label className="pd-search"><Search size={15} /><input ref={search} type="search" aria-label={copy.search} placeholder={copy.search} value={query} onChange={e => setQuery(e.target.value)} />{query && <button type="button" aria-label={copy.clear} onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14} /></button>}</label><select className="pd-select" aria-label={copy.all} value={pinned ? 'pinned' : 'all'} onChange={e => setPinned(e.target.value === 'pinned')}><option value="all">{copy.all}</option><option value="pinned">{copy.pinned}</option></select></div>

      {!available && <p role="status" className="sd-notice">{copy.storage}</p>}

      <div className="sd-rows" onScroll={() => setMenu(null)}>{filtered.length ? filtered.map(item => <div className="sd-row" key={item.id}>

        <button type="button" className="sd-open" aria-current={currentUrl && directoryIdentity(currentUrl) === directoryIdentity(item.url) ? true : undefined} onClick={() => { setOpen(false); onOpenUrl(item.url); }}><span className="sd-mark" aria-hidden="true">{item.name.slice(0, 2).toLocaleUpperCase(language)}</span><span><strong>{item.name}</strong><small title={item.url}>{item.url}</small></span>{currentUrl && directoryIdentity(currentUrl) === directoryIdentity(item.url) && <span className="sd-active-label">{language === 'pt-BR' ? 'Em exibição' : 'Viewing'}</span>}</button>

        <button type="button" className="sd-row-pin" aria-label={`${item.pinned ? copy.unpin : copy.pin}: ${item.name}`} aria-pressed={item.pinned} onClick={() => { useSavedDirectoriesStore.getState().save({ ...item, pinned: !item.pinned }); search.current?.focus(); }}><Bookmark size={15} /></button>

        <button type="button" className="sd-menu-trigger" aria-expanded={menu?.item.id === item.id} aria-label={`${language === 'pt-BR' ? 'Ações de' : 'Actions for'} ${item.name}`} onClick={event => { menuTrigger.current = event.currentTarget; setMenu(menu?.item.id === item.id ? null : { item, left: 0, top: 0 }); }}><MoreHorizontal size={16} /></button>

      </div>) : <p className="pd-shortcut-empty">{copy.empty}</p>}</div>

      {menu && <div ref={menuElement} role="group" aria-label={language === 'pt-BR' ? 'Ações do diretório' : 'Directory actions'} className="sd-popover" style={{ top: menu.top, left: menu.left }}><button type="button" onClick={() => { setError(''); setEditing({ ...menu.item }); setMenu(null); }}><Pencil size={14} />{copy.edit}</button><button type="button" className="sd-remove" onClick={() => { setRemoving(menu.item); setMenu(null); }}><Trash2 size={14} />{copy.remove}</button></div>}
      {removed && <div className="sd-notice" role="status">{copy.removed}<button type="button" className="pd-button" onClick={() => { if (useSavedDirectoriesStore.getState().save(removed)) { setRemoved(null); search.current?.focus(); } else setError(copy.error); }}>{copy.undo}</button></div>}

      {error && !editing && <p role="alert" className="sd-notice">{error}</p>}

      <footer><small className="pd-muted">{language === 'pt-BR' ? `${filtered.length} de ${items.length} diretórios` : `${filtered.length} of ${items.length} directories`} · {copy.local}</small><button type="button" className="pd-button pd-primary" onClick={() => { setError(''); setEditing({ id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, name: '', url: currentUrl, pinned: false }); }}><Plus size={16} />{copy.add}</button></footer>

    </AppDialog>}

    {open && editing && <AppDialog titleId="sd-edit-title" className="pd-dialog sd-editor" initialFocusRef={nameInput} onClose={closeEditor}><header><h2 id="sd-edit-title">{items.some(d => d.id === editing.id) ? copy.edit : copy.add}</h2><button type="button" className="pd-icon-button" aria-label={copy.close} onClick={closeEditor}><X size={17} /></button></header><form onSubmit={submit} noValidate><label>{copy.name}<input ref={nameInput} disabled={busy} value={editing.name} aria-describedby={error ? 'sd-error' : undefined} aria-invalid={Boolean(error)} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label><label>{copy.url}<input type="url" disabled={busy} value={editing.url} aria-describedby={error ? 'sd-error' : undefined} aria-invalid={Boolean(error)} onChange={e => setEditing({ ...editing, url: e.target.value })} /></label>{error && <p id="sd-error" role="alert">{error}</p>}<div><button type="button" className="pd-button" onClick={closeEditor}>{copy.cancel}</button><button type="submit" className="pd-button pd-primary" disabled={busy}>{busy ? copy.working : copy.save}</button></div></form></AppDialog>}

    {open && removing && <AppDialog titleId="sd-remove-title" className="pd-dialog sd-editor" onClose={() => { setRemoving(null); search.current?.focus(); }}><header><h2 id="sd-remove-title">{copy.confirm}</h2></header><div className="sd-notice"><p>{removing.name}</p><p className="pd-muted">{copy.removeHint}</p><div className="sd-confirm"><button type="button" className="pd-button" autoFocus onClick={() => { setRemoving(null); search.current?.focus(); }}>{copy.cancel}</button><button type="button" className="pd-button pd-danger" onClick={() => { useSavedDirectoriesStore.getState().remove(removing.id); setRemoved(removing); setRemoving(null); search.current?.focus(); }}>{copy.remove}</button></div></div></AppDialog>}

  </>;

}

