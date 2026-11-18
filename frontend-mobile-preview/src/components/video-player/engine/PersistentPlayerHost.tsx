import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PersistentPlayerPortal } from './PersistentPlayerPortal';
import { UniversalVideoPlayer, type UniversalVideoPlayerHandle } from '../ui/UniversalVideoPlayer';
import { usePersistentPlayerStore } from '../../../store/usePersistentPlayerStore';
import { useMiniPlayerStore } from '../../../store/useMiniPlayerStore';
import { useAppStore } from '../../../store/useAppStore';
import type { PlaybackHandoffSnapshot, UniversalPlayerDensity, UniversalVideoSource } from './videoPlayerCore';

function resolveSourceKey(source?: UniversalVideoSource | null): string {
  if (!source) return '';
  return source.id || source.originalUrl || source.sourceUrl || source.streamUrl || '';
}

export const PersistentPlayerHost: React.FC = () => {
  const [parkingEl, setParkingEl] = useState<HTMLDivElement | null>(null);

  const modalSlot = usePersistentPlayerStore((s) => s.modalSlot);
  const watchSlot = usePersistentPlayerStore((s) => s.watchSlot);
  const miniSlot = usePersistentPlayerStore((s) => s.miniSlot);
  const setHostMounted = usePersistentPlayerStore((s) => s.setHostMounted);
  const setActiveSourceKey = usePersistentPlayerStore((s) => s.setActiveSourceKey);
  const setPlayerHandle = usePersistentPlayerStore((s) => s.setPlayerHandle);

  const activeSession = useMiniPlayerStore((s) => s.activeSession);
  const pendingExpandHandoff = useMiniPlayerStore((s) => s.pendingExpandHandoff);
  const updateHandoff = useMiniPlayerStore((s) => s.updateHandoff);
  const consumePendingExpandHandoff = useMiniPlayerStore((s) => s.consumePendingExpandHandoff);

  const settings = useAppStore((s) => s.settings);

  useEffect(() => {
    setHostMounted(true);
    return () => {
      setHostMounted(false);
      setActiveSourceKey('');
      setPlayerHandle(null);
    };
  }, [setHostMounted, setActiveSourceKey, setPlayerHandle]);

  // Safety timeout: if expandToOrigin set pendingExpandHandoff for a view that never mounts
  // (e.g. missing route), clear it after 2.5s so the parked player doesn't stay alive forever.
  useEffect(() => {
    if (!pendingExpandHandoff || modalSlot || watchSlot || activeSession) return;
    const timer = window.setTimeout(() => {
      const current = useMiniPlayerStore.getState().pendingExpandHandoff;
      if (current && current.capturedAt === pendingExpandHandoff.capturedAt) {
        consumePendingExpandHandoff(current.source.id);
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [pendingExpandHandoff, modalSlot, watchSlot, activeSession, consumePendingExpandHandoff]);

  const activeOwner = useMemo<{
    kind: 'modal' | 'watch' | 'mini' | 'parking';
    source: UniversalVideoSource;
    density: UniversalPlayerDensity;
    target: HTMLElement | null;
    seedHandoff?: PlaybackHandoffSnapshot | null;
  } | null>(() => {
    if (modalSlot) {
      return {
        kind: 'modal',
        source: modalSlot.source,
        density: 'cinema',
        target: modalSlot.element,
        seedHandoff: modalSlot.initialHandoff,
      };
    }
    if (watchSlot) {
      return {
        kind: 'watch',
        source: watchSlot.source,
        density: 'cinema',
        target: watchSlot.element,
        seedHandoff: watchSlot.initialHandoff,
      };
    }
    if (activeSession) {
      return {
        kind: 'mini',
        source: activeSession.source,
        density: 'mini',
        target: miniSlot?.sourceId === activeSession.source.id ? miniSlot.element : null,
        seedHandoff: activeSession.handoff,
      };
    }
    if (pendingExpandHandoff) {
      return {
        kind: 'parking',
        source: pendingExpandHandoff.source,
        density: 'cinema',
        target: null,
        seedHandoff: pendingExpandHandoff.handoff,
      };
    }
    return null;
  }, [modalSlot, watchSlot, activeSession, miniSlot, pendingExpandHandoff]);

  const sourceKey = resolveSourceKey(activeOwner?.source);

  useEffect(() => {
    setActiveSourceKey(sourceKey);
  }, [sourceKey, setActiveSourceKey]);

  // Seed initialHandoff, canonical source, and onRenewStream strictly once per sourceKey
  // so transitioning the same video between Modal / WatchView / MiniPlayer never
  // re-triggers a seek, degrades source metadata, or drops stream renewal.
  const seededRef = useRef<{
    sourceKey: string;
    handoff: PlaybackHandoffSnapshot | null;
    source: UniversalVideoSource | null;
    onRenewStream?: () => Promise<any> | any;
  }>({
    sourceKey: '',
    handoff: null,
    source: null,
    onRenewStream: undefined,
  });
  if (seededRef.current.sourceKey !== sourceKey) {
    seededRef.current = {
      sourceKey,
      handoff: activeOwner?.seedHandoff ?? null,
      source: activeOwner?.source ?? null,
      onRenewStream: activeOwner?.kind === 'modal' ? modalSlot?.onRenewStream : undefined,
    };
  } else if (activeOwner?.source) {
    const prev = seededRef.current.source;
    const next = activeOwner.source;
    const prevQuals = Array.isArray(prev?.qualities) ? prev.qualities : [];
    const nextQuals = Array.isArray(next.qualities) ? next.qualities : [];
    seededRef.current.source = {
      ...(prev || {}),
      ...next,
      sourceType: next.sourceType || prev?.sourceType,
      streamUrl: next.streamUrl || prev?.streamUrl || '',
      masterHlsUrl: next.masterHlsUrl || prev?.masterHlsUrl,
      qualities: nextQuals.length >= prevQuals.length ? nextQuals : prevQuals,
    };
    if (activeOwner.kind === 'modal' && modalSlot?.onRenewStream) {
      seededRef.current.onRenewStream = modalSlot.onRenewStream;
    }
  }
  const effectiveSource = seededRef.current.source || activeOwner?.source;

  const handlePlayerRef = useCallback(
    (handle: UniversalVideoPlayerHandle | null) => {
      setPlayerHandle(handle);
    },
    [setPlayerHandle]
  );

  const handlePlaybackSnapshot = useCallback(
    (snap: PlaybackHandoffSnapshot) => {
      if (activeOwner?.kind === 'modal') {
        modalSlot?.onPlaybackSnapshot?.(snap);
      } else if (activeOwner?.kind === 'mini') {
        if (miniSlot?.onPlaybackSnapshot) {
          miniSlot.onPlaybackSnapshot(snap);
        } else {
          updateHandoff(snap);
        }
      }
    },
    [activeOwner?.kind, modalSlot, miniSlot, updateHandoff]
  );

  return (
    <>
      <div
        ref={setParkingEl}
        aria-hidden="true"
        data-persistent-player-parking="true"
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      {parkingEl && activeOwner && (
        <PersistentPlayerPortal target={activeOwner.target} parking={parkingEl}>
          <UniversalVideoPlayer
            ref={handlePlayerRef}
            source={effectiveSource}
            density={activeOwner.density}
            posterUrl={activeOwner.kind === 'watch' ? watchSlot?.posterUrl : undefined}
            aspectRatio={activeOwner.kind === 'watch' ? watchSlot?.aspectRatio : '16:9'}
            autoPlayOnActive={
              activeOwner.kind === 'modal'
                ? modalSlot?.autoPlayOnActive ?? true
                : activeOwner.kind === 'watch'
                ? watchSlot?.autoPlayOnActive ?? true
                : false
            }
            ambientGlowEnabled={activeOwner.kind === 'watch' ? watchSlot?.ambientGlowEnabled : false}
            suspended={
              activeOwner.kind === 'watch'
                ? Boolean(watchSlot?.suspended)
                : activeOwner.kind === 'mini'
                ? Boolean(miniSlot?.suspended)
                : false
            }
            isActive={
              activeOwner.kind === 'modal'
                ? true
                : activeOwner.kind === 'watch'
                ? watchSlot?.isActive ?? true
                : activeOwner.kind === 'mini'
                ? miniSlot?.isActive ?? false
                : false
            }
            initialMuted={
              activeOwner.kind === 'modal'
                ? modalSlot?.initialMuted ?? false
                : activeOwner.kind === 'watch'
                ? watchSlot?.initialMuted ?? true
                : false
            }
            initialQuality={activeOwner.kind === 'watch' ? watchSlot?.initialQuality ?? 'auto' : 'auto'}
            initialHandoff={seededRef.current.handoff}
            language={activeOwner.kind === 'mini' ? miniSlot?.language : undefined}
            motionSettings={activeOwner.kind === 'mini' ? miniSlot?.motionSettings : settings}
            isTheater={
              activeOwner.kind === 'modal'
                ? modalSlot?.isTheater
                : activeOwner.kind === 'watch'
                ? watchSlot?.isTheater
                : undefined
            }
            onToggleTheater={
              activeOwner.kind === 'modal'
                ? modalSlot?.onToggleTheater
                : activeOwner.kind === 'watch'
                ? watchSlot?.onToggleTheater
                : undefined
            }
            onPlaybackSnapshot={handlePlaybackSnapshot}
            onPlaybackStateChange={
              activeOwner.kind === 'mini' ? miniSlot?.onPlaybackStateChange : undefined
            }
            onQualitiesFetched={activeOwner.kind === 'modal' ? modalSlot?.onQualitiesFetched : undefined}
            onRenewStream={activeOwner.kind === 'modal' ? (modalSlot?.onRenewStream ?? seededRef.current.onRenewStream) : seededRef.current.onRenewStream}
            onMinimizeToMiniPlayer={
              activeOwner.kind === 'modal'
                ? modalSlot?.onMinimizeToMiniPlayer
                : activeOwner.kind === 'watch'
                ? watchSlot?.onMinimizeToMiniPlayer
                : undefined
            }
            onClose={activeOwner.kind === 'modal' ? modalSlot?.onClose : undefined}
            className={activeOwner.kind === 'modal' ? 'w-full h-full rounded-none border-0' : 'w-full h-full'}
          />
        </PersistentPlayerPortal>
      )}
    </>
  );
};
