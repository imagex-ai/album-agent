import React, { useState, useRef } from 'react';
import {
  X,
  ExternalLink,
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Layers,
  Clock,
  Film,
  Pause,
  Play,
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import {
  getTaskDockAnimationClass,
  getSpeedClass,
  getDistanceClass
} from '../../services/motionConfig';
import { ExtractionJob } from '../../types';

export const MiniTaskDock: React.FC = () => {
  const {
    jobs,
    activeJob,
    isDockMinimized,
    setDockMinimized,
    setActiveJobById,
    navigateToView,
    settings,
    cancelJob,
    pauseJob,
    resumeJob,
    retryJob,
    sessionJobIds,
    dismissedDockJobIds,
    dismissDockJob,
    dismissAllDockJobs,
    setHighlightedItemId
  } = useAppStore();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [wrapTasks, setWrapTasks] = useState<boolean>(false);
  const tasksScrollRef = useRef<HTMLDivElement | null>(null);
  const t = translations[settings.language]?.dock || translations['en-US'].dock;
  const isEn = settings.language === 'en-US';

  // Mutually exclusive job classification predicates
  const isJobQueued = (j: ExtractionJob): boolean =>
    j.status === 'queued' ||
    (j.status !== 'completed' &&
      j.status !== 'cancelled' &&
      j.status !== 'failed' &&
      Boolean(j.currentStage) &&
      (j.currentStage.toLowerCase().includes('na fila') || j.currentStage.toLowerCase().includes('fila') || j.currentStage.toLowerCase().includes('queue')));

  const isJobOngoing = (j: ExtractionJob): boolean =>
    (j.status === 'active' || j.status === 'paused') && !isJobQueued(j);

  const isJobCompleted = (j: ExtractionJob): boolean =>
    j.status === 'completed';

  const isJobFailedOrCancelled = (j: ExtractionJob): boolean =>
    j.status === 'failed' || j.status === 'cancelled';

  // Filter ONLY jobs created or running in the CURRENT SESSION that haven't been dismissed from dock
  const sessionJobs = jobs.filter(j =>
    sessionJobIds.includes(j.id) && !dismissedDockJobIds.includes(j.id)
  );

  const ongoingJobs = sessionJobs.filter(isJobOngoing);
  const queuedJobs = sessionJobs.filter(isJobQueued);
  // Dynamic list of completed jobs in current session without hardcoded cap
  const completedJobs = sessionJobs.filter(isJobCompleted);
  const failedOrCancelledJobs = sessionJobs.filter(isJobFailedOrCancelled);

  const totalUnfinished = ongoingJobs.length + queuedJobs.length;

  // Combine dock tasks: ongoing first, then queued, then recent completed in session, then failed/cancelled, deduplicated
  const seenIds = new Set<string>();
  const dockJobs: ExtractionJob[] = [];
  const candidateJobs: ExtractionJob[] = [
    ...ongoingJobs,
    ...queuedJobs,
    ...completedJobs,
    ...failedOrCancelledJobs
  ];

  // Include activeJob if part of current session, not dismissed, and not already in candidates
  if (
    activeJob &&
    sessionJobIds.includes(activeJob.id) &&
    !dismissedDockJobIds.includes(activeJob.id) &&
    !candidateJobs.some(j => j.id === activeJob.id)
  ) {
    if (activeJob.status === 'active' || activeJob.status === 'queued' || activeJob.status === 'paused' || activeJob.status === 'completed' || activeJob.status === 'failed' || activeJob.status === 'cancelled') {
      candidateJobs.unshift(activeJob);
    }
  }

  for (const j of candidateJobs) {
    if (!seenIds.has(j.id)) {
      seenIds.add(j.id);
      dockJobs.push(j);
    }
  }

  // If there are no tasks in dock, do not render dock
  if (dockJobs.length === 0) {
    return null;
  }

  // Determine currently focused job
  const focusedJob: ExtractionJob | null =
    (selectedJobId ? dockJobs.find(j => j.id === selectedJobId) : null) ||
    (activeJob && dockJobs.some(j => j.id === activeJob.id) ? dockJobs.find(j => j.id === activeJob.id) : null) ||
    ongoingJobs[0] ||
    queuedJobs[0] ||
    completedJobs[0] ||
    failedOrCancelledJobs[0] ||
    dockJobs[0] ||
    null;

  if (!focusedJob) return null;

  const isCompleted = focusedJob.status === 'completed';
  const isFailed = focusedJob.status === 'failed';
  const isCancelled = focusedJob.status === 'cancelled';
  const isQueued = isJobQueued(focusedJob);
  const isActive = focusedJob.status === 'active' && !isQueued;
  const isPaused = focusedJob.status === 'paused';
  const isVideo = (focusedJob.mode as string) === 'video_save' || (focusedJob.mode as string) === 'video_downloader';
  const safeProgress = Math.max(0, Math.min(100, Number(focusedJob.progressPercent) || 0));

  // 1. Minimized View:
  // - Mobile (Safari/Chrome on phone, < 768px): Strictly a small circular badge (~44px) showing the active count.
  // - Desktop (>= 768px): Informative horizontal pill with percentage and title.
  if (isDockMinimized) {
    return (
      <>
        {/* MOBILE: Circular floating button only (< 768px) */}
        <div
          className={`md:hidden fixed right-3.5 z-40 ${getTaskDockAnimationClass(settings.taskDockAnimation || 'slide-up', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')}`}
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}
        >
          <button
            onClick={() => setDockMinimized(false)}
            className="w-11 h-11 rounded-full bg-brand-600/95 hover:bg-brand-500 text-white shadow-2xl border-2 border-brand-400/50 flex items-center justify-center relative backdrop-blur-xl active:scale-90 transition-all"
            title={t.mobileUnfinishedTitle.replace('{count}', String(totalUnfinished))}
          >
            {ongoingJobs.length > 0 ? (
              <Activity size={20} className="text-white animate-pulse" />
            ) : queuedJobs.length > 0 ? (
              <Clock size={20} className="text-amber-300" />
            ) : (
              <CheckCircle2 size={20} className="text-emerald-300" />
            )}

            {/* Badge showing dynamic count */}
            {totalUnfinished > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white font-mono font-extrabold text-[10px] flex items-center justify-center border-2 border-surface shadow-md">
                {totalUnfinished}
              </span>
            ) : completedJobs.length > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-emerald-500 text-white font-mono font-extrabold text-[10px] flex items-center justify-center border-2 border-surface shadow-md">
                {completedJobs.length}
              </span>
            ) : null}
          </button>
        </div>

        {/* DESKTOP: Sleek horizontal pill (>= 768px) */}
        <div className={`hidden md:flex fixed bottom-4 right-4 z-40 ${getTaskDockAnimationClass(settings.taskDockAnimation || 'slide-up', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')}`}>
          <button
            onClick={() => setDockMinimized(false)}
            className="glass-panel-elevated rounded-full py-2.5 px-4 flex items-center gap-2.5 border border-brand-500/40 shadow-2xl bg-surface/95 backdrop-blur-xl hover:border-brand-400 hover:scale-105 active:scale-95 transition-all text-xs font-semibold text-slate-200 group"
            title={t.expandDock}
          >
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isCompleted
                  ? 'bg-emerald-400'
                  : isPaused
                  ? 'bg-amber-400'
                  : isQueued
                  ? 'bg-amber-400'
                  : 'bg-brand-400 animate-pulse'
              }`}
            />
            <span className="font-mono text-brand-300 font-bold">
              {safeProgress}%
            </span>
            <span className="text-slate-300 text-[11px] truncate max-w-[220px]">
              {totalUnfinished > 1
                ? `${t.runningCount.replace('{count}', String(ongoingJobs.length))}${queuedJobs.length > 0 ? ` ${t.queuedCount.replace('{count}', String(queuedJobs.length))}` : ''}`
                : totalUnfinished === 1
                ? focusedJob.title
                : completedJobs.length > 1
                ? t.completedCount.replace('{count}', String(completedJobs.length))
                : focusedJob.title}
            </span>
            <ChevronUp size={14} className="text-slate-400 group-hover:text-slate-200 transition-colors shrink-0 ml-0.5" />
          </button>
        </div>
      </>
    );
  }

  // 2. Expanded View: Sleek Modern Tabbed Dock
  return (
    <div
      className={`fixed left-3 right-3 md:left-68 md:right-4 md:bottom-4 z-40 ${getTaskDockAnimationClass(settings.taskDockAnimation || 'slide-up', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')}`}
      style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}
    >
      <div className="glass-panel-elevated rounded-2xl p-2.5 sm:p-3 sm:px-4 flex flex-col gap-2 border border-brand-500/30 shadow-2xl bg-surface/95 backdrop-blur-xl">
        {/* Horizontal tabs/pills switcher bar */}
        {dockJobs.length > 0 && (
          <div className="flex items-center gap-1.5 max-w-full pb-1.5 border-b border-border/40">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider shrink-0 flex items-center gap-1 mr-0.5">
              <Layers size={11} className="text-brand-400" />
              {t.tasksHeader} ({dockJobs.length}):
            </span>

            {!wrapTasks && dockJobs.length > 3 && (
              <button
                type="button"
                onClick={() => tasksScrollRef.current?.scrollBy({ left: -260, behavior: 'smooth' })}
                className="shrink-0 p-1 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-white transition-colors cursor-pointer"
                title={isEn ? 'Scroll tasks left' : 'Rolar tarefas para a esquerda'}
              >
                <ChevronLeft size={13} />
              </button>
            )}

            <div
              ref={tasksScrollRef}
              onWheel={(e) => {
                if (!wrapTasks && tasksScrollRef.current && e.deltaY !== 0) {
                  const el = tasksScrollRef.current;
                  if (el.scrollWidth > el.clientWidth) {
                    e.preventDefault();
                    el.scrollLeft += e.deltaY;
                  }
                }
              }}
              className={`flex-1 flex items-center gap-1.5 min-w-0 py-0.5 ${
                wrapTasks
                  ? 'flex-wrap max-h-36 overflow-y-auto custom-scrollbar'
                  : 'overflow-x-auto custom-scrollbar touch-scroll scroll-smooth'
              }`}
            >
              {dockJobs.map((j) => {
                const isCurrent = j.id === focusedJob.id;
                const isJobComp = isJobCompleted(j);
                const isJobQue = isJobQueued(j);
                const isJobPau = j.status === 'paused';
                const isJobFail = j.status === 'failed';
                const isJobCanc = j.status === 'cancelled';
                const pillProgress = Math.max(0, Math.min(100, Number(j.progressPercent) || 0));

                return (
                  <div
                    key={j.id}
                    className={`group px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                      isCurrent
                        ? 'bg-brand-500/30 text-brand-300 border border-brand-500/50 shadow-sm font-semibold'
                        : 'bg-surface-elevated/70 text-slate-400 hover:text-slate-200 hover:bg-surface-elevated border border-transparent'
                    }`}
                  >
                    <button
                      onClick={() => {
                        setSelectedJobId(j.id);
                        setActiveJobById(j.id);
                      }}
                      className="flex items-center gap-1.5 min-w-0 cursor-pointer"
                      title={j.title}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isJobComp
                            ? 'bg-emerald-400'
                            : isJobFail
                            ? 'bg-rose-400'
                            : isJobCanc
                            ? 'bg-slate-400'
                            : isJobQue || isJobPau
                            ? 'bg-amber-400'
                            : 'bg-brand-400 animate-pulse'
                        }`}
                      />
                      <span className="truncate max-w-[100px] sm:max-w-[140px]">{j.title}</span>
                      <span className="font-mono text-[9px] text-slate-400">
                        {isJobComp ? '100%' : isJobFail ? (isEn ? 'Failed' : 'Falhou') : isJobCanc ? (isEn ? 'Cancelled' : 'Cancelado') : isJobQue ? t.inQueuePill : isJobPau ? t.paused : `${pillProgress}%`}
                      </span>
                    </button>

                    {/* Individual tab close button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissDockJob(j.id);
                        if (selectedJobId === j.id) {
                          setSelectedJobId(null);
                        }
                      }}
                      className="p-0.5 rounded hover:bg-surface-hover text-slate-400 hover:text-rose-300 transition-colors ml-0.5 cursor-pointer"
                      title={t.dismissTask}
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>

            {dockJobs.length > 3 && (
              <div className="flex items-center gap-1 shrink-0">
                {!wrapTasks && (
                  <button
                    type="button"
                    onClick={() => tasksScrollRef.current?.scrollBy({ left: 260, behavior: 'smooth' })}
                    className="p-1 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title={isEn ? 'Scroll tasks right' : 'Rolar tarefas para a direita'}
                  >
                    <ChevronRight size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setWrapTasks(prev => !prev)}
                  className={`px-2 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                    wrapTasks
                      ? 'bg-violet-600 text-white border-violet-500'
                      : 'bg-surface-elevated hover:bg-surface-hover border-border text-slate-300 hover:text-white'
                  }`}
                  title={isEn ? (wrapTasks ? 'Single row scroll' : 'Show all tasks wrapped') : (wrapTasks ? 'Mostrar em linha única' : 'Expandir todas as tarefas')}
                >
                  <LayoutGrid size={11} />
                  <span className="hidden sm:inline">{wrapTasks ? (isEn ? 'Compact' : 'Compactar') : (isEn ? 'All' : 'Ver Todas')}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Single sleek horizontal task status row */}
        <div className="flex items-center justify-between gap-2.5 sm:gap-4">
          {/* Left: Status Icon, Title, Stage, Progress % */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isCompleted
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : isFailed
                  ? 'bg-rose-500/20 text-rose-400'
                  : isCancelled
                  ? 'bg-slate-500/20 text-slate-400'
                  : isQueued || isPaused
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-brand-500/20 text-brand-400 animate-pulse'
              }`}
            >
              {isCompleted ? (
                <CheckCircle2 size={16} />
              ) : isFailed ? (
                <AlertCircle size={16} />
              ) : isCancelled ? (
                <X size={16} />
              ) : isQueued ? (
                <Clock size={16} />
              ) : isPaused ? (
                <Pause size={16} />
              ) : isVideo ? (
                <Film size={16} />
              ) : (
                <Activity size={16} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider truncate max-w-[110px] sm:max-w-none">
                  {isCompleted
                    ? (isVideo ? t.videoCompleted : t.albumCompleted)
                    : isFailed
                    ? (isEn ? 'Failed' : 'Falhou')
                    : isCancelled
                    ? (isEn ? 'Cancelled' : 'Cancelado')
                    : isQueued
                    ? t.queued
                    : isPaused
                    ? t.paused
                    : (isVideo ? t.videoDownload : t.activeExtraction)}
                </span>
                <span className="text-xs font-mono font-bold text-brand-400 shrink-0">
                  {safeProgress}%
                </span>
                {focusedJob.throughputMbps > 0 && !isCompleted && !isQueued && (
                  <span className="text-[10px] text-slate-500 hidden md:inline font-mono">
                    {focusedJob.throughputMbps} MB/s
                  </span>
                )}
              </div>
              <div className="text-xs font-semibold text-slate-200 truncate max-w-[200px] sm:max-w-md">
                {focusedJob.title}
              </div>
              <div className="text-[11px] text-slate-400 truncate hidden sm:block">
                {focusedJob.currentStage}
              </div>
            </div>
          </div>

          {/* Center: Visual Progress Bar */}
          <div className="hidden lg:block w-44 xl:w-52 shrink-0">
            <div className="h-1.5 w-full bg-surface-elevated rounded-full overflow-hidden border border-border">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  isCompleted
                    ? 'bg-emerald-500'
                    : isFailed
                    ? 'bg-rose-500'
                    : isCancelled
                    ? 'bg-slate-500'
                    : isQueued
                    ? 'bg-amber-500/60'
                    : isPaused
                    ? 'bg-amber-500'
                    : 'bg-gradient-to-r from-brand-500 to-accent-purple'
                }`}
                style={{ width: `${isCompleted ? 100 : Math.max(isQueued ? 5 : 2, safeProgress)}%` }}
              />
            </div>
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Primary Action Button (Completed) */}
            {isCompleted && (
              isVideo ? (
                <button
                  onClick={() => {
                    navigateToView('videos');
                    setDockMinimized(true);
                  }}
                  className="px-2 sm:px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-colors shadow-sm whitespace-nowrap"
                >
                  <Film size={12} className="shrink-0" />
                  <span>{t.viewVideo}</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (focusedJob.resultAlbumId) {
                      navigateToView('album-detail', focusedJob.resultAlbumId);
                    } else {
                      navigateToView('gallery');
                    }
                    setDockMinimized(true);
                  }}
                  className="px-2 sm:px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-[11px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-colors shadow-glow-brand whitespace-nowrap"
                >
                  <ExternalLink size={12} className="shrink-0" />
                  <span>{t.viewAlbum}</span>
                </button>
              )
            )}

            {/* Retry Button (for failed or cancelled jobs in session) */}
            {(isFailed || isCancelled) && (
              <button
                onClick={async () => {
                  await retryJob(focusedJob);
                  if (selectedJobId === focusedJob.id) {
                    setSelectedJobId(null);
                  }
                }}
                className="px-2 sm:px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-[11px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-colors shadow-glow-brand whitespace-nowrap"
                title="Tentar Novamente"
              >
                <RotateCcw size={12} className="shrink-0" />
                <span>Tentar Novamente</span>
              </button>
            )}

            {/* View Live / Tasks Button (for active / queued jobs) */}
            {!isCompleted && !isFailed && !isCancelled && (
              <button
                onClick={() => {
                  const targetJobId = focusedJob.id;
                  setActiveJobById(targetJobId);
                  setHighlightedItemId(targetJobId);
                  setTimeout(() => {
                    if (useAppStore.getState().highlightedItemId === targetJobId) {
                      setHighlightedItemId(null);
                    }
                  }, 5000);
                  if (isVideo) {
                    navigateToView('job-history');
                  } else {
                    navigateToView('live-monitor');
                  }
                }}
                className="px-2 sm:px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-[11px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-colors shadow-glow-brand whitespace-nowrap cursor-pointer"
              >
                <ExternalLink size={12} className="shrink-0" />
                <span>{isVideo ? t.viewTasks : t.viewLive}</span>
              </button>
            )}

            {/* Pause Button */}
            {isActive && !isPaused && (
              <button
                onClick={() => pauseJob(focusedJob.id)}
                className="px-1.5 sm:px-2.5 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white border border-amber-500/30 text-[10px] sm:text-[11px] font-semibold transition-colors whitespace-nowrap flex items-center gap-1"
                title={t.pause}
              >
                <Pause size={11} />
                <span className="hidden xs:inline">{t.pause}</span>
              </button>
            )}

            {/* Resume Button */}
            {isPaused && (
              <button
                onClick={() => resumeJob(focusedJob.id)}
                className="px-1.5 sm:px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30 text-[10px] sm:text-[11px] font-semibold transition-colors whitespace-nowrap flex items-center gap-1"
                title={t.resume}
              >
                <Play size={11} />
                <span className="hidden xs:inline">{t.resume}</span>
              </button>
            )}

            {/* Cancel Button (for active, queued, or paused jobs) */}
            {(isActive || isQueued || isPaused) && (
              <button
                onClick={() => {
                  cancelJob(focusedJob.id);
                  if (selectedJobId === focusedJob.id) {
                    setSelectedJobId(null);
                  }
                }}
                className="px-1.5 sm:px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-[10px] sm:text-[11px] font-semibold transition-colors whitespace-nowrap"
                title={isQueued ? t.removeFromQueue : t.cancelTask}
              >
                {t.cancel}
              </button>
            )}

            {/* Dismiss Button when task is already Cancelled or Failed */}
            {(isCancelled || isFailed) && (
              <button
                onClick={() => {
                  dismissDockJob(focusedJob.id);
                  if (selectedJobId === focusedJob.id) {
                    setSelectedJobId(null);
                  }
                }}
                className="px-1.5 sm:px-2.5 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border text-[10px] sm:text-[11px] font-semibold transition-colors whitespace-nowrap"
                title={isEn ? "Dismiss from downloads dock" : "Fechar da barra de downloads"}
              >
                {isEn ? 'Dismiss' : 'Fechar'}
              </button>
            )}

            {/* Minimize toggle */}
            <button
              onClick={() => setDockMinimized(true)}
              className="p-1 sm:p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-surface-elevated transition-colors"
              title={t.minimizeDock}
            >
              <ChevronDown size={14} />
            </button>

            {/* Close / Dismiss ALL Tabs from dock view (does NOT cancel or delete jobs!) */}
            <button
              onClick={() => {
                dismissAllDockJobs();
                setSelectedJobId(null);
              }}
              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-surface-elevated transition-colors"
              title={t.dismissTask}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
