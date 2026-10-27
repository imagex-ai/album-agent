import React, { useState, useMemo } from 'react';
import {
  Layers,
  Plus,
  Clock,
  Play,
  Pause,
  Trash2,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Folder,
  ExternalLink,
  Activity,
  CheckCheck,
  ListFilter,
  Loader2,
  Copy,
  Check,
  Globe
} from 'lucide-react';
import { useAppStore, triggerJobsPollingLoop } from '../../store/useAppStore';
import { ExtractionJob, AiEngineType } from '../../types';
import { AiEngineSelector } from '../common/AiEngineSelector';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';
import { backendApi } from '../../services/realApi';

export const BatchQueueView: React.FC = () => {
  const {
    jobs,
    addJob,
    activeAiEngine,
    settings,
    cancelJob,
    deleteJob,
    pauseJob,
    resumeJob,
    retryJob,
    clearCompletedJobs,
    pauseAllJobs,
    resumeAllJobs,
    albumFolders,
    navigateToView
  } = useAppStore();

  const t = translations[settings.language].batch;
  const isEn = settings?.language === 'en-US';

  // Form State
  const [inputMode, setInputMode] = useState<'single' | 'multiple'>('single');
  const [singleUrl, setSingleUrl] = useState('');
  const [multiUrlsText, setMultiUrlsText] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [selectedFolder, setSelectedFolder] = useState<string>(settings.defaultAlbumFolder || 'Geral');
  const [batchEngine, setBatchEngine] = useState<AiEngineType>(() => {
    return activeAiEngine === 'ai_react' ? 'ai_react' : 'gemini_surgical_scout';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Tab State
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'queued' | 'completed' | 'failed'>('all');

  // Parse Multi URLs dynamically
  const parsedMultiUrls = useMemo(() => {
    return multiUrlsText
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0 && (u.startsWith('http://') || u.startsWith('https://')));
  }, [multiUrlsText]);

  // Job categorization
  const activeJobs = useMemo(() => jobs.filter(j => j.status === 'active'), [jobs]);
  const pausedJobs = useMemo(() => jobs.filter(j => j.status === 'paused'), [jobs]);
  const queuedJobs = useMemo(() => jobs.filter(j => j.status === 'queued'), [jobs]);
  const completedJobs = useMemo(() => jobs.filter(j => j.status === 'completed'), [jobs]);
  const failedJobs = useMemo(() => jobs.filter(j => j.status === 'failed' || j.status === 'cancelled'), [jobs]);

  const totalCount = jobs.length;
  const inFlightCount = activeJobs.length + pausedJobs.length;
  const successRate = totalCount > 0 ? Math.round((completedJobs.length / (completedJobs.length + failedJobs.length || 1)) * 100) : 100;

  // Filtered jobs according to active tab
  const filteredJobs = useMemo(() => {
    switch (activeTab) {
      case 'active':
        return [...activeJobs, ...pausedJobs];
      case 'queued':
        return queuedJobs;
      case 'completed':
        return completedJobs;
      case 'failed':
        return failedJobs;
      case 'all':
      default:
        return jobs;
    }
  }, [activeTab, activeJobs, pausedJobs, queuedJobs, completedJobs, failedJobs, jobs]);

  // Actions
  const handleEnqueue = async () => {
    const urlsToSubmit = inputMode === 'single'
      ? (singleUrl.trim() ? [singleUrl.trim()] : [])
      : parsedMultiUrls;

    if (urlsToSubmit.length === 0) return;

    setIsSubmitting(true);
    try {
      const batchResult = await backendApi.startBatchExtraction(
        urlsToSubmit,
        batchEngine,
        settings.aiModel,
        settings.geminiModel || 'gemini-3.7-flash',
        settings.reasoningBudget || 3,
        settings.maxConcurrency || 3,
        settings.antiBotDelayMs || 500,
        'all',
        selectedFolder || 'Geral',
        priority
      );

      if (batchResult && batchResult.length > 0) {
        batchResult.forEach((bJob: any) => {
          let fallbackTitle = bJob.url;
          try {
            fallbackTitle = `Batch: ${new URL(bJob.url).hostname}`;
          } catch (_) {}

          const job: ExtractionJob = {
            id: bJob.session_id,
            url: bJob.url,
            title: fallbackTitle,
            status: 'queued',
            progressPercent: 0,
            discoveredImagesCount: 0,
            resolvedOriginalCount: 0,
            failedCount: 0,
            currentStage: `${t.statusQueued} (${batchEngine})`,
            startTime: new Date().toISOString(),
            durationSeconds: 0,
            throughputMbps: 0,
            fps: 0,
            mode: batchEngine as any,
            aiModel: settings.aiModel,
            priority,
            folder: selectedFolder || 'Geral'
          };
          addJob(job);
          useAppStore.getState().subscribeToJob(bJob.session_id, bJob.url);
        });
        triggerJobsPollingLoop();
      }

      // Reset form
      if (inputMode === 'single') {
        setSingleUrl('');
      } else {
        setMultiUrlsText('');
      }
    } catch (err) {
      console.error('Failed to submit batch jobs:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearActiveQueue = async () => {
    if (inFlightCount + queuedJobs.length > 0) {
      const confirmed = window.confirm(t.clearQueueConfirm || 'Deseja cancelar todas as tarefas ativas na fila?');
      if (!confirmed) return;
    }
    try {
      await fetch('/api/jobs/clear-queue', { method: 'POST' });
    } catch (_) {}
    for (const j of [...activeJobs, ...pausedJobs, ...queuedJobs]) {
      await cancelJob(j.id);
      deleteJob(j.id);
    }
  };

  const handleCopyUrl = (id: string, url: string) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-5 min-w-0 max-w-full">
      {/* Title & Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2.5">
            <IconBadge variant="sapphire" size="md">
              <Layers size={18} />
            </IconBadge>
            <span>{t.title}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {t.subtitle}
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {inFlightCount > 0 && (
            <button
              type="button"
              onClick={() => pauseAllJobs()}
              className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title={t.pauseAll}
            >
              <Pause size={13} />
              <span>{t.pauseAll}</span>
            </button>
          )}

          {pausedJobs.length > 0 && (
            <button
              type="button"
              onClick={() => resumeAllJobs()}
              className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title={t.resumeAll}
            >
              <Play size={13} />
              <span>{t.resumeAll}</span>
            </button>
          )}

          {completedJobs.length > 0 && (
            <button
              type="button"
              onClick={() => clearCompletedJobs()}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-300 border border-border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title={t.clearFinished}
            >
              <CheckCheck size={13} className="text-emerald-400" />
              <span>{t.clearFinished}</span>
            </button>
          )}

          {(inFlightCount > 0 || queuedJobs.length > 0) && (
            <button
              type="button"
              onClick={handleClearActiveQueue}
              className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title={t.clearQueue}
            >
              <Trash2 size={13} />
              <span>{t.clearQueue}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 text-xs">
        <div className="glass-panel p-3 rounded-2xl border border-border flex items-center gap-3">
          <IconBadge variant="sapphire" size="sm">
            <Layers size={14} />
          </IconBadge>
          <div>
            <div className="text-[10px] text-slate-400 font-medium uppercase">{t.statsTotal}</div>
            <div className="text-base font-bold text-slate-100 font-mono">{totalCount}</div>
          </div>
        </div>

        <div className="glass-panel p-3 rounded-2xl border border-border flex items-center gap-3">
          <IconBadge variant="emerald" size="sm">
            <Activity size={14} className={activeJobs.length > 0 ? "animate-pulse" : ""} />
          </IconBadge>
          <div>
            <div className="text-[10px] text-slate-400 font-medium uppercase">{t.statsActive}</div>
            <div className="text-base font-bold text-emerald-400 font-mono">
              {activeJobs.length} {pausedJobs.length > 0 ? `(${pausedJobs.length} pausados)` : ''}
            </div>
          </div>
        </div>

        <div className="glass-panel p-3 rounded-2xl border border-border flex items-center gap-3">
          <IconBadge variant="gold" size="sm">
            <Clock size={14} />
          </IconBadge>
          <div>
            <div className="text-[10px] text-slate-400 font-medium uppercase">{t.statsQueued}</div>
            <div className="text-base font-bold text-amber-400 font-mono">{queuedJobs.length}</div>
          </div>
        </div>

        <div className="glass-panel p-3 rounded-2xl border border-border flex items-center gap-3">
          <IconBadge variant="cyan" size="sm">
            <CheckCircle2 size={14} />
          </IconBadge>
          <div>
            <div className="text-[10px] text-slate-400 font-medium uppercase">{t.statsCompleted}</div>
            <div className="text-base font-bold text-cyan-400 font-mono">{completedJobs.length}</div>
          </div>
        </div>

        <div className="glass-panel p-3 rounded-2xl border border-border flex items-center gap-3">
          <IconBadge variant="rose" size="sm">
            <AlertCircle size={14} />
          </IconBadge>
          <div>
            <div className="text-[10px] text-slate-400 font-medium uppercase">{t.statsFailed}</div>
            <div className="text-base font-bold text-rose-400 font-mono">{failedJobs.length}</div>
          </div>
        </div>

        <div className="glass-panel p-3 rounded-2xl border border-border flex items-center gap-3">
          <IconBadge variant="gold" size="sm">
            <Sparkles size={14} />
          </IconBadge>
          <div>
            <div className="text-[10px] text-slate-400 font-medium uppercase">{t.statsSuccessRate}</div>
            <div className="text-base font-bold text-yellow-300 font-mono">{successRate}%</div>
          </div>
        </div>
      </div>

      {/* Modern Enqueue Section (Single vs Multi Batch) */}
      <div className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border/60">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-surface-elevated border border-border text-xs">
            <button
              type="button"
              onClick={() => setInputMode('single')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                inputMode === 'single'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.modeSingle}
            </button>
            <button
              type="button"
              onClick={() => setInputMode('multiple')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                inputMode === 'multiple'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.modeMultiple}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Target Folder Selector */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-400 font-medium">{t.destinationFolder}</span>
              <select
                value={selectedFolder}
                onChange={e => setSelectedFolder(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-surface-elevated border border-border text-slate-200 text-xs outline-none cursor-pointer"
              >
                {albumFolders.map(f => (
                  <option key={f.id} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* AI Engine Selector */}
            <AiEngineSelector
              variant="compact"
              selectedEngine={batchEngine}
              onChange={eng => setBatchEngine(eng)}
            />

            {/* Priority Selector */}
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as any)}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated border border-border text-slate-200 text-xs outline-none cursor-pointer"
            >
              <option value="high">{t.priorityHighOption}</option>
              <option value="medium">{t.priorityMediumOption}</option>
              <option value="low">{t.priorityLowOption}</option>
            </select>
          </div>
        </div>

        {/* Input Controls */}
        {inputMode === 'single' ? (
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="url"
              value={singleUrl}
              onChange={e => setSingleUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEnqueue()}
              placeholder={t.inputPlaceholder}
              className="flex-1 px-4 py-2.5 rounded-xl bg-surface-elevated border border-border text-slate-100 text-xs outline-none focus:border-brand-500 transition-colors"
            />
            <button
              type="button"
              onClick={handleEnqueue}
              disabled={isSubmitting || !singleUrl.trim()}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 active:scale-95 transition-all cursor-pointer shrink-0"
            >
              {isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              <span>{t.enqueueUrl}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <textarea
              rows={4}
              value={multiUrlsText}
              onChange={e => setMultiUrlsText(e.target.value)}
              placeholder={t.multiPlaceholder}
              className="w-full px-4 py-3 rounded-2xl bg-surface-elevated border border-border text-slate-100 text-xs font-mono outline-none focus:border-brand-500 transition-colors resize-y leading-relaxed"
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs text-slate-400 font-mono">
                {t.urlsDetected.replace('{count}', String(parsedMultiUrls.length))}
              </span>
              <button
                type="button"
                onClick={handleEnqueue}
                disabled={isSubmitting || parsedMultiUrls.length === 0}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/20 active:scale-95 transition-all cursor-pointer shrink-0"
              >
                {isSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                <span>
                  {parsedMultiUrls.length > 0
                    ? t.enqueueCount.replace('{count}', String(parsedMultiUrls.length))
                    : t.enqueueUrl}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tabs & Active Filter Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'all'
                ? 'bg-slate-200 text-slate-900 shadow-sm'
                : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-border'
            }`}
          >
            <span>{t.tabAll}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-mono">
              {totalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'active'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-border'
            }`}
          >
            <Activity size={12} className={activeJobs.length > 0 ? "animate-pulse text-emerald-400" : ""} />
            <span>{t.tabActive}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-mono">
              {inFlightCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('queued')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'queued'
                ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-border'
            }`}
          >
            <Clock size={12} />
            <span>{t.tabQueued}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-mono">
              {queuedJobs.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'completed'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-border'
            }`}
          >
            <CheckCircle2 size={12} />
            <span>{t.tabCompleted}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-mono">
              {completedJobs.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('failed')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'failed'
                ? 'bg-rose-500 text-white font-bold shadow-sm'
                : 'bg-surface-elevated text-slate-400 hover:text-slate-200 border border-border'
            }`}
          >
            <AlertCircle size={12} />
            <span>{t.tabFailed}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 font-mono">
              {failedJobs.length}
            </span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-slate-500">
          {t.concurrencyWorkers.replace('{count}', String(settings.maxConcurrency || 4))}
        </div>
      </div>

      {/* Task Cards List */}
      <div className="space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="glass-panel p-12 rounded-3xl border border-border text-center space-y-2">
            <ListFilter size={32} className="mx-auto text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">
              {t.emptyQueue}
            </p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {isEn ? 'No tasks found for the selected category. Paste new URLs in the panel above to start batch processing.' : 'Nenhuma tarefa encontrada para a categoria selecionada. Cole novas URLs no painel acima para iniciar o processamento em lote.'}
            </p>
          </div>
        ) : (
          filteredJobs.map(job => {
            const isJobActive = job.status === 'active';
            const isJobPaused = job.status === 'paused';
            const isJobQueued = job.status === 'queued';
            const isJobCompleted = job.status === 'completed';
            const isJobFailed = job.status === 'failed' || job.status === 'cancelled';

            return (
              <div
                key={job.id}
                className="glass-panel p-4 sm:p-5 rounded-2xl border border-border hover:border-border/80 transition-all space-y-3 shadow-sm"
              >
                {/* Header row: Status badge, Priority, Folder, ID */}
                <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status Badge */}
                    {isJobActive && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        <span>{t.statusActive}</span>
                      </span>
                    )}

                    {isJobPaused && (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[11px] flex items-center gap-1.5">
                        <Pause size={10} />
                        <span>{t.statusPaused}</span>
                      </span>
                    )}

                    {isJobQueued && (
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold text-[11px] flex items-center gap-1.5">
                        <Clock size={10} />
                        <span>{t.statusQueued}</span>
                      </span>
                    )}

                    {isJobCompleted && (
                      <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-bold text-[11px] flex items-center gap-1.5">
                        <CheckCircle2 size={11} />
                        <span>{t.statusCompleted}</span>
                      </span>
                    )}

                    {isJobFailed && (
                      <span className="px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 font-bold text-[11px] flex items-center gap-1.5">
                        <AlertCircle size={11} />
                        <span>{job.status === 'cancelled' ? t.statusCancelled : t.statusFailed}</span>
                      </span>
                    )}

                    {/* Priority Badge */}
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                        job.priority === 'high'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : job.priority === 'low'
                          ? 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                          : 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                      }`}
                    >
                      {job.priority || 'medium'}
                    </span>

                    {/* Folder Badge */}
                    {job.folder && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-surface border border-border text-slate-300 flex items-center gap-1">
                        <Folder size={10} className="text-purple-400" />
                        <span>{job.folder}</span>
                      </span>
                    )}
                  </div>

                  {/* Job ID & Copy */}
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                    <span>#{job.id}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyUrl(job.id, job.url)}
                      className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
                      title="Copiar URL"
                    >
                      {copiedId === job.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                {/* Middle row: Title & URL */}
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-slate-100 truncate flex items-center gap-2">
                    <span>{job.title}</span>
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Globe size={12} className="shrink-0 text-slate-500" />
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate hover:text-brand-400 hover:underline transition-colors max-w-2xl"
                    >
                      {job.url}
                    </a>
                  </div>
                </div>

                {/* Progress / Metrics / Error Row */}
                {(isJobActive || isJobPaused || isJobQueued) && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium truncate max-w-md">
                        {job.currentStage || (isEn ? "Processing extraction..." : "Processando extração...")}
                      </span>
                      <span className="font-mono font-bold text-brand-400">
                        {job.progressPercent}%
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-surface-elevated border border-border/80 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                        style={{ width: `${Math.max(2, Math.min(100, job.progressPercent))}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-0.5">
                      <span>Imagens: {job.resolvedOriginalCount || 0}</span>
                      {job.throughputMbps > 0 && <span>{job.throughputMbps.toFixed(1)} Mbps</span>}
                      {job.durationSeconds > 0 && <span>{Math.round(job.durationSeconds)}s</span>}
                    </div>
                  </div>
                )}

                {isJobCompleted && (
                  <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-xs text-slate-300 bg-surface/40 p-2.5 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-emerald-400">
                        {job.resolvedOriginalCount} {isEn ? "original items" : "itens originais"}
                      </span>
                      {job.durationSeconds > 0 && (
                        <span className="text-slate-400 font-mono">
                          • {Math.round(job.durationSeconds)}s decorridos
                        </span>
                      )}
                      <span className="text-slate-500 font-mono">
                        • {job.aiModel}
                      </span>
                    </div>
                  </div>
                )}

                {isJobFailed && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5 text-rose-400" />
                    <span className="truncate">
                      {job.error || job.currentStage || (isEn ? "Failed during page processing." : "Falha durante o processamento da página.")}
                    </span>
                  </div>
                )}

                {/* Actions row */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
                  {/* Active controls: Pause and Cancel */}
                  {isJobActive && (
                    <>
                      <button
                        type="button"
                        onClick={() => pauseJob(job.id)}
                        className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title={t.pauseBtn}
                      >
                        <Pause size={12} />
                        <span>{t.pauseBtn}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => cancelJob(job.id)}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title={t.cancel}
                      >
                        <Trash2 size={12} />
                        <span>{t.cancel}</span>
                      </button>
                    </>
                  )}

                  {/* Paused controls: Resume and Cancel */}
                  {isJobPaused && (
                    <>
                      <button
                        type="button"
                        onClick={() => resumeJob(job.id)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title={t.resumeBtn}
                      >
                        <Play size={12} />
                        <span>{t.resumeBtn}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => cancelJob(job.id)}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title={t.cancel}
                      >
                        <Trash2 size={12} />
                        <span>{t.cancel}</span>
                      </button>
                    </>
                  )}

                  {/* Queued controls: Cancel */}
                  {isJobQueued && (
                    <button
                      type="button"
                      onClick={() => {
                        cancelJob(job.id);
                        deleteJob(job.id);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title={t.cancel}
                    >
                      <Trash2 size={12} />
                      <span>{t.cancel}</span>
                    </button>
                  )}

                  {/* Completed controls: Open album and Delete record */}
                  {isJobCompleted && (
                    <>
                      {job.resultAlbumId && (
                        <button
                          type="button"
                          onClick={() => navigateToView('album-detail', job.resultAlbumId)}
                          className="px-3 py-1.5 rounded-xl bg-brand-600/20 hover:bg-brand-600/30 text-brand-300 border border-brand-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          title={t.openAlbumBtn}
                        >
                          <ExternalLink size={12} />
                          <span>{t.openAlbumBtn}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => deleteJob(job.id)}
                        className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title={t.deleteBtn}
                      >
                        <Trash2 size={12} />
                        <span>{t.deleteBtn}</span>
                      </button>
                    </>
                  )}

                  {/* Failed controls: Retry and Delete */}
                  {isJobFailed && (
                    <>
                      <button
                        type="button"
                        onClick={() => retryJob(job)}
                        className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title={t.retryBtn}
                      >
                        <RotateCcw size={12} />
                        <span>{t.retryBtn}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteJob(job.id)}
                        className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title={t.deleteBtn}
                      >
                        <Trash2 size={12} />
                        <span>{t.deleteBtn}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
