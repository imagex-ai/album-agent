import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Layers, Loader2, Minus, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getGlobalProfileSelection, useProfileHubStore } from '../../store/useProfileHubStore';
import { hubNavigation } from '../../services/profileHubRuntime';
import { profileHubReviewCopy, reviewText } from '../../services/profileHubReviewCopy';
import { AppDialog } from '../common/AppDialog';
import { FloatingActionBar } from './FloatingActionBar';
import './profile-directory.css';
import './profile-review.css';
import { scrollRestorationManager } from '../../services/scrollRestoration';
import { useProfileHubExecutionStore } from '../../store/useProfileHubExecutionStore';
import { profileHubExecutionCopy } from '../../services/profileHubExecutionCopy';

export function ProfileHubSelectionBar({ active }: { active: boolean }) {
  const profiles = useProfileHubStore(state => state.profiles);
  const routeToken = useProfileHubStore(state => state.routeToken);
  const language = useAppStore(state => state.settings.language);
  const copy = profileHubReviewCopy[language];
  const execCopy = profileHubExecutionCopy[language];

  const batch = useProfileHubExecutionStore(state => state.batch);
  const busy = useProfileHubExecutionStore(state => state.busy);
  const draft = useProfileHubExecutionStore(state => state.draft);
  const checking = useProfileHubExecutionStore(state => state.checking);
  const lastId = useProfileHubExecutionStore(state => state.lastId);
  const executionId = batch?.id ?? draft?.request_id ?? lastId;

  const selection = useMemo(() => getGlobalProfileSelection(profiles, false), [profiles]);
  const [clearing, setClearing] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Track if this execution was initiated or active in the current session
  const sessionBatchId = useRef<string | null>(null);
  if ((batch?.active || busy || draft) && executionId) {
    sessionBatchId.current = executionId;
  }

  const cancelRef = useRef<HTMLButtonElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setClearing(false); }, [active, routeToken]);

  // Auto-dismiss completed batch after 8 seconds if not interacted
  useEffect(() => {
    if (batch && !batch.active && !busy && sessionBatchId.current === batch.id) {
      const timer = setTimeout(() => {
        setDismissedId(batch.id);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [batch?.active, busy, batch?.id]);

  useEffect(() => {
    if (!active) return;
    const main = scrollRestorationManager.getContainer();
    if (!main) return;
    const align = () => {
      const rect = main.getBoundingClientRect();
      hostRef.current?.style.setProperty('--phr-bar-left', `${rect.left + rect.width / 2}px`);
      hostRef.current?.style.setProperty('--phr-bar-width', `${Math.max(0, Math.min(1100, rect.width - 24))}px`);
    };
    align();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align);
    observer?.observe(main);
    window.addEventListener('resize', align);
    return () => { observer?.disconnect(); window.removeEventListener('resize', align); };
  }, [active]);

  const openReview = () => {
    if (useProfileHubStore.getState().route?.mode === 'review') {
      document.getElementById('phr-summary')?.scrollIntoView({ block: 'nearest' });
    } else {
      hubNavigation.navigate({ mode: 'review' });
    }
  };

  const count = (value: number) => new Intl.NumberFormat(language).format(value);

  if (!active) return null;

  // 1. If user has active selection: show the canonical FloatingActionBar for reviewing selected items
  if (selection.count > 0) {
    return (
      <div ref={hostRef} className="phr-selection-host">
        <FloatingActionBar
          variant="review"
          selectedCount={selection.count}
          selectedSummary={reviewText(copy.total, { profiles: count(selection.groups.length), items: count(selection.count) })}
          previewThumbnails={selection.thumbnails}
          onOpenReview={openReview}
          onSaveToGallery={openReview}
          onDownloadZip={openReview}
          onClearSelection={() => setClearing(true)}
        />
        {clearing && active && (
          <AppDialog
            className="pd-dialog phr-clear-dialog"
            titleId="phr-clear-title"
            descriptionId="phr-clear-hint"
            onClose={() => setClearing(false)}
            initialFocusRef={cancelRef}
          >
            <header>
              <h2 id="phr-clear-title">{copy.clearTitle}</h2>
              <button type="button" className="pd-icon-button" onClick={() => setClearing(false)} aria-label={copy.close}>
                <X size={17} />
              </button>
            </header>
            <div className="pd-dialog-body">
              <p id="phr-clear-hint">{copy.clearHint}</p>
            </div>
            <footer>
              <button ref={cancelRef} type="button" className="pd-button" onClick={() => setClearing(false)}>
                {copy.keep}
              </button>
              <button
                type="button"
                className="pd-button"
                onClick={() => {
                  useProfileHubStore.getState().clearSelections();
                  setClearing(false);
                  requestAnimationFrame(() => document.getElementById('profile-hub-review-title')?.focus());
                }}
              >
                {copy.clear}
              </button>
            </footer>
          </AppDialog>
        )}
      </div>
    );
  }

  // 2. Smart Tracking Dock: Only show if an execution is actively running, or was part of this session
  const isActivelyRunning = Boolean(batch?.active || busy || checking || (draft && !batch));
  const isSessionBatch = Boolean(executionId && sessionBatchId.current === executionId);
  const isDismissed = Boolean(executionId && dismissedId === executionId);

  // If there's no active execution and it's not a fresh session batch, or if user dismissed it: don't render anything
  if (!executionId || isDismissed || (!isActivelyRunning && !isSessionBatch)) {
    return null;
  }

  const succeededCount = batch?.operations.filter(op => op.status === 'succeeded').length ?? 0;
  const failedCount = batch?.operations.filter(op => op.status === 'failed' || op.status === 'interrupted').length ?? 0;
  const totalCount = batch?.operations.length ?? 0;
  const percent = totalCount > 0 ? Math.round((succeededCount / totalCount) * 100) : 0;
  const isCompleted = !isActivelyRunning && Boolean(batch && !batch.active);

  // Minimized state: sleek floating circular button in corner
  if (isMinimized) {
    return (
      <button
        type="button"
        onClick={() => setIsMinimized(false)}
        className="phr-tracking-dock-minimized animate-view-slide"
        title={`${execCopy.tracking}: ${isCompleted ? execCopy.saved : `${succeededCount}/${totalCount}`}`}
        aria-label={execCopy.tracking}
      >
        {isActivelyRunning ? (
          <Loader2 size={18} className="animate-spin text-purple-400" />
        ) : isCompleted ? (
          <CheckCircle2 size={18} className="text-emerald-400" />
        ) : (
          <Layers size={18} className="text-purple-300" />
        )}
      </button>
    );
  }

  // Full compact pill state
  return (
    <div className="phr-tracking-dock animate-view-slide" role="status" aria-label={execCopy.tracking}>
      <button type="button" onClick={openReview} className="phr-tracking-dock-content" title={execCopy.tracking}>
        <span className="phr-tracking-dock-icon">
          {isActivelyRunning ? (
            <Loader2 size={16} className="animate-spin text-purple-400" />
          ) : isCompleted ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : failedCount > 0 ? (
            <AlertCircle size={16} className="text-amber-400" />
          ) : (
            <Layers size={16} className="text-purple-300" />
          )}
        </span>
        <div className="phr-tracking-dock-info">
          <strong className="phr-tracking-dock-title">
            {isCompleted ? execCopy.saved : execCopy.tracking}
          </strong>
          <small className="phr-tracking-dock-status">
            {totalCount > 0
              ? `${succeededCount} / ${totalCount} ${execCopy.saved.toLowerCase()}`
              : isActivelyRunning
              ? execCopy.running
              : execCopy.confirmed}
          </small>
        </div>
      </button>

      <div className="phr-tracking-dock-actions">
        <button
          type="button"
          onClick={openReview}
          className="phr-tracking-dock-btn"
          title={copy.review}
          aria-label={copy.review}
        >
          <ExternalLink size={13} />
        </button>
        <button
          type="button"
          onClick={() => setIsMinimized(true)}
          className="phr-tracking-dock-btn"
          title="Minimizar"
          aria-label="Minimizar"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          onClick={() => setDismissedId(executionId)}
          className="phr-tracking-dock-btn phr-tracking-dock-close"
          title={copy.close}
          aria-label={copy.close}
        >
          <X size={13} />
        </button>
      </div>

      {totalCount > 0 && isActivelyRunning && (
        <div className="phr-tracking-dock-progress" aria-hidden="true">
          <div className="phr-tracking-dock-progress-bar" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}
