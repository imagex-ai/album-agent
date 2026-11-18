import React, { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { feedbackConfigured, initializeFeedback, openFeedback } from '../../services/feedbackService';
import { AppDialog } from './AppDialog';

export function FeedbackButton({ compact, onOpen }: { compact: boolean; onOpen?: () => void }) {
  const settings = useAppStore(state => state.settings);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const isEn = settings.language === 'en-US';
  const title = isEn ? 'Send feedback' : 'Enviar feedback';
  const configured = feedbackConfigured();

  const continueToForm = async () => {
    if (opening) return;
    setOpening(true);
    setFailed(false);
    try {
      const ready = await initializeFeedback(() => useAppStore.getState().settings.automaticErrorReports !== false);
      if (!ready) throw new Error('feedback_unavailable');
      setDialogOpen(false);
      if (!await openFeedback(isEn, settings.theme === 'clean-light')) throw new Error('feedback_unavailable');
    } catch (_) {
      setDialogOpen(true);
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };

  return <>
    <button
      type="button"
      onClick={() => { onOpen?.(); setFailed(false); setDialogOpen(true); }}
      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-brand-600/25 to-fuchsia-600/25 hover:from-brand-600/40 hover:to-fuchsia-600/40 text-[var(--text-primary)] border border-brand-500/30 transition-all shadow-lg cursor-pointer"
      title={title}
      aria-label={title}
    >
      <MessageCircle size={15} className="shrink-0" />
      {!compact && <span className="truncate">{title}</span>}
    </button>
    {dialogOpen && <AppDialog titleId="feedback-intro-title" descriptionId="feedback-intro-description" onClose={() => { if (!opening) setDialogOpen(false); }}
      className="w-[min(92vw,28rem)] max-h-[85dvh] overflow-y-auto rounded-3xl border border-border bg-surface p-5 sm:p-6 text-[var(--text-primary)] shadow-2xl backdrop:bg-black/70">
      <div className="flex items-start justify-between gap-4">
        <h2 id="feedback-intro-title" className="text-base font-bold">{title}</h2>
        <button type="button" onClick={() => setDialogOpen(false)} disabled={opening} aria-label={isEn ? 'Close' : 'Fechar'} className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X size={18} /></button>
      </div>
      <p id="feedback-intro-description" className="mt-3 text-sm leading-relaxed text-[var(--text-primary)]">
        {isEn ? 'Tell us about a problem, suggestion or anything else. Your email is optional.' : 'Conte sobre um problema, sugestão ou qualquer outra coisa. Seu e-mail é opcional.'}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        {isEn ? 'Your message and any screenshot you choose to add are sent to Sentry, which may infer your approximate location from the connection. Check for private content before sending.' : 'Sua mensagem e qualquer captura de tela que você escolher adicionar serão enviadas ao Sentry, que pode estimar sua localização aproximada pela conexão. Confira se há conteúdo privado antes de enviar.'}
      </p>
      {(!configured || failed) && <p role="status" className="mt-3 text-xs font-semibold text-[var(--text-primary)]">
        {isEn ? 'Feedback is not available right now. Please try again later.' : 'O envio de feedback ainda não está disponível. Tente novamente mais tarde.'}
      </p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={() => setDialogOpen(false)} disabled={opening} className="rounded-xl border border-border px-4 py-2 text-xs text-[var(--text-primary)] hover:bg-surface-elevated">{isEn ? 'Cancel' : 'Cancelar'}</button>
        {configured && <button type="button" onClick={() => void continueToForm()} disabled={opening} className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{opening ? (isEn ? 'Opening...' : 'Abrindo...') : (isEn ? 'Continue' : 'Continuar')}</button>}
      </div>
    </AppDialog>}
  </>;
}
