import { translations } from '../../i18n/translations';
import React, { useState } from 'react';
import {
  ListTodo,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  Play,
  RotateCcw,
  XCircle,
  Trash2,
  Download,
  Search,
  Activity,
  Zap,
  Cpu,
  Layers,
  BarChart3,
  Copy,
  Check,
  Info,
  Sliders,
  Film,
  X,
  Pause
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ExtractionJob } from '../../types';
import { formatFileSize } from '../../utils/formatters';
import { ModalPortal } from '../common/ModalPortal';

export const JobHistoryView: React.FC = () => {
  const { settings } = useAppStore();
  const isEn = settings?.language === 'en-US';
  const tJobs: any = translations[settings.language].jobHistory || {};
  const {
    jobs,
    navigateToView,
    cancelJob,
    deleteJob,
    clearCompletedJobs,
    addLog,
    pauseJob,
    resumeJob,
    retryJob,
    pauseAllJobs,
    resumeAllJobs,
    retryAllFailedJobs,
    highlightedItemId
  } = useAppStore();
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inspectedJob, setInspectedJob] = useState<ExtractionJob | null>(null);
  const [nowTime, setNowTime] = useState(Date.now());

  // Scroll to highlighted job card when navigating from MiniTaskDock ("View Tasks")
  React.useEffect(() => {
    if (!highlightedItemId) return;
    if (statusFilter !== 'all') setStatusFilter('all');
    if (search !== '') setSearch('');

    const scrollToTargetJob = () => {
      const el = document.querySelector(`[data-job-id="${highlightedItemId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      return false;
    };

    const t1 = setTimeout(scrollToTargetJob, 80);
    const t2 = setTimeout(scrollToTargetJob, 260);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [highlightedItemId]);

  // Live timer ticker for active jobs (updates every 500ms)
  React.useEffect(() => {
    const hasActive = jobs.some(j => j.status === 'active');
    if (!hasActive) return;
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, [jobs]);

  const formatDuration = (seconds: number) => {
    const rounded = Math.round(seconds);
    if (rounded <= 0) return '0s';
    if (rounded < 60) return `${rounded}s`;
    const mins = Math.floor(rounded / 60);
    const remSecs = rounded % 60;
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  };

  const isJobActive = (job: ExtractionJob) => {
    if (job.status === 'completed') return false;
    if (job.status === 'cancelled' || job.status === 'failed') return false;
    if (job.status === 'active' || job.status === 'queued' || job.status === 'paused') return true;

    const stage = (job.currentStage || '').toLowerCase();
    const hasActiveStage =
      stage.includes('baixando') ||
      stage.includes('reconectando') ||
      stage.includes('motor resiliente') ||
      stage.includes('na fila') ||
      stage.includes('fila') ||
      stage.includes('resolvendo') ||
      stage.includes('gerando miniatura') ||
      stage.includes('iniciando') ||
      stage.includes('processando') ||
      stage.includes('analisando') ||
      stage.includes('extraindo') ||
      stage.includes('inspecionando') ||
      stage.includes('scout') ||
      stage.includes('explorer') ||
      stage.includes('buscando');

    if (hasActiveStage) return true;

    return (
      (!!job.downloadedBytes && job.downloadedBytes > 0 && job.progressPercent < 100) ||
      (job.progressPercent > 0 && job.progressPercent < 100)
    );
  };

  const getJobDuration = (job: ExtractionJob) => {
    if (isJobActive(job)) {
      const startStr = job.startTime || '';
      const start = new Date(startStr.replace(' UTC', 'Z')).getTime();
      if (!start || isNaN(start)) return '1s';
      const elapsed = Math.max(1, Math.floor((nowTime - start) / 1000));
      return formatDuration(elapsed);
    }
    const dur = job.durationSeconds || 0;
    return dur > 0 ? formatDuration(dur) : '12s';
  };

  const activeCount = jobs.filter(j => isJobActive(j)).length;
  const pausedCount = jobs.filter(j => j.status === 'paused').length;
  const runningCount = jobs.filter(j => j.status === 'active' || j.status === 'queued').length;
  const completedCount = jobs.filter(j => j.status === 'completed').length;
  const cancelledCount = jobs.filter(j => !isJobActive(j) && j.status !== 'completed' && (j.status === 'cancelled' || j.status === 'failed')).length;

  const totalPhotosExtracted = jobs.reduce((acc, j) => acc + (j.resolvedOriginalCount || 0), 0);
  const totalCandidates = jobs.reduce((acc, j) => acc + (j.discoveredImagesCount || 0), 0);
  const successRate = jobs.length > 0
    ? Math.round((completedCount / jobs.length) * 100)
    : 100;

  const filteredJobs = jobs.filter(job => {
    const isAct = isJobActive(job);
    const isComp = job.status === 'completed';
    const isCanc = !isAct && !isComp && (job.status === 'cancelled' || job.status === 'failed');

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && isAct) ||
      (statusFilter === 'completed' && isComp) ||
      (statusFilter === 'cancelled' && isCanc);

    const matchesSearch =
      job.title.toLowerCase().includes(search.toLowerCase()) ||
      job.url.toLowerCase().includes(search.toLowerCase()) ||
      (job.aiModel || '').toLowerCase().includes(search.toLowerCase());

    return matchesStatus && matchesSearch;
  });

  const handleCopyUrl = (url: string, id: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {}
      document.body.removeChild(textArea);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRetryJob = async (job: ExtractionJob) => {
    addLog({
      level: 'info',
      category: 'JOB_MANAGEMENT',
      message: isEn ? `Re-running task #${job.id} automatically for URL: ${job.url}` : `Re-executando tarefa #${job.id} automaticamente para URL: ${job.url}`
    });
    await retryJob(job);
  };

  const handleExportJobs = () => {
    const jsonStr = JSON.stringify(jobs, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `imagex_jobs_report_${Date.now()}.json`;
    link.click();
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full overflow-x-hidden">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 min-w-0 max-w-full">
        <div>
          <h1 className="text-lg sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2">
            <ListTodo size={22} className="text-brand-400 shrink-0" />
            <span>{tJobs.title || 'Task Management & Job Audit'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {tJobs.subtitle || 'Background queue control, throughput monitoring, re-execution and telemetry'}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar">
          {pausedCount > 0 && (
            <button
              onClick={resumeAllJobs}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors shrink-0"
              title={isEn ? `Resume all ${pausedCount} paused tasks` : `Retomar todas as ${pausedCount} tarefas pausadas`}
            >
              <Play size={13} />
              <span>{isEn ? `Resume Paused (${pausedCount})` : `Retomar Pausados (${pausedCount})`}</span>
            </button>
          )}
          {cancelledCount > 0 && (
            <button
              onClick={retryAllFailedJobs}
              className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors shrink-0"
              title={isEn ? `Retry all ${cancelledCount} failed/cancelled tasks` : `Re-executar todas as ${cancelledCount} tarefas com falha`}
            >
              <RotateCcw size={13} />
              <span>{isEn ? `Retry Failed (${cancelledCount})` : `Re-executar Falhos (${cancelledCount})`}</span>
            </button>
          )}
          {runningCount > 0 && (
            <button
              onClick={pauseAllJobs}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-amber-950/40 border border-border text-xs font-semibold text-amber-300 flex items-center gap-1.5 transition-colors shrink-0"
              title={isEn ? 'Pause all running tasks' : 'Pausar todas as tarefas em andamento'}
            >
              <Pause size={13} />
              <span>{isEn ? 'Pause All' : 'Pausar Todos'}</span>
            </button>
          )}
          <button
            onClick={() => navigateToView('extractor')}
            className="px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-glow-brand transition-colors shrink-0"
          >
            <Zap size={13} />
            <span>{tJobs.newExtraction || 'New Extraction'}</span>
          </button>
          <button
            onClick={handleExportJobs}
            className="px-3.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition-colors shrink-0"
            title={tJobs.exportReportTitle || "Exportar relatório de jobs em JSON"}
          >
            <Download size={13} />
            <span>{tJobs.exportReport || 'Export Report'}</span>
          </button>
          {completedCount > 0 && (
            <button
              onClick={clearCompletedJobs}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-rose-950/40 border border-border text-xs font-semibold text-slate-400 hover:text-rose-400 flex items-center gap-1.5 transition-colors shrink-0"
              title={tJobs.clearCompletedTitle || "Limpar jobs concluídos do histórico"}
            >
              <Trash2 size={13} />
              <span>{tJobs.clearCompleted || 'Clear Completed'}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Analytics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 min-w-0 max-w-full">
        <div className="glass-panel p-3 sm:p-4 rounded-2xl border border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center shrink-0">
            <Layers size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-mono font-bold block">{tJobs.totalJobs || 'Total de Jobs'}</span>
            <span className="text-base sm:text-xl font-extrabold text-slate-100">{jobs.length}</span>
          </div>
        </div>

        <div className="glass-panel p-3 sm:p-4 rounded-2xl border border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-mono font-bold block">{tJobs.successRate || 'Taxa de Sucesso'}</span>
            <span className="text-base sm:text-xl font-extrabold text-emerald-400">{successRate}%</span>
          </div>
        </div>

        <div className="glass-panel p-3 sm:p-4 rounded-2xl border border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-purple/20 text-accent-purple flex items-center justify-center shrink-0">
            <Zap size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-mono font-bold block">{tJobs.photosExtracted || (isEn ? "Photos Extracted" : "Fotos Extraídas")}</span>
            <span className="text-base sm:text-xl font-extrabold text-slate-100">{totalPhotosExtracted}</span>
          </div>
        </div>

        <div className="glass-panel p-3 sm:p-4 rounded-2xl border border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <BarChart3 size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-mono font-bold block">{tJobs.candidates || 'Candidatos no DOM'}</span>
            <span className="text-base sm:text-xl font-extrabold text-amber-400">{totalCandidates}</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="glass-panel p-3 sm:p-4 rounded-2xl border border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 text-xs min-w-0 max-w-full">
        <div className="flex-1 relative min-w-0">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tJobs.searchPlaceholder || "Search by title, URL or AI model..."}
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface-elevated border border-border text-slate-100 placeholder-slate-500 text-xs outline-none focus:border-brand-500 font-mono"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-elevated border border-border overflow-x-auto no-scrollbar touch-scroll shrink-0">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              statusFilter === 'all' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {(tJobs.tabAll || 'Todos ({count})').replace('{count}', String(jobs.length))}
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
              statusFilter === 'active' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{(tJobs.tabActive || 'Ativos ({count})').replace('{count}', String(activeCount))}</span>
          </button>
          <button
            onClick={() => setStatusFilter('completed')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              statusFilter === 'completed' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {(tJobs.tabCompleted || (isEn ? "Completed ({count})" : "Concluídos ({count})")).replace('{count}', String(completedCount))}
          </button>
          <button
            onClick={() => setStatusFilter('cancelled')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              statusFilter === 'cancelled' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {(tJobs.tabFailed || 'Cancelados ({count})').replace('{count}', String(cancelledCount))}
          </button>
        </div>
      </div>

      {/* Main Jobs Cards List */}
      <div className="space-y-3 min-w-0 max-w-full">
        {filteredJobs.length > 0 ? (
          filteredJobs.map(job => {
            const isCompleted = job.status === 'completed';
            const isQueued = job.status === 'queued' || (Boolean(job.currentStage) && (job.currentStage!.toLowerCase().includes('na fila') || job.currentStage!.toLowerCase().includes('fila')));
            const isPaused = job.status === 'paused';
            const isActive = isJobActive(job) && !isQueued && !isPaused;
            const isCancelled = !isCompleted && !isActive && !isQueued && !isPaused && (job.status === 'cancelled' || job.status === 'failed');
            const isVideoSave = (job.mode as string) === 'video_save' || (job.mode as string) === 'video_downloader';
            const isHighlighted = highlightedItemId === job.id;

            return (
              <div
                key={job.id}
                data-job-id={job.id}
                className={`glass-panel p-4 sm:p-5 rounded-3xl border space-y-3.5 transition-all shadow-sm ${
                  isHighlighted
                    ? 'border-brand-400 ring-2 ring-brand-400/70 bg-brand-950/30 shadow-glow-brand'
                    : 'border-border hover:border-slate-700'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm sm:text-base text-slate-100 truncate">{job.title}</h3>
                      {isVideoSave && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30">
                          <Film size={11} />
                          <span>{tJobs.saveVideo || 'SAVE VIDEO'}</span>
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                          isCompleted
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : isPaused
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : isActive
                            ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30 animate-pulse'
                            : isQueued
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : job.status === 'failed'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 size={11} /> : isPaused ? <Pause size={11} /> : isActive ? <Activity size={11} /> : isQueued ? <Clock size={11} /> : <XCircle size={11} />}
                        <span>{isCompleted ? 'COMPLETED' : isPaused ? 'PAUSADO' : isActive ? 'RUNNING' : isQueued ? 'NA FILA' : (job.status === 'failed' ? 'FALHOU' : 'CANCELADO')}</span>
                      </span>
                    </div>

                    {/* Source URL with 1-Click Copy */}
                    <div className="flex items-center gap-2 text-slate-400 text-xs font-mono mt-1 min-w-0">
                      <span className="truncate max-w-md">{job.url}</span>
                      <button
                        onClick={() => handleCopyUrl(job.url, job.id)}
                        className="text-slate-400 hover:text-white p-1 rounded hover:bg-surface-elevated shrink-0 transition-colors"
                        title="Copiar URL"
                      >
                        {copiedId === job.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>

                  {/* Top Right Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setInspectedJob(job)}
                      className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-400 hover:text-white border border-border transition-colors text-xs flex items-center gap-1"
                      title="Auditoria Detalhada"
                    >
                      <Info size={14} />
                      <span className="hidden sm:inline">Auditoria</span>
                    </button>
                    <button
                      onClick={() => deleteJob(job.id)}
                      className="p-2 rounded-xl bg-surface-elevated hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-border transition-colors"
                      title={tJobs.deleteRecord || "Delete Record"}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Progress Bar (if running or completed) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400 truncate">{job.currentStage}</span>
                    <span className="text-brand-400 font-bold shrink-0">{job.progressPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isCompleted ? 'bg-emerald-500' : isCancelled ? 'bg-amber-500' : 'bg-brand-500'
                      }`}
                      style={{ width: `${job.progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Metrics Grid */}
                {isVideoSave ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-surface-elevated/60 p-3 rounded-2xl border border-white/5 font-mono text-xs">
                    <div>
                      <span className="text-slate-500 text-[10px] block">Baixado / Total</span>
                      <span className="text-cyan-400 font-bold">
                        {formatFileSize(job.downloadedBytes || 0)} / {job.totalBytes ? formatFileSize(job.totalBytes) : (isEn ? 'Live Stream' : 'Fluxo Vivo')}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">{isEn ? "Speed" : "Velocidade"}</span>
                      <span className="text-brand-400 font-bold">{job.throughputMbps || 0} MB/s</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">{tJobs.duration || 'Duration'}</span>
                      <span className={`font-bold ${job.status === 'active' ? 'text-brand-400 animate-pulse' : 'text-slate-200'}`}>
                        {getJobDuration(job)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">{isEn ? "Destination" : "Destino"}</span>
                      <span className="text-slate-300 truncate block">{isEn ? `Folder ${job.folder || "Extracted"}` : `Pasta ${job.folder || "Extraídos"}`}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-surface-elevated/60 p-3 rounded-2xl border border-white/5 font-mono text-xs">
                    <div>
                      <span className="text-slate-500 text-[10px] block">{isEn ? "Original Photos" : "Fotos Originais"}</span>
                      <span className="text-emerald-400 font-bold">{job.resolvedOriginalCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">{tJobs.duration || 'Duration'}</span>
                      <span className={`font-bold ${job.status === 'active' ? 'text-brand-400 animate-pulse' : 'text-slate-200'}`}>
                        {getJobDuration(job)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">{isEn ? "DOM Candidates" : "Candidatos (DOM)"}</span>
                      <span className="text-amber-400 font-bold">{job.discoveredImagesCount || 0}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">{isEn ? "AI Engine" : "Motor IA"}</span>
                      <span className="text-slate-300 truncate block">{job.aiModel || 'Qwen 2.5:32b'}</span>
                    </div>
                  </div>
                )}

                {/* Action Buttons Footer */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {isActive && (
                    <>
                      {!isVideoSave && (
                        <button
                          onClick={() => navigateToView('live-monitor')}
                          className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-glow-brand transition-colors"
                        >
                          <Activity size={14} />
                          <span>{isEn ? "Open in Live Monitor" : "Abrir no Live Monitor"}</span>
                        </button>
                      )}
                      <button
                        onClick={() => pauseJob(job.id)}
                        className="px-4 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white border border-amber-500/30 font-bold text-xs flex items-center gap-1.5 transition-colors"
                        title={isEn ? "Pause task" : "Pausar tarefa"}
                      >
                        <Pause size={14} />
                        <span>{isEn ? "Pause" : "Pausar"}</span>
                      </button>
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 font-bold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <XCircle size={14} />
                        <span>Cancelar {isVideoSave ? 'Download' : 'Job'}</span>
                      </button>
                    </>
                  )}

                  {isPaused && (
                    <>
                      <button
                        onClick={() => resumeJob(job.id)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors"
                        title={isEn ? "Resume task" : "Retomar tarefa"}
                      >
                        <Play size={14} />
                        <span>{isEn ? "Resume" : "Retomar"}</span>
                      </button>
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 font-bold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <XCircle size={14} />
                        <span>Cancelar {isVideoSave ? 'Download' : 'Job'}</span>
                      </button>
                    </>
                  )}

                  {isQueued && (
                    <>
                      <button
                        onClick={() => resumeJob(job.id)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors"
                        title={isEn ? "Start this task immediately with priority" : "Iniciar esta tarefa agora com prioridade"}
                      >
                        <Play size={14} />
                        <span>{isEn ? "Start Now" : "Baixar Agora"}</span>
                      </button>
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 font-bold text-xs flex items-center gap-1.5 transition-colors"
                      >
                        <XCircle size={14} />
                        <span>{isEn ? "Remove from Queue" : "Remover da Fila"}</span>
                      </button>
                    </>
                  )}

                  {isCompleted && (
                    <>
                      {isVideoSave ? (
                        <button
                          onClick={() => navigateToView('videos')}
                          className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-glow-brand transition-colors"
                        >
                          <Film size={14} />
                          <span>{tJobs.viewInVideoGallery || 'View in Video Gallery'}</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => navigateToView('album-detail', job.resultAlbumId || job.id)}
                          className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-glow-brand transition-colors"
                        >
                          <span>{tJobs.openExtractedAlbum || 'Open Extracted Album'}</span>
                          <ArrowRight size={14} />
                        </button>
                      )}
                      {!isVideoSave && (
                        <button
                          onClick={() => handleRetryJob(job)}
                          className="px-3.5 py-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-300 hover:text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
                        >
                          <RotateCcw size={13} />
                          <span>{isEn ? "Re-extract" : "Re-extrair"}</span>
                        </button>
                      )}
                    </>
                  )}

                  {isCancelled && (
                    <button
                      onClick={() => handleRetryJob(job)}
                      className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-glow-brand transition-colors"
                    >
                      <RotateCcw size={14} />
                      <span>{isEn ? "Try Again" : "Tentar Novamente"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-16 text-center text-slate-500 glass-panel rounded-3xl border border-border space-y-3">
            <ListTodo size={40} className="mx-auto text-slate-600 opacity-60" />
            <p className="text-sm font-semibold text-slate-400">{isEn ? "No tasks found for selected filters." : "Nenhum job encontrado para os filtros selecionados."}</p>
            <button
              onClick={() => navigateToView('extractor')}
              className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold inline-flex items-center gap-2 shadow-glow-brand"
            >
              <Zap size={14} />
              <span>{isEn ? "Start New Extraction" : "Iniciar Nova Extração"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Deep Audit Modal */}
      {inspectedJob && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-surface rounded-3xl border border-border max-w-lg w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Info size={18} className="text-brand-400" />
                  <h3 className="font-bold text-sm text-slate-100">Auditoria & Telemetria do Job</h3>
                </div>
                <button
                  onClick={() => setInspectedJob(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-2.5 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">{isEn ? "Session ID:" : "ID da Sessão:"}</span>
                  <span className="text-slate-200 font-bold">{inspectedJob.id}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Status:</span>
                  <span className="text-emerald-400 font-bold uppercase">{inspectedJob.status}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between py-1 border-b border-white/5 gap-2">
                  <span className="text-slate-400 whitespace-nowrap">URL Alvo:</span>
                  <div className="flex items-center gap-2 min-w-0 max-w-full">
                    <span className="text-brand-400 break-all">{inspectedJob.url}</span>
                    <button
                      onClick={() => handleCopyUrl(inspectedJob.url, 'modal-' + inspectedJob.id)}
                      className="p-1 rounded bg-surface-elevated hover:bg-surface-hover text-slate-400 hover:text-white transition-colors shrink-0"
                      title="Copiar URL"
                    >
                      {copiedId === 'modal-' + inspectedJob.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Motor de IA:</span>
                  <span className="text-slate-200">{inspectedJob.aiModel || 'Qwen 2.5:32b'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Fotos Originais Resolvidas:</span>
                  <span className="text-emerald-400 font-bold">{inspectedJob.resolvedOriginalCount}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Candidatos Analisados no DOM:</span>
                  <span className="text-amber-400 font-bold">{inspectedJob.discoveredImagesCount || 0}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">{isEn ? "Failures / Rejections:" : "Falhas / Rejeições:"}</span>
                  <span className="text-rose-400 font-bold">{inspectedJob.failedCount || 0}</span>
                </div>
              </div>

              <button
                onClick={() => setInspectedJob(null)}
                className="w-full py-2.5 rounded-xl bg-brand-600 text-white font-bold text-xs transition-colors"
              >
                {tJobs.closeAudit || 'Close Audit'}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
