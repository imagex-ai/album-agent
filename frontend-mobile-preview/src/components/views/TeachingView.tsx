import React, { useState } from 'react';
import {
  GraduationCap,
  Sparkles,
  Check,
  X,
  Layers,
  Plus,
  ArrowRight,
  Search,
  Save,
  Zap,
  CheckCircle2,
  HelpCircle,
  Link2,
  Info,
  CheckSquare,
  Square
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { soundEffects } from '../../services/soundEffects';
import { backendApi } from '../../services/realApi';
import { SetOfMarkCandidate } from '../../types';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';

export const TeachingView: React.FC = () => {
  const {
    addNotification,
    addLog,
    navigateToView,
    settings,
    backendOnline,
    addJob,
    updateJob,
    addAlbum
  } = useAppStore();
  const t = translations[settings.language].teaching;
  const isEn = settings.language === 'en-US';
  const [teachUrl, setTeachUrl] = useState('');
  const [groundTruthUrl, setGroundTruthUrl] = useState('');
  const [candidatesList, setCandidatesList] = useState<SetOfMarkCandidate[]>([]);
  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [cardOriginalUrls, setCardOriginalUrls] = useState<{ [id: number]: string }>({});
  const [activeUrlInputCardId, setActiveUrlInputCardId] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [ruleLearned, setRuleLearned] = useState<string | null>(null);

  const toggleSelectCard = (id: number) => {
    setSelectedCards(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSetCardOriginalUrl = (id: number, url: string) => {
    setCardOriginalUrls(prev => ({ ...prev, [id]: url }));
  };

  const handleSelectSameContainer = () => {
    if (candidatesList.length === 0) return;
    const targetCandidate = candidatesList.find(c => selectedCards.includes(c.id)) || candidatesList[0];
    if (!targetCandidate || !targetCandidate.selector) {
      setSelectedCards(candidatesList.map(c => c.id));
      return;
    }
    const baseSelector = targetCandidate.selector.split('>')[0]?.trim() || targetCandidate.selector;
    const matching = candidatesList
      .filter(c => c.selector && (c.selector.includes(baseSelector) || c.type === targetCandidate.type))
      .map(c => c.id);
    setSelectedCards(matching.length > 0 ? matching : candidatesList.slice(0, 8).map(c => c.id));
  };

  // Step 1: Scan candidates from URL (Live Playwright + SoM / Mock Fallback)
  const handleScanCandidates = async () => {
    if (!teachUrl.trim()) return;
    setIsScanning(true);
    soundEffects.click(settings.soundEnabled);

    const isRealUrl = teachUrl.startsWith('http://') || teachUrl.startsWith('https://');
    const isMock = teachUrl.includes('.mock');

    addLog({
      level: 'dom',
      category: 'TEACHING_AGENT',
      message: `Escaneando candidatos visuais no DOM de ${teachUrl}...`
    });

    if (backendOnline && isRealUrl && !isMock) {
      try {
        const res = await fetch('/api/scan-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: teachUrl, headless: true })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
            const mapped: SetOfMarkCandidate[] = data.candidates.map((c: any, idx: number) => {
              const rawSrc = c.src || c.current_src || '';
              const proxiedSrc = rawSrc.startsWith('http')
                ? `/api/proxy-image?url=${encodeURIComponent(rawSrc)}&referer=${encodeURIComponent(teachUrl)}`
                : rawSrc;

              return {
                id: idx + 1,
                label: `Candidato #${idx + 1}`,
                thumbnailUrl: proxiedSrc || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600',
                selector: c.selector || c.container_selector || 'img',
                type: 'album_item',
                boundingBox: c.bounding_box || { x: 0, y: 0, width: 100, height: 100 }
              };
            });

            setCandidatesList(mapped);
            setSelectedCards(mapped.slice(0, Math.min(6, mapped.length)).map(m => m.id));
            setIsScanning(false);
            soundEffects.success(settings.soundEnabled);
            addNotification({
              title: isEn ? 'Candidates Mapped!' : 'Candidatos Mapeados!',
              message: isEn ? `${mapped.length} visual elements identified on live page.` : `${mapped.length} elementos visuais identificados na página real.`,
              type: 'info'
            });
            return;
          }
        }
      } catch (err) {
        console.warn('Real scan fallback:', err);
      }
    }

    setIsScanning(false);
    addNotification({
      title: isEn ? 'Connection Notice' : 'Aviso de Conexão',
      message: isEn ? 'Could not scan candidates for this link. Please check the URL provided.' : 'Não foi possível escanear candidatos para este link. Verifique a URL informada.',
      type: 'warning'
    });
  };

  // Helper to build Ground-Truth Dictionary
  const buildGroundTruthDict = () => {
    const gtDict: { [key: string]: string } = {};
    Object.entries(cardOriginalUrls).forEach(([id, u]) => {
      if (u && u.trim()) {
        gtDict[String(id)] = u.trim();
      }
    });
    if (groundTruthUrl && groundTruthUrl.trim()) {
      selectedCards.forEach(id => {
        if (!gtDict[String(id)]) {
          gtDict[String(id)] = groundTruthUrl.trim();
        }
      });
      gtDict['default'] = groundTruthUrl.trim();
    }
    return gtDict;
  };

  // Step 2A: Save Rule Only (Live Qwen Induction & Permanent Knowledge Store Save)
  const handleSaveRuleOnly = async () => {
    setIsSavingRule(true);
    soundEffects.click(settings.soundEnabled);
    const domain = new URL(teachUrl.startsWith('http') ? teachUrl : `https://${teachUrl}`).hostname;
    const gtDict = buildGroundTruthDict();

    addLog({
      level: 'ai',
      category: 'QWEN_INDUCTION',
      message: isEn
        ? `Inducing domain pattern for ${domain} with ${selectedCards.length} positive samples and ground-truth...`
        : `Induzindo padrão de domínio para ${domain} com ${selectedCards.length} amostras positivas e ground-truth...`
    });

    if (backendOnline && (teachUrl.startsWith('http://') || teachUrl.startsWith('https://')) && !teachUrl.includes('.mock')) {
      try {
        const res = await fetch('/api/demonstrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: teachUrl,
            positive_ids: selectedCards.map(String),
            negative_ids: candidatesList.filter(s => !selectedCards.includes(s.id)).map(s => String(s.id)),
            ground_truth_urls: gtDict,
            model_name: settings.aiModel,
            engine_type: 'both'
          })
        });
        if (res.ok) {
          const data = await res.json();
          const sessionId = data.session_id;

          if (sessionId) {
            backendApi.subscribeToSessionEvents(
              sessionId,
              (event) => {
                if (event.type === 'status') {
                  addLog({ level: 'ai', category: 'QWEN_THOUGHT', message: event.message });
                } else if (event.type === 'ai_thought') {
                  addLog({ level: 'ai', category: event.stage || 'QWEN_REASONING', message: event.thought || '' });
                }
              },
              async (_mappedAlbum) => {
                const pattern = `Regra Original induzida para ${domain}`;
                setRuleLearned(pattern);
                setIsSavingRule(false);
                soundEffects.success(settings.soundEnabled);
                addNotification({
                  title: 'Regra Gravada no Conhecimento!',
                  message: `Regra para ${domain} salva permanentemente no banco de conhecimento do Agente.`,
                  type: 'success'
                });
                await useAppStore.getState().syncBackendData();
              },
              async () => {
                setIsSavingRule(false);
                await useAppStore.getState().syncBackendData();
              }
            );
            return;
          }
        }
      } catch (err) {
        console.warn('Real demonstrate fallback:', err);
      }
    }

    setIsSavingRule(false);
    await useAppStore.getState().syncBackendData();
  };

  // Step 2B: Save Rule and Immediately Start Extraction
  const handleSaveRuleAndExtract = async () => {
    setIsExtracting(true);
    soundEffects.click(settings.soundEnabled);
    const domain = new URL(teachUrl.startsWith('http') ? teachUrl : `https://${teachUrl}`).hostname;
    const gtDict = buildGroundTruthDict();

    addLog({
      level: 'ai',
      category: 'QWEN_INDUCTION',
      message: isEn
        ? `Inducing rule and starting immediate autonomous extraction for ${domain}...`
        : `Induzindo regra e iniciando extração autônoma imediata para ${domain}...`
    });

    if (backendOnline && (teachUrl.startsWith('http://') || teachUrl.startsWith('https://')) && !teachUrl.includes('.mock')) {
      try {
        const res = await fetch('/api/demonstrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: teachUrl,
            positive_ids: selectedCards.map(String),
            negative_ids: candidatesList.filter(s => !selectedCards.includes(s.id)).map(s => String(s.id)),
            ground_truth_urls: gtDict,
            model_name: settings.aiModel,
            engine_type: 'both'
          })
        });
        if (res.ok) {
          const data = await res.json();
          const sessionId = data.session_id;

          if (sessionId) {
            const newJob = {
              id: sessionId,
              title: `${isEn ? 'Demonstration' : 'Demonstração'}: ${domain}`,
              url: teachUrl,
              status: 'active' as const,
              mode: 'ai_react' as any,
              aiModel: settings.aiModel,
              progressPercent: 10,
              currentStage: isEn
                ? 'Starting neural reasoning and original resolution formula induction...'
                : 'Iniciando raciocínio neural e indução de fórmula de resolução original...',
              discoveredImagesCount: selectedCards.length,
              resolvedOriginalCount: 0,
              failedCount: 0,
              startTime: new Date().toLocaleTimeString(),
              durationSeconds: 0,
              throughputMbps: 45.2,
              fps: 60,
              estimatedRemainingSeconds: 25
            };

            addJob(newJob);
            setIsExtracting(false);
            soundEffects.success(settings.soundEnabled);
            navigateToView('live-monitor');

            backendApi.subscribeToSessionEvents(
              sessionId,
              (event) => {
                if (event.type === 'status') {
                  updateJob(sessionId, { currentStage: event.message });
                  addLog({ level: 'info', category: 'AGENT_THOUGHT', message: event.message });
                } else if (event.type === 'ai_thought') {
                  addLog({
                    level: 'ai',
                    category: event.stage || 'QWEN_REASONING',
                    message: event.thought || ''
                  });
                } else if (event.type === 'image_resolved' || event.type === 'candidate_processed') {
                  const pos = event.position || event.image?.position || 1;
                  const rawThumb = event.thumbnail_url || event.image?.thumbnail_url || event.image?.src || '';
                  const rawOrig = event.original_url || event.image?.original_url || '';
                  const safeThumb = rawThumb.startsWith('http')
                    ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}&referer=${encodeURIComponent(teachUrl || rawThumb)}`
                    : rawThumb;
                  const isPass = event.validation_status === 'PASS' || event.image?.validation_status === 'PASS';
                  const dims = event.dimensions || (event.image?.width ? `${event.image.width}x${event.image.height}` : 'Original');

                  const markItem = {
                    id: pos,
                    thumbnailUrl: safeThumb,
                    resolvedOriginalUrl: rawOrig,
                    label: `Candidato #${pos} (${dims})`,
                    type: 'album_item' as const,
                    confidence: 1.0,
                    box: { top: 0, left: 0, width: 200, height: 200 }
                  };

                  useAppStore.setState((st) => {
                    const existing = st.setOfMarks.find((m) => m.id === pos);
                    const updatedMarks = existing
                      ? st.setOfMarks.map((m) => (m.id === pos ? markItem : m))
                      : [...st.setOfMarks, markItem];
                    return { setOfMarks: updatedMarks };
                  });

                  if (isPass) {
                    updateJob(sessionId, {
                      resolvedOriginalCount: (useAppStore.getState().activeJob?.resolvedOriginalCount || 0) + 1,
                      currentStage: isEn
                        ? `Resolved original resolution photo #${pos} (${dims})`
                        : `Resolvida foto em resolução original #${pos} (${dims})`
                    });
                  }
                }
              },
              (mappedAlbum) => {
                updateJob(sessionId, {
                  status: 'completed',
                  progressPercent: 100,
                  currentStage: isEn
                    ? 'Extraction and rule learning completed!'
                    : 'Extração e aprendizado de regra concluídos!',
                  resultAlbumId: mappedAlbum.id
                });
                addAlbum(mappedAlbum);
                soundEffects.success(settings.soundEnabled);
                addNotification({
                  title: isEn ? 'Album and Rule Saved!' : 'Álbum e Regra Salvos!',
                  message: isEn
                    ? `Album for ${domain} was extracted and rule saved permanently.`
                    : `O álbum de ${domain} foi extraído e a regra foi salva permanentemente.`,
                  type: 'success'
                });
                useAppStore.getState().syncBackendData();
              },
              (err) => {
                updateJob(sessionId, { status: 'failed', currentStage: `Erro: ${err}` });
              }
            );
            return;
          }
        }
      } catch (err) {
        console.warn('Real demonstrate & extract error:', err);
      }
    }

    setIsExtracting(false);
    navigateToView('live-monitor');
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2.5">
          <IconBadge variant="neon" size="md">
            <GraduationCap size={18} />
          </IconBadge>
          <span>{t.title}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {t.subtitle}
        </p>
      </div>

      {/* Step 1: Scan Form Card */}
      <div className="glass-panel p-3.5 sm:p-5 rounded-3xl border border-border space-y-3 sm:space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold text-accent-purple uppercase tracking-wider flex items-center gap-1.5">
            <Search size={13} />
            {t.step1Title}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
          <input
            type="url"
            value={teachUrl}
            onChange={e => setTeachUrl(e.target.value)}
            placeholder={t.urlPlaceholder}
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface-elevated border border-border text-slate-100 text-xs outline-none focus:border-brand-500 font-mono"
          />
          <button
            onClick={handleScanCandidates}
            disabled={isScanning}
            className="px-5 py-2.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border text-slate-100 text-xs font-bold transition-all flex items-center justify-center gap-2 shrink-0 active:scale-98"
          >
            <Search size={14} className={isScanning ? 'animate-spin text-brand-400' : 'text-slate-300'} />
            <span>{isScanning ? t.scanningBtn : t.scanBtn}</span>
          </button>
        </div>

        {/* Global Ground Truth URL Input (Optional) */}
        <div className="pt-2 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
          <span className="text-slate-400 text-[11px] shrink-0 flex items-center gap-1">
            <Link2 size={12} className="text-emerald-400" />
            {t.groundTruthLabel}
          </span>
          <input
            type="url"
            value={groundTruthUrl}
            onChange={e => setGroundTruthUrl(e.target.value)}
            placeholder={t.groundTruthPlaceholder}
            className="flex-1 px-3 py-1.5 rounded-xl bg-surface-elevated border border-border text-slate-200 text-xs outline-none focus:border-emerald-500 font-mono"
          />
        </div>

        {/* Informative helper banner */}
        <div className="p-2.5 rounded-xl bg-surface-elevated/60 border border-white/5 flex items-center gap-2 text-[11px] text-slate-400">
          <Info size={14} className="text-brand-400 shrink-0" />
          <span>{t.groundTruthNotice}</span>
        </div>
      </div>

      {/* Step 2: Interactive Demonstration Selection Toolbar */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-2xl border border-border space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-scroll py-0.5 max-w-full">
            <button
              onClick={() => setSelectedCards(candidatesList.map(s => s.id))}
              disabled={candidatesList.length === 0}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-300 hover:text-white border border-border whitespace-nowrap shrink-0 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              <CheckSquare size={13} className="text-emerald-400" />
              <span>{t.selectAll}</span>
            </button>
            <button
              onClick={() => setSelectedCards([])}
              disabled={candidatesList.length === 0}
              className="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover text-slate-300 hover:text-white border border-border whitespace-nowrap shrink-0 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              <Square size={13} className="text-slate-400" />
              <span>{t.deselectAll}</span>
            </button>
            <button
              onClick={handleSelectSameContainer}
              disabled={candidatesList.length === 0}
              className="px-3 py-1.5 rounded-xl bg-brand-500/20 hover:bg-brand-500/30 text-brand-300 border border-brand-500/40 font-semibold whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-40"
            >
              <Sparkles size={13} />
              <span>{t.selectSameContainer}</span>
            </button>
          </div>

          <div className="font-mono text-emerald-400 font-bold text-xs whitespace-nowrap shrink-0">
            {t.selectedCount.replace('{count}', String(selectedCards.length))}
          </div>
        </div>

        {/* Step 3: The 2 Distinct Save & Action Buttons */}
        <div className="pt-3 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
          {/* Option A: Save Rule Only */}
          <button
            onClick={handleSaveRuleOnly}
            disabled={isSavingRule || isExtracting || selectedCards.length === 0}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-accent-purple/40 text-accent-purple hover:text-white text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-98 shadow-sm disabled:opacity-50"
            title={isEn ? "Only induce the formula and save rule in Knowledge Graph" : "Apenas induz a fórmula e salva a regra no Grafo de Conhecimento"}
          >
            <Save size={14} className={isSavingRule ? 'animate-spin' : ''} />
            <span>{isSavingRule ? (isEn ? 'Inducing Rule...' : 'Induzindo Regra...') : t.saveRuleBtn}</span>
          </button>

          {/* Option B: Save Rule and Immediately Start Extraction */}
          <button
            onClick={handleSaveRuleAndExtract}
            disabled={isSavingRule || isExtracting || selectedCards.length === 0}
            className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-accent-purple hover:from-brand-500 hover:to-accent-purple/90 text-white text-xs font-bold shadow-glow-brand transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
            title={isEn ? "Save rule and immediately start autonomous extraction of album" : "Salva a regra e inicia a extração autônoma do álbum imediatamente"}
          >
            <Zap size={14} className={isExtracting ? 'animate-bounce' : ''} />
            <span>{isExtracting ? (isEn ? 'Starting Extraction...' : 'Iniciando Extração...') : t.extractBtn}</span>
          </button>
        </div>
      </div>

      {/* Success Badge if Rule Learned */}
      {ruleLearned && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2.5 animate-scale-up">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <span className="font-bold">{t.ruleLearned} </span>
            <span className="font-mono text-slate-200">{ruleLearned}</span>
          </div>
        </div>
      )}

      {/* Candidate Visual Grid (Set-of-Marks) */}
      {candidatesList.length === 0 ? (
        <div className="p-8 sm:p-12 glass-panel rounded-3xl border border-dashed border-border text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-surface-elevated border border-border flex items-center justify-center mx-auto text-slate-400 shadow-sm">
            <IconBadge variant="neon" size="md">
              <Search size={18} />
            </IconBadge>
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-sm sm:text-base font-bold text-slate-200">
              {t.emptyCandidates}
            </h3>
            <p className="text-xs text-slate-400">
              {t.emptyCandidatesDesc}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {candidatesList.map(som => {
            const isSelected = selectedCards.includes(som.id);
            const hasCustomUrl = !!cardOriginalUrls[som.id];
            const isInputActive = activeUrlInputCardId === som.id;

            return (
              <div
                key={som.id}
                onClick={() => toggleSelectCard(som.id)}
                className={`p-3 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-surface-elevated border-emerald-500 shadow-glow-emerald ring-2 ring-emerald-500/50'
                    : 'bg-surface-elevated/40 border-border hover:border-slate-700 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-black/60 text-slate-300 border border-white/10">
                      #{som.id}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                        isSelected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {isSelected
                        ? (t.positiveSample || (isEn ? '+ Positive Sample' : '+ Amostra Positiva'))
                        : (t.noiseSample || (isEn ? '- Rejected Noise' : '- Ruído Rejeitado'))}
                    </span>
                  </div>

                  <div className="aspect-[4/3] rounded-xl overflow-hidden mb-2 bg-slate-900">
                    <img src={som.thumbnailUrl} alt="SOM" className="w-full h-full object-cover pointer-events-none" />
                  </div>

                  <div className="space-y-1">
                    <div className="font-mono text-[10px] text-slate-400 truncate" title={`DOM: ${som.selector}`}>
                      <span className="text-slate-500 font-bold">DOM: </span>{som.selector}
                    </div>

                    <div className="font-mono text-[9px] text-slate-400 truncate flex items-center gap-1" title={`URL: ${som.thumbnailUrl}`}>
                      <span className="text-brand-400 font-bold shrink-0">URL:</span>
                      <span className="truncate text-slate-300">{som.thumbnailUrl}</span>
                    </div>
                  </div>
                </div>

                {/* Optional Individual Original Link Insertion per Candidate */}
                <div className="mt-2.5 pt-2 border-t border-white/5" onClick={e => e.stopPropagation()}>
                  {isInputActive || hasCustomUrl ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="flex items-center gap-1 font-mono text-emerald-400 font-bold">
                          <Link2 size={10} /> {t.originalLink || 'Link Original:'}
                        </span>
                        {hasCustomUrl && (
                          <button
                            onClick={() => handleSetCardOriginalUrl(som.id, '')}
                            className="text-[9px] text-rose-400 hover:underline"
                          >
                            {t.clear || 'Limpar'}
                          </button>
                        )}
                      </div>
                      <input
                        type="url"
                        value={cardOriginalUrls[som.id] || ''}
                        onChange={e => handleSetCardOriginalUrl(som.id, e.target.value)}
                        placeholder={t.originalPlaceholder || 'https://...'}
                        className="w-full px-2 py-1 rounded-lg bg-surface border border-white/15 text-slate-100 text-[10px] font-mono outline-none focus:border-emerald-500"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveUrlInputCardId(som.id)}
                      className="w-full py-1.5 rounded-lg bg-surface hover:bg-surface-elevated border border-white/10 text-slate-400 hover:text-slate-200 text-[10px] font-medium flex items-center justify-center gap-1 transition-colors"
                      title={t.insertOriginalLink || '+ Inserir Link Original (Opcional)'}
                    >
                      <Link2 size={11} className="text-brand-400 shrink-0" />
                      <span>{t.insertOriginalLink || '+ Inserir Link Original (Opcional)'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
