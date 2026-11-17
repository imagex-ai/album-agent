import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { movePlayerHost } from './movePlayerHost';

/**
 * Keep the React player mounted while its host moves between connected slots.
 * The owner and parking slot must outlive both visible destinations.
 */
export function PersistentPlayerPortal({
  target,
  parking,
  children,
}: {
  target: HTMLElement | null;
  parking: HTMLElement;
  children: React.ReactNode;
}) {
  const [host] = useState(() => parking.ownerDocument.createElement('div'));

  useLayoutEffect(() => {
    host.style.width = '100%';
    host.style.height = '100%';
    parking.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host, parking]);

  useLayoutEffect(() => {
    const destination = target?.isConnected ? target : parking;
    const video = host.querySelector('video');
    const wasPlaying = Boolean(video && !video.paused && !video.ended);
    movePlayerHost(host, destination);
    if (wasPlaying && video && video.paused) {
      void video.play().catch(() => {});
    }
  }, [host, target, parking]);

  return createPortal(children, host);
}
