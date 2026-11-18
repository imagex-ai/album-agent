/**
 * playerOverlayStack.ts
 *
 * Deterministic capture-phase overlay & Escape priority stack for video player layers.
 * Ensures nested video player menus, bottom sheets, fullscreen, shortcuts dialogs,
 * and player containers consume Escape in strict priority order before sibling
 * bubble listeners on document can prematurely close backing views.
 */

/**
 * HTML attribute to mark a native <dialog> as owned by the player overlay stack.
 * Prevents external native <dialog open> guards from treating the player's own
 * modal dialogs (e.g. shortcuts dialog, player settings) as blocking external dialogs.
 */
export const PLAYER_OVERLAY_LAYER_ATTR = 'data-player-overlay-layer';

export const PLAYER_OVERLAY_PRIORITY = {
  MENU: 500,
  BOTTOM_SHEET: 450,
  SHORTCUTS_DIALOG: 400,
  FULLSCREEN: 300,
  WATCH_VIEW: 200,
  VIDEO_MODAL: 150,
  MINI_PLAYER: 100,
} as const;

export type PlayerOverlayPriority =
  | (typeof PLAYER_OVERLAY_PRIORITY)[keyof typeof PLAYER_OVERLAY_PRIORITY]
  | (number & {});

export interface PlayerOverlayTriggerElement {
  focus?: (options?: FocusOptions) => void;
  isConnected?: boolean;
}

export interface PlayerOverlayEntry {
  id: string;
  priority: PlayerOverlayPriority;
  onDismiss: () => void;
  triggerElement?: HTMLElement | PlayerOverlayTriggerElement | null;
  dialogElement?: HTMLElement | { open?: boolean; hasAttribute?: (name: string) => boolean } | null;
}

export interface OverlayDocumentLike {
  addEventListener(
    type: string,
    listener: (event: any) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: (event: any) => void,
    options?: boolean | EventListenerOptions
  ): void;
  querySelector?: (selector: string) => any;
  querySelectorAll?: (selector: string) => any;
}

interface InternalPlayerOverlayEntry extends PlayerOverlayEntry {
  seq: number;
  unregistered: boolean;
}

interface DocumentOverlayStackState {
  entries: InternalPlayerOverlayEntry[];
  listener: ((event: any) => void) | null;
  seqCounter: number;
}

const documentStacks = new WeakMap<object, DocumentOverlayStackState>();

function resolveDoc(doc?: OverlayDocumentLike | null): OverlayDocumentLike | null {
  if (doc === null) return null;
  if (doc !== undefined) return doc;
  if (typeof document !== 'undefined') return document as unknown as OverlayDocumentLike;
  return null;
}

function getTopEntry(entries: InternalPlayerOverlayEntry[]): InternalPlayerOverlayEntry | null {
  if (entries.length === 0) return null;
  let top = entries[0];
  for (let i = 1; i < entries.length; i++) {
    const candidate = entries[i];
    if (
      candidate.priority > top.priority ||
      (candidate.priority === top.priority && candidate.seq > top.seq)
    ) {
      top = candidate;
    }
  }
  return top;
}

function isExternalDialogBlocking(
  doc: OverlayDocumentLike,
  activeEntries: InternalPlayerOverlayEntry[]
): boolean {
  if (typeof doc.querySelectorAll === 'function') {
    let openDialogs: any[] = [];
    try {
      const list = doc.querySelectorAll('dialog[open]');
      openDialogs = Array.from(list || []);
    } catch {
      openDialogs = [];
    }

    if (openDialogs.length > 0) {
      // The topmost open dialog in browser top-layer / DOM order is the last one
      const topmostDialog = openDialogs[openDialogs.length - 1];

      // Check if topmost dialog is player-owned via attribute
      if (
        typeof topmostDialog.hasAttribute === 'function' &&
        topmostDialog.hasAttribute(PLAYER_OVERLAY_LAYER_ATTR)
      ) {
        return false;
      }

      // Check if topmost dialog matches an active registered player overlay layer's dialogElement
      const isOwnedDialog = activeEntries.some(
        (entry) => !entry.unregistered && entry.dialogElement === topmostDialog
      );
      if (isOwnedDialog) {
        return false;
      }

      // Topmost open dialog is unowned / external; do NOT steal its Escape
      return true;
    }
    return false;
  }

  // Fallback if querySelectorAll is not implemented
  if (typeof doc.querySelector === 'function') {
    try {
      const externalDialog = doc.querySelector(
        `dialog[open]:not([${PLAYER_OVERLAY_LAYER_ATTR}])`
      );
      return Boolean(externalDialog);
    } catch {
      return false;
    }
  }

  return false;
}

function unregisterEntry(
  entry: InternalPlayerOverlayEntry,
  state: DocumentOverlayStackState,
  doc: OverlayDocumentLike
) {
  if (entry.unregistered) return;
  entry.unregistered = true;

  const index = state.entries.indexOf(entry);
  if (index !== -1) {
    state.entries.splice(index, 1);
  }

  if (state.entries.length === 0 && state.listener) {
    try {
      doc.removeEventListener('keydown', state.listener, { capture: true });
    } catch {
      // safe fallback if listener removal throws
    }
    state.listener = null;
  }
}

function createKeyDownListener(
  state: DocumentOverlayStackState,
  doc: OverlayDocumentLike
): (event: any) => void {
  return function handleKeyDown(event: any) {
    if (!event) return;
    if (event.defaultPrevented) return;
    if (event.key !== 'Escape' && event.key !== 'Esc') return;

    if (isExternalDialogBlocking(doc, state.entries)) {
      return;
    }

    const topEntry = getTopEntry(state.entries);
    if (!topEntry) return;

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    // Dismiss & unregister top entry
    unregisterEntry(topEntry, state, doc);

    try {
      topEntry.onDismiss();
    } finally {
      if (
        topEntry.triggerElement &&
        typeof (topEntry.triggerElement as any).focus === 'function' &&
        (topEntry.triggerElement as { isConnected?: boolean }).isConnected !== false
      ) {
        try {
          (topEntry.triggerElement as any).focus({ preventScroll: true });
        } catch {
          // Guard safely against focus errors
        }
      }
    }
  };
}

/**
 * Registers an overlay layer into the capture-phase Escape priority stack.
 * Returns an idempotent unregister cleanup callback.
 */
export function registerPlayerOverlayLayer(
  entry: PlayerOverlayEntry,
  doc?: OverlayDocumentLike | null
): () => void {
  if (
    !entry ||
    typeof entry.id !== 'string' ||
    entry.id.trim().length === 0 ||
    typeof entry.onDismiss !== 'function' ||
    typeof entry.priority !== 'number' ||
    !Number.isFinite(entry.priority)
  ) {
    throw new TypeError(
      'Invalid PlayerOverlayEntry: id must be non-empty string, priority must be a finite number, onDismiss must be a function'
    );
  }

  const resolvedDoc = resolveDoc(doc);
  if (!resolvedDoc) {
    return () => {};
  }

  let state = documentStacks.get(resolvedDoc as object);
  if (!state) {
    state = {
      entries: [],
      listener: null,
      seqCounter: 0,
    };
    documentStacks.set(resolvedDoc as object, state);
  }

  // Deduplicate existing entry with the same ID if registered without prior cleanup
  const existingIdx = state.entries.findIndex((e) => e.id === entry.id);
  if (existingIdx !== -1) {
    const existing = state.entries[existingIdx];
    existing.unregistered = true;
    state.entries.splice(existingIdx, 1);
  }

  state.seqCounter = (state.seqCounter || 0) + 1;
  const internalEntry: InternalPlayerOverlayEntry = {
    ...entry,
    seq: state.seqCounter,
    unregistered: false,
  };

  state.entries.push(internalEntry);

  if (!state.listener) {
    const listener = createKeyDownListener(state, resolvedDoc);
    try {
      resolvedDoc.addEventListener('keydown', listener, { capture: true });
      state.listener = listener;
    } catch (err) {
      state.listener = null;
      throw err;
    }
  }

  let unregCalled = false;
  return () => {
    if (unregCalled) return;
    unregCalled = true;
    unregisterEntry(internalEntry, state!, resolvedDoc);
  };
}

/**
 * Returns true if an active player overlay layer exists with priority strictly greater than `priority`.
 */
export function hasActivePlayerOverlayAbove(
  priority: number,
  doc?: OverlayDocumentLike | null
): boolean {
  const resolvedDoc = resolveDoc(doc);
  if (!resolvedDoc) return false;

  const state = documentStacks.get(resolvedDoc as object);
  if (!state || state.entries.length === 0) return false;

  return state.entries.some((e) => !e.unregistered && e.priority > priority);
}
