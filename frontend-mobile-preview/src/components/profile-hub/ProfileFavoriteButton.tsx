import React, { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export function ProfileFavoriteButton({ pressed, label, onToggle }: {
  pressed: boolean; label: string; onToggle: () => boolean;
}) {
  const disabledMotion = useAppStore(state => state.settings.disableAllAnimations);
  const pending = useRef<boolean | null>(null);
  const sequence = useRef(0);
  const [motion, setMotion] = useState<{ kind: 'add' | 'remove'; id: number } | null>(null);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { if (preference.matches) { pending.current = null; setMotion(null); } };
    preference.addEventListener('change', stop);
    return () => preference.removeEventListener('change', stop);
  }, []);

  useEffect(() => {
    if (disabledMotion) { pending.current = null; setMotion(null); return; }
    // Mounting and changes from other controls must not replay a click animation.
    if (pending.current === null || pending.current !== pressed) return;
    pending.current = null;
    setMotion({ kind: pressed ? 'add' : 'remove', id: ++sequence.current });
  }, [pressed, disabledMotion]);

  const toggle = () => {
    pending.current = !pressed;
    if (!onToggle()) { pending.current = null; return; }
    if (disabledMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pending.current = null;
      setMotion(null);
    }
  };

  return <button type="button" className="pd-card-favorite" onClick={toggle}
    aria-pressed={pressed} aria-label={label} title={label}
    data-heart-motion={motion?.kind} data-motion-disabled={disabledMotion || undefined}>
    <Heart key={motion?.id ?? 'idle'} size={14} strokeWidth={2.2}
      fill={pressed ? 'currentColor' : 'none'}
      onAnimationEnd={() => setMotion(current => current?.id === motion?.id ? null : current)} />
  </button>;
}
