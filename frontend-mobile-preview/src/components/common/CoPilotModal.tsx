import React, { useState, useEffect } from 'react';
import { X, Bot, Check, AlertCircle, Sparkles, Send } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { backendApi } from '../../services/realApi';

export const CoPilotModal: React.FC = () => {
  const { coPilotOpen, setCoPilotOpen, setOfMarks, activeJob, settings } = useAppStore();
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(1);
  const [userHint, setUserHint] = useState('');
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    if (!coPilotOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCoPilotOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [coPilotOpen, setCoPilotOpen]);

  if (!coPilotOpen) return null;

  const handleResolve = async () => {
    if (activeJob?.id && selectedCandidateId) {
      await backendApi.submitCopilotResponse(activeJob.id, selectedCandidateId.toString(), userHint);
    }
    setIsResolved(true);
    setTimeout(() => {
      setCoPilotOpen(false);
      setIsResolved(false);
    }, 800);
  };

  return (
    <div
      onClick={() => setCoPilotOpen(false)}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-fade-in"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-border shadow-2xl rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col"
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand-500/20 text-brand-400">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100">{settings.language === "en-US" ? "Human Intervention Co-Pilot" : "Co-Pilot de Intervenção Humana"}</h3>
              <p className="text-[11px] text-slate-400">{settings.language === "en-US" ? "The agent requires validation to classify ambiguous page elements" : "O agente precisa de validação para classificar elementos ambíguos na página"}</p>
            </div>
          </div>
          <button onClick={() => setCoPilotOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="p-3.5 rounded-xl bg-brand-950/40 border border-brand-500/30 text-brand-200 flex items-start gap-2.5">
            <Sparkles size={16} className="text-brand-400 flex-shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>{settings.language === "en-US" ? "Agent Question:" : "Pergunta do Agente:"}</strong> {settings.language === "en-US" ? '"I identified 4 cards on this gallery page. Which one represents the primary album rather than banners or previews?"' : '"Identifiquei 4 cards nesta página da galeria. Qual deles representa o álbum principal em vez de banners ou prévias?"'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {setOfMarks.slice(0, 4).map(som => (
              <div
                key={som.id}
                onClick={() => setSelectedCandidateId(som.id)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedCandidateId === som.id
                    ? 'bg-brand-500/20 border-brand-500 shadow-glow-brand ring-1 ring-brand-500'
                    : 'bg-surface-elevated border-border hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold font-mono px-2 py-0.5 rounded bg-black/60 text-emerald-400 text-[10px]">
                    Box #{som.id}
                  </span>
                  <span className="text-[10px] text-slate-400">{som.type}</span>
                </div>
                <img src={som.thumbnailUrl} alt={som.label} className="w-full h-24 object-cover rounded-lg mb-2" />
                <p className="text-[11px] font-medium text-slate-200 truncate">{som.label}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={userHint}
              onChange={e => setUserHint(e.target.value)}
              placeholder={settings.language === "en-US" ? "Or type an instruction for the agent (e.g. ignore avatar links)..." : "Ou digite uma instrução para o agente (ex: ignore links de avatars)..."}
              className="flex-1 px-3.5 py-2 rounded-xl bg-surface-elevated border border-border text-slate-200 text-xs outline-none focus:border-brand-500"
            />
            <button
              onClick={handleResolve}
              className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-glow-brand"
            >
              {isResolved ? <Check size={14} /> : <Send size={14} />}
              <span>{settings.language === "en-US" ? "Confirm Selection" : "Confirmar Seleção"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
