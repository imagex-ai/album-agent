import React, { useEffect, useRef } from 'react';
import { ModalPortal } from './ModalPortal';

/** App-owned modal contents with native focus containment and background isolation. */
export function AppDialog({ children, titleId, descriptionId, className = '', onClose, initialFocusRef }: {
  children: React.ReactNode; titleId: string; descriptionId?: string; className?: string;
  onClose: () => void; initialFocusRef?: React.RefObject<HTMLElement>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    initialFocusRef?.current?.focus();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [initialFocusRef]);
  return <ModalPortal><dialog ref={ref} className={className} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>{children}</dialog></ModalPortal>;
}
