import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Clock,
  EyeOff,
  Terminal,
  ChevronDown,
  ChevronUp,
  X,
  Zap,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';

export const UpdateModal: React.FC = () => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const {
    updateModalOpen,
    setUpdateModalOpen,
    updateInfo,
    updateStatus,
    isApplyingUpdate,
    applyAppUpdate,
    dismissUpdate,
    remindUpdateLater,
    settings
  } = useAppStore();

  const [showLogs, setShowLogs] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const lang = settings.language || 'pt-BR';
  const t = (translations[lang]?.updater || translations['pt-BR']?.updater) as any;
  const isEn = lang === 'en-US';

  // Synchronize native <dialog> with React state
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (updateModalOpen && !dialog.open) {
      dialog.showModal();
    } else if (!updateModalOpen && dialog.open) {
      dialog.close();
    }
  }, [updateModalOpen]);

  // Handle native Cancel / Escape
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      if (isApplyingUpdate) {
        // Prevent dismissal while an update is actively running
        e.preventDefault();
      } else {
        remindUpdateLater();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [isApplyingUpdate, remindUpdateLater]);

  // Auto-scroll logs to bottom as they arrive
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [updateStatus?.logs]);

  // Countdown when update completes
  useEffect(() => {
    if (updateStatus?.status === 'completed' && countdown === null) {
      setCountdown(3);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev !== null && prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev !== null ? prev - 1 : null;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [updateStatus?.status, countdown]);

  if (!updateModalOpen && !isApplyingUpdate) return null;

  const currentVersion = updateInfo?.current_version || '5.6.0';
  const latestVersion = updateInfo?.latest_version || '5.6.0';
  const releaseName = updateInfo?.release_name || `IMAGEX.AI ${latestVersion}`;
  const releaseNotes = updateInfo?.release_notes || '';
  const publishedDate = updateInfo?.published_at
    ? new Date(updateInfo.published_at).toLocaleDateString(isEn ? 'en-US' : 'pt-BR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : '';

  const progress = updateStatus?.progress || 0;
  const statusMsg = updateStatus?.message || t.updatingSubtitle;
  const isCompleted = updateStatus?.status === 'completed';
  const isError = updateStatus?.status === 'error';

  // Format simple markdown into styled elements
  const renderFormattedNotes = (raw: string) => {
    if (!raw) return <p className="text-xs text-slate-400 italic">{isEn ? 'No release notes provided.' : 'Nenhuma nota de lançamento informada.'}</p>;

    const lines = raw.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return <div key={idx} className="h-2" />;

      if (trimmed.startsWith('### ')) {
        return (
          <h4 key={idx} className="text-xs font-bold text-brand-300 mt-2 mb-1 flex items-center gap-1.5">
            <Zap size={12} className="text-brand-400 shrink-0" />
            {trimmed.replace('### ', '')}
          </h4>
        );
      }
      if (trimmed.startsWith('## ')) {
        return (
          <h3 key={idx} className="text-sm font-extrabold text-white mt-3 mb-1.5 border-b border-border/50 pb-1">
            {trimmed.replace('## ', '')}
          </h3>
        );
      }
      if (trimmed.startsWith('# ')) {
        return (
          <h2 key={idx} className="text-base font-extrabold text-brand-400 mt-3 mb-2">
            {trimmed.replace('# ', '')}
          </h2>
        );
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const itemText = trimmed.substring(2);
        return (
          <div key={idx} className="flex items-start gap-2 text-xs text-slate-300 ml-1 py-0.5 leading-relaxed">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
            <span>{itemText}</span>
          </div>
        );
      }

      return (
        <p key={idx} className="text-xs text-slate-300 leading-relaxed py-0.5">
          {trimmed}
        </p>
      );
    });
  };

  return (
    <dialog
      ref={dialogRef}
      id="imagex-update-dialog"
      aria-labelledby="update-dialog-title"
      closedby={isApplyingUpdate ? 'none' : 'any'}
      className="m-auto fixed inset-0 z-50 p-0 bg-transparent backdrop:bg-black/80 backdrop:backdrop-blur-md max-w-xl w-[92vw] rounded-3xl outline-none border-0 shadow-2xl overflow-hidden"
      style={{
        overscrollBehavior: 'contain'
      }}
    >
      <div className="bg-slate-950/95 border border-brand-500/30 rounded-3xl shadow-glow-brand flex flex-col max-h-[85vh] text-slate-100 overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-border/60 bg-gradient-to-r from-brand-950/40 via-surface/80 to-slate-900/90 flex items-start justify-between relative overflow-hidden">
          <div className="flex items-center gap-3.5 relative z-10">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${
              isCompleted
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-glow-emerald'
                : isError
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                : isApplyingUpdate
                ? 'bg-brand-600/30 text-brand-300 border border-brand-500/40 animate-pulse'
                : 'bg-gradient-to-tr from-brand-600 to-indigo-600 text-white shadow-glow-brand'
            }`}>
              {isCompleted ? (
                <CheckCircle2 size={26} />
              ) : isError ? (
                <AlertTriangle size={26} />
              ) : isApplyingUpdate ? (
                <RefreshCw size={24} className="animate-spin" />
              ) : (
                <Sparkles size={24} className="text-amber-300" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 id="update-dialog-title" className="text-base sm:text-lg font-extrabold tracking-wide text-white">
                  {isCompleted
                    ? t.completedTitle
                    : isApplyingUpdate
                    ? t.updatingTitle
                    : t.modalTitle}
                </h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-400 border border-brand-500/30">
                  {latestVersion}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {isCompleted
                  ? t.completedDesc
                  : isApplyingUpdate
                  ? statusMsg
                  : t.modalSubtitle}
              </p>
            </div>
          </div>

          {!isApplyingUpdate && (
            <button
              type="button"
              onClick={remindUpdateLater}
              className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
              aria-label={t.close}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto max-h-[50vh] touch-scroll">
          {/* Version Comparison Bar */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900/80 border border-border/80">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">{t.currentVersion}:</span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-surface text-slate-300 border border-border">
                {currentVersion}
              </span>
            </div>

            <ArrowRight size={14} className="text-brand-400 shrink-0 mx-2" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-brand-300 font-semibold">{t.latestVersion}:</span>
              <span className="text-xs font-mono font-extrabold px-2.5 py-0.5 rounded-lg bg-brand-600/30 text-brand-300 border border-brand-500/40 shadow-glow-brand">
                {latestVersion}
              </span>
            </div>
          </div>

          {/* If actively updating */}
          {isApplyingUpdate ? (
            <div className="space-y-4 py-2">
              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <RefreshCw size={12} className={isCompleted ? '' : 'animate-spin text-brand-400'} />
                    {statusMsg}
                  </span>
                  <span className="font-mono font-bold text-brand-400">{progress}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-border">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isCompleted
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                        : isError
                        ? 'bg-rose-500'
                        : 'bg-gradient-to-r from-brand-600 via-indigo-500 to-fuchsia-500 animate-pulse'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Step Checklist */}
              <div className="space-y-2 rounded-2xl bg-surface/40 border border-border/60 p-3.5 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${progress >= 25 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className={progress >= 25 ? 'text-slate-200' : 'text-slate-500'}>
                    {isEn ? 'GitHub Source Synchronization' : 'Sincronização com repositório GitHub'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${progress >= 65 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className={progress >= 65 ? 'text-slate-200' : 'text-slate-500'}>
                    {isEn ? 'Environment & Dependencies Validation' : 'Validação de Dependências'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${progress >= 90 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className={progress >= 90 ? 'text-slate-200' : 'text-slate-500'}>
                    {isEn ? 'Frontend Production Build (Vite)' : 'Compilação de Produção (Vite)'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${progress >= 100 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className={progress >= 100 ? 'text-slate-200' : 'text-slate-500'}>
                    {isEn ? 'Ready & Safe Reload' : 'Finalização & Reinicialização'}
                  </span>
                </div>
              </div>

              {/* Live Terminal Log Toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowLogs(!showLogs)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 font-mono transition-colors cursor-pointer"
                >
                  <Terminal size={13} />
                  <span>{showLogs ? t.hideLogs : t.showLogs}</span>
                  {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showLogs && (
                  <div
                    ref={logScrollRef}
                    className="mt-2 p-3 bg-black/90 border border-slate-800 rounded-xl font-mono text-[11px] text-emerald-400 max-h-36 overflow-y-auto space-y-1 shadow-inner select-text"
                  >
                    {updateStatus?.logs && updateStatus.logs.length > 0 ? (
                      updateStatus.logs.map((log, i) => (
                        <div key={i} className="leading-tight break-all">
                          {log}
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-500">{isEn ? 'Listening to updater logs...' : 'Aguardando logs da atualização...'}</div>
                    )}
                  </div>
                )}
              </div>

              {/* Countdown Alert on completion */}
              {isCompleted && countdown !== null && (
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
                  <span className="font-semibold">{t.completedDesc}</span>
                  <span className="font-mono font-bold bg-emerald-500/20 px-2 py-0.5 rounded-lg">
                    {t.reloadingIn.replace('{seconds}', String(countdown))}
                  </span>
                </div>
              )}

              {/* Error Alert */}
              {isError && (
                <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} />
                    {t.errorTitle}
                  </div>
                  <p className="text-slate-300">{updateStatus?.error || statusMsg}</p>
                </div>
              )}
            </div>
          ) : (
            /* Idle / Prompt view */
            <div className="space-y-3.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">{releaseName}</span>
                {publishedDate && <span>{t.publishedAt}: {publishedDate}</span>}
              </div>

              {/* Release Notes container */}
              <div className="rounded-2xl bg-surface/50 border border-border p-4 max-h-48 overflow-y-auto space-y-1.5 touch-scroll">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                  <ShieldCheck size={13} className="text-brand-400" />
                  {t.releaseNotes}
                </div>
                {renderFormattedNotes(releaseNotes)}
              </div>

              {/* GitHub Link */}
              {updateInfo?.html_url && (
                <div className="flex justify-end">
                  <a
                    href={updateInfo.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    <span>{t.viewOnGithub}</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 sm:p-5 border-t border-border/60 bg-surface/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          {!isApplyingUpdate ? (
            <>
              {/* Dismiss / Ignore button */}
              <button
                type="button"
                onClick={() => dismissUpdate(latestVersion)}
                className="w-full sm:w-auto text-xs text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl hover:bg-surface-elevated transition-colors cursor-pointer"
                title={isEn ? 'Never ask again for this version' : 'Não perguntar novamente para esta versão'}
              >
                <EyeOff size={14} />
                <span>{t.ignoreVersion}</span>
              </button>

              <div className="w-full sm:w-auto flex items-center justify-end gap-2.5">
                {/* Remind later */}
                <button
                  type="button"
                  onClick={remindUpdateLater}
                  className="flex-1 sm:flex-none text-xs font-semibold text-slate-300 hover:text-white py-2.5 px-4 rounded-xl border border-border hover:bg-surface-elevated transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Clock size={14} />
                  <span>{t.remindLater}</span>
                </button>

                {/* Primary Update Button */}
                <button
                  type="button"
                  autoFocus
                  onClick={applyAppUpdate}
                  className="flex-1 sm:flex-none text-xs font-extrabold text-white py-2.5 px-5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 shadow-lg shadow-brand-600/30 hover:shadow-brand-600/50 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Download size={15} />
                  <span>{t.updateNow}</span>
                </button>
              </div>
            </>
          ) : isError ? (
            /* Error controls */
            <div className="w-full flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setUpdateModalOpen(false)}
                className="text-xs font-semibold text-slate-300 py-2.5 px-4 rounded-xl border border-border hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                {t.close}
              </button>
              <button
                type="button"
                onClick={applyAppUpdate}
                className="text-xs font-bold text-white py-2.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-500 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw size={14} />
                <span>{t.retry}</span>
              </button>
            </div>
          ) : (
            /* In progress message */
            <div className="w-full flex items-center justify-center text-xs text-slate-400 py-1">
              <span className="italic">
                {isEn ? 'Please keep the application open during update...' : 'Por favor, mantenha o aplicativo aberto durante a atualização...'}
              </span>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
};
