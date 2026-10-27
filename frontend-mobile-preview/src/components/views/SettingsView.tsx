import React from 'react';
import {
  Film,
  PlaySquare,
  MoveHorizontal,
  Maximize2,
  Gauge,
  Play,
  Layers,
  Layout,
  AppWindow,
  PanelRight,
  Video,
  Power,
  Ban,
  Settings,
  Cpu,
  Shield,
  Palette,
  Volume2,
  VolumeX,
  Headphones,
  Sparkles,
  HelpCircle,
  CheckCircle2,
  Zap,
  Compass,
  Bot,
  Languages,
  Key,
  ShieldCheck,
  Eye,
  EyeOff,
  RefreshCw,
  Lock,
  Server,
  AlertCircle,
  Terminal,
  Cloud,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  RotateCcw
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ThemeMode, Language } from '../../types';
import { AiEngineSelector } from '../common/AiEngineSelector';
import { soundEffects } from '../../services/soundEffects';
import { backendApi } from '../../services/realApi';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';
import {
  getOpenAnimationClass,
  getSwitchAnimationClass,
  getSlideshowAnimationClass,
  getFullscreenAnimationClass,
  getSpeedClass,
  getSpeedMs,
  getDistanceClass,
  getDistanceLabel,
  getViewTransitionClass,
  getModalAnimationClass,
  getDrawerAnimationClass,
  getTaskDockAnimationClass,
  getVideoPlayerAnimationClass
} from '../../services/motionConfig';

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    addNotification,
    availableModels,
    ollamaStatus,
    ollamaModels,
    isCheckingOllama,
    checkOllamaHealth
  } = useAppStore();

  const t: any = translations[settings.language].settings || {};
  const isEn = settings.language === 'en-US';

  const [ollamaUrlInput, setOllamaUrlInput] = React.useState(settings.ollamaBaseUrl || 'http://localhost:11434');
  const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);
  const [isRepairingPalettes, setIsRepairingPalettes] = React.useState(false);
  const [forceRepairPalettes, setForceRepairPalettes] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<'open' | 'switch' | 'fullscreen' | 'slideshow' | 'view' | 'modal' | 'drawer' | 'dock' | 'video'>('open');
  const [previewKey, setPreviewKey] = React.useState(0);
  const [isLoopingPreview, setIsLoopingPreview] = React.useState(false);
  const loopTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const triggerPreview = (mode: 'open' | 'switch' | 'fullscreen' | 'slideshow' | 'view' | 'modal' | 'drawer' | 'dock' | 'video') => {
    setPreviewMode(mode);
    setPreviewKey(k => k + 1);
  };

  const replayAnimation = () => {
    setPreviewKey(k => k + 1);
  };

  React.useEffect(() => {
    if (isLoopingPreview) {
      const speed = getSpeedMs(settings.animationSpeed || 'normal');
      const interval = Math.max(750, speed + 450);
      loopTimerRef.current = setInterval(() => {
        setPreviewKey(k => k + 1);
      }, interval);
    } else if (loopTimerRef.current) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    return () => {
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
    };
  }, [isLoopingPreview, settings.animationSpeed]);

  const [paletteRepairResult, setPaletteRepairResult] = React.useState<{
    success: boolean;
    scanned_albums: number;
    repaired_albums: number;
    repaired_images: number;
    message: string;
  } | null>(null);

  const handleRepairPalettes = async () => {
    setIsRepairingPalettes(true);
    setPaletteRepairResult(null);
    try {
      const res = await backendApi.repairAllAlbumPalettes(forceRepairPalettes);
      setPaletteRepairResult(res);
      if (res.success) {
        addNotification({
          type: 'success',
          title: settings.language === 'pt-BR' ? 'Visão Computacional' : 'Color Vision',
          message: isEn ? `${t.recalculateSuccess} (${res.repaired_images} images in ${res.repaired_albums} albums)` : `${t.recalculateSuccess} (${res.repaired_images} imagens em ${res.repaired_albums} álbuns)`
        });
      } else {
        addNotification({
          type: 'error',
          title: settings.language === 'pt-BR' ? 'Visão Computacional' : 'Color Vision',
          message: res.error || res.message || (isEn ? 'Error recalculating palettes' : 'Erro ao recalcular paletas')
        });
      }
    } catch (err: any) {
      addNotification({
        type: 'error',
        title: settings.language === 'pt-BR' ? 'Visão Computacional' : 'Color Vision',
        message: err.message || (isEn ? 'Error recalculating palettes' : 'Erro ao recalcular paletas')
      });
    } finally {
      setIsRepairingPalettes(false);
    }
  };

  React.useEffect(() => {
    checkOllamaHealth(settings.ollamaBaseUrl || 'http://localhost:11434');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopyCommand = (cmd: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(cmd).catch(() => {
        const textArea = document.createElement("textarea");
        textArea.value = cmd;
        document.body.appendChild(textArea);
        textArea.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(textArea);
      });
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = cmd;
      document.body.appendChild(textArea);
      textArea.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(textArea);
    }
    setCopiedCmd(cmd);
    soundEffects.click(settings.soundEnabled);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleTestOllamaConnection = async () => {
    const cleanUrl = ollamaUrlInput.trim() || 'http://localhost:11434';
    updateSettings({ ollamaBaseUrl: cleanUrl });
    const res = await checkOllamaHealth(cleanUrl);
    if (res.isAvailable) {
      addNotification({
        type: 'success',
        title: t.ollamaConnected,
        message: isEn ? `Server active (v${res.version || '0.5.x'}) with ${res.installedModels.length} model(s) ready.` : `Servidor ativo (v${res.version || '0.5.x'}) com ${res.installedModels.length} modelo(s) pronto(s).`
      });
    } else {
      addNotification({
        type: 'error',
        title: t.ollamaDisconnected,
        message: res.error || (isEn ? 'Could not communicate with Ollama at this URL.' : 'Não foi possível comunicar com o Ollama nesta URL.')
      });
    }
  };

  // API Keys & Cloud Connections State
  const [keysData, setKeysData] = React.useState<{
    gemini: { is_set: boolean; masked_key: string; is_connected: boolean; error: string | null };
    huggingface: { is_set: boolean; masked_token: string; repo_id: string; is_connected: boolean; error?: string | null; auto_cloud_sync?: boolean };
  } | null>(null);
  const [loadingKeys, setLoadingKeys] = React.useState(false);
  const [savingKeys, setSavingKeys] = React.useState(false);
  const [newGeminiKey, setNewGeminiKey] = React.useState('');
  const [newHfToken, setNewHfToken] = React.useState('');
  const [newHfRepo, setNewHfRepo] = React.useState('');
  const [autoCloudSync, setAutoCloudSync] = React.useState(false);
  const [showGeminiField, setShowGeminiField] = React.useState(false);
  const [showHfField, setShowHfField] = React.useState(false);
  const [keyStatusMsg, setKeyStatusMsg] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSyncingHf, setIsSyncingHf] = React.useState(false);

  const handleSyncHf = async () => {
    setIsSyncingHf(true);
    try {
      const res = await backendApi.syncHfData();
      if (res.success) {
        addNotification({
          type: 'success',
          title: 'Hugging Face Dataset',
          message: res.message,
        });
      } else {
        addNotification({
          type: 'error',
          title: 'Hugging Face Dataset',
          message: res.message || res.error || (isEn ? 'Sync failed' : 'Falha na sincronizacao'),
        });
      }
    } catch (e: any) {
      addNotification({
        type: 'error',
        title: 'Hugging Face Dataset',
        message: e.message || (isEn ? 'Sync error' : 'Erro ao sincronizar'),
      });
    } finally {
      setIsSyncingHf(false);
    }
  };

  const fetchKeysStatus = React.useCallback(async () => {
    setLoadingKeys(true);
    try {
      const data = await backendApi.getKeysStatus();
      if (data) {
        setKeysData(data);
        if (data.huggingface?.repo_id) {
          setNewHfRepo(data.huggingface.repo_id);
        }
        if (data.huggingface?.auto_cloud_sync !== undefined) {
          setAutoCloudSync(Boolean(data.huggingface.auto_cloud_sync));
        }
      }
    } catch (e) {
      console.warn('Error fetching keys status:', e);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  React.useEffect(() => {
    fetchKeysStatus();
  }, [fetchKeysStatus]);

  const handleSaveKeys = async () => {
    setSavingKeys(true);
    setKeyStatusMsg(null);
    try {
      const payload: { gemini_api_key?: string; hf_token?: string; hf_dataset_repo?: string; auto_cloud_sync?: boolean } = {
        auto_cloud_sync: autoCloudSync,
      };
      if (newGeminiKey.trim()) payload.gemini_api_key = newGeminiKey.trim();
      if (newHfToken.trim()) payload.hf_token = newHfToken.trim();
      if (newHfRepo.trim()) payload.hf_dataset_repo = newHfRepo.trim();

      const result = await backendApi.updateKeys(payload);
      if (result) {
        setKeysData(result);
        setNewGeminiKey('');
        setNewHfToken('');
        setKeyStatusMsg({
          type: 'success',
          text: t.keysSavedSuccess,
        });
        addNotification({
          type: 'success',
          title: 'Chaves Atualizadas',
          message: isEn ? 'Credentials validated and cloud connections active.' : 'Credenciais validadas e conexões de nuvem ativas.',
        });
      } else {
        setKeyStatusMsg({
          type: 'error',
          text: isEn ? 'Could not save keys on server.' : 'Não foi possível salvar as chaves no servidor.',
        });
      }
    } catch (e) {
      setKeyStatusMsg({
        type: 'error',
        text: isEn ? 'Error communicating with server.' : 'Erro ao comunicar com o servidor.',
      });
    } finally {
      setSavingKeys(false);
    }
  };

  const themes: { id: ThemeMode; label: string; desc: string }[] = [
    { id: 'dark-slate', label: 'Dark Slate Studio', desc: isEn ? 'Sophisticated dark studio with high contrast' : 'Padrão escuro sofisticado com alto contraste' },
    { id: 'deep-oled', label: 'Deep OLED Black', desc: isEn ? 'Pure black for OLED screens and energy savings' : 'Preto puro para telas OLED e economia de energia' },
    { id: 'clean-light', label: 'Clean Light', desc: isEn ? 'Clean light theme for daylight studio' : 'Tema claro de alta legibilidade para estúdio diurno' },
    { id: 'cyber-studio', label: 'Cyber Neon Studio', desc: isEn ? 'Futuristic vibes with purple and cyan accents' : 'Vibração futurista com acentos roxos e cianos' },
  ];

  const ambientSoundOptions = [
    { id: 'none', label: isEn ? 'Disabled' : 'Desativado', desc: isEn ? 'Total silence' : 'Silêncio total' },
    { id: 'lofi', label: 'Lo-Fi Chill Beat', desc: isEn ? 'Soft relaxing beat' : 'Batida suave relaxante' },
    { id: 'rain', label: isEn ? 'Soft Rain' : 'Chuva Suave', desc: isEn ? 'Raindrops on window' : 'Gotas de chuva em janela' },
    { id: 'whitenoise', label: isEn ? 'White Noise' : 'Ruído Branco', desc: isEn ? 'Constant frequency' : 'Frequência constante' },
  ];

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-5 sm:space-y-6 min-w-0 max-w-full pb-20">
      {/* Title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2.5">
          <IconBadge icon={<Settings size={20} />} variant="gold" size="md" />
          <span>{t.title}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {t.subtitle}
        </p>
      </div>

      {/* Section 0: Secure API Keys & Cloud Connections */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <IconBadge icon={<Key size={14} />} variant="gold" size="sm" />
              <span>{t.apiKeysSection}</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t.apiKeysSubtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={fetchKeysStatus}
            disabled={loadingKeys}
            className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-elevated border border-border text-xs font-semibold text-slate-300 hover:text-white transition-all"
          >
            <RefreshCw size={13} className={loadingKeys ? 'animate-spin text-brand-400' : 'text-slate-400'} />
            <span>{loadingKeys ? t.retesting : t.retestConnections}</span>
          </button>
        </div>

        {/* Security Confidentiality Notice */}
        <div className="p-3 rounded-2xl bg-surface-elevated/40 border border-emerald-500/20 flex items-start gap-2.5 text-xs text-slate-300">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed text-slate-300">
            <strong className="text-emerald-300">{t.securityNoticeTitle} </strong>{t.securityNoticeDesc}
          </div>
        </div>

        {keyStatusMsg && (
          <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            keyStatusMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>
            {keyStatusMsg.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>{keyStatusMsg.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* 1. Google Gemini Cloud API */}
          <div className="p-4 rounded-2xl bg-surface-elevated/60 border border-amber-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <Zap size={14} className="text-amber-400" />
                <span>Google Gemini API</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                keysData?.gemini.is_connected
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : keysData?.gemini.is_set
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  keysData?.gemini.is_connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                }`}></span>
                {keysData?.gemini.is_connected
                  ? (isEn ? 'Connected (API Active)' : 'Conectado (API Ativa)')
                  : keysData?.gemini.is_set
                  ? (isEn ? 'Key Saved (Offline/Error)' : 'Chave Salva (Offline/Erro)')
                  : (isEn ? 'Not Configured' : 'Não Configurado')}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-surface/80 border border-border space-y-1">
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{t.serverKey}</div>
              <div className="font-mono text-xs text-slate-200">
                {keysData?.gemini.masked_key || <span className="text-slate-500 italic">{t.noKeySet}</span>}
              </div>
            </div>

            {keysData?.gemini.error && (
              <p className="text-[10px] text-red-400 font-mono">
                {isEn ? 'Warning: ' : 'Aviso: '}{keysData.gemini.error}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-300 font-semibold flex items-center justify-between">
                <span>{t.replaceKey}</span>
              </label>
              <div className="relative">
                <input
                  type={showGeminiField ? "text" : "password"}
                  value={newGeminiKey}
                  onChange={e => setNewGeminiKey(e.target.value)}
                  placeholder={keysData?.gemini.is_set ? t.placeholderGeminiSet : t.placeholderGeminiEmpty}
                  className="w-full pl-3 pr-10 py-2 rounded-xl bg-surface border border-border text-slate-100 font-mono text-xs outline-none focus:border-amber-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiField(!showGeminiField)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                >
                  {showGeminiField ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                {t.geminiHint}
              </p>
            </div>
          </div>

          {/* 2. Hugging Face Hub (Cloud Dataset) */}
          <div className="p-4 rounded-2xl bg-surface-elevated/60 border border-cyan-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-cyan-300 flex items-center gap-1.5">
                <Server size={14} className="text-cyan-400" />
                <span>Hugging Face Dataset (10GB+)</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                keysData?.huggingface.is_connected
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : keysData?.huggingface.is_set
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  keysData?.huggingface.is_connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                }`}></span>
                {keysData?.huggingface.is_connected
                  ? (isEn ? 'Active Repository' : 'Repositório Ativo')
                  : keysData?.huggingface.is_set
                  ? (isEn ? 'Token Saved (Validating)' : 'Token Salvo (Validando)')
                  : (isEn ? 'Disconnected' : 'Desconectado')}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-surface/80 border border-border space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                <span>{isEn ? 'Server Token:' : 'Token no Servidor:'}</span>
                <span className="text-cyan-400 font-mono lowercase">{keysData?.huggingface.repo_id || (isEn ? 'not configured' : 'não configurado')}</span>
              </div>
              <div className="font-mono text-xs text-slate-200">
                {keysData?.huggingface.masked_token || <span className="text-slate-500 italic">{t.noKeySet}</span>}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-300 font-semibold">{t.replaceHfToken}</label>
              <div className="relative">
                <input
                  type={showHfField ? "text" : "password"}
                  value={newHfToken}
                  onChange={e => setNewHfToken(e.target.value)}
                  placeholder={keysData?.huggingface.is_set ? t.placeholderHfSet : t.placeholderHfEmpty}
                  className="w-full pl-3 pr-10 py-2 rounded-xl bg-surface border border-border text-slate-100 font-mono text-xs outline-none focus:border-cyan-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowHfField(!showHfField)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                >
                  {showHfField ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-300 font-semibold">{t.hfRepoLabel}</label>
              <input
                type="text"
                value={newHfRepo}
                onChange={e => setNewHfRepo(e.target.value)}
                placeholder="usuario/meu-album-data"
                className="w-full px-3 py-2 rounded-xl bg-surface border border-border text-slate-100 font-mono text-xs outline-none focus:border-cyan-400 transition-colors"
              />
              <p className="text-[10px] text-slate-500 leading-tight">
                {t.hfHint}
              </p>
            </div>

            {keysData?.huggingface.error && (
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] flex items-start gap-2">
                <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <span className="leading-snug">{keysData.huggingface.error}</span>
              </div>
            )}

            {/* Sincronização Automática na Nuvem (Opcional - Toggle Switch) */}
            <div className="pt-2.5 border-t border-border/60">
              <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                <div className="space-y-0.5 pr-2">
                  <div className="text-[12px] font-bold text-slate-200 flex items-center gap-1.5">
                    <span>{isEn ? 'Automatic Cloud Upload (Auto-Sync)' : 'Upload Automático na Nuvem (Auto-Sync)'}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-semibold border border-slate-700/60 uppercase tracking-wider">
                      {isEn ? 'Optional' : 'Opcional'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 max-w-sm leading-snug">
                    {isEn
                      ? 'When disabled (recommended), videos and albums stay 100% on your local PC. Cloud upload only happens when you manually click "Backup".'
                      : 'Quando desativado (recomendado), seus vídeos e álbuns ficam 100% no seu PC local. O envio para a nuvem só ocorre quando você clica em "Fazer Backup".'}
                  </p>
                </div>
                <div className="relative inline-flex items-center shrink-0">
                  <input
                    type="checkbox"
                    role="switch"
                    {...{ switch: '' }}
                    checked={autoCloudSync}
                    onChange={e => setAutoCloudSync(e.target.checked)}
                    className="sr-only peer"
                    aria-label={isEn ? 'Automatic Cloud Upload' : 'Upload Automático na Nuvem'}
                  />
                  <div className="w-10 h-5 bg-slate-700 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-cyan-400 peer-focus-visible:outline-offset-2 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500 transition-colors"></div>
                </div>
              </label>
            </div>

            {keysData?.huggingface.is_connected && (
              <div className="pt-2 border-t border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">
                  {isEn ? 'Restore albums, jobs and videos from your cloud dataset:' : 'Restaure álbuns, jobs e vídeos do seu dataset na nuvem:'}
                </span>
                <button
                  type="button"
                  onClick={handleSyncHf}
                  disabled={isSyncingHf}
                  className="px-3.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold text-xs flex items-center gap-1.5 transition-all border border-cyan-500/30 shadow-sm"
                >
                  <RefreshCw size={13} className={isSyncingHf ? 'animate-spin text-cyan-400' : 'text-cyan-400'} />
                  <span>{isSyncingHf ? (isEn ? 'Syncing...' : 'Sincronizando...') : (isEn ? 'Sync Dataset Now' : 'Sincronizar Dataset Agora')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Save & Test Button */}
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={handleSaveKeys}
            disabled={savingKeys || (!newGeminiKey.trim() && !newHfToken.trim() && newHfRepo === (keysData?.huggingface.repo_id || '') && autoCloudSync === Boolean(keysData?.huggingface.auto_cloud_sync))}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
              savingKeys
                ? 'bg-brand-500/50 text-white cursor-wait'
                : 'bg-brand-500 hover:bg-brand-600 text-white shadow-glow-brand'
            }`}
          >
            {savingKeys ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
            <span>{savingKeys ? t.savingKeys : t.saveKeysBtn}</span>
          </button>
        </div>
      </div>

      {/* Section 0.5: Local AI & Ollama Onboarding (Fase 3 do Roadmap) */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <IconBadge icon={<Terminal size={14} />} variant="neon" size="sm" />
              <span>{t.ollamaSection}</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t.ollamaSubtitle}
            </p>
          </div>

          {/* Real-time Status Badge */}
          <div className="self-start sm:self-auto flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                ollamaStatus?.isAvailable
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-red-500/20 text-red-300 border-red-500/30'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  ollamaStatus?.isAvailable ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                }`}
              />
              <span>
                {ollamaStatus?.isAvailable
                  ? (isEn ? `Ollama Active (v${ollamaStatus.version || '0.5.x'})` : `Ollama Ativo (v${ollamaStatus.version || '0.5.x'})`)
                  : (isEn ? 'Ollama Offline / Disconnected' : 'Ollama Offline / Desconectado')}
              </span>
            </span>

            {ollamaStatus?.latencyMs !== undefined && ollamaStatus.latencyMs !== null && (
              <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-surface border border-border text-slate-400">
                {ollamaStatus.latencyMs} ms
              </span>
            )}
          </div>
        </div>

        {/* Server URL Input & Live Test Button */}
        <div className="p-4 rounded-2xl bg-surface-elevated/50 border border-border space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Server size={14} className="text-brand-400" />
              <span>{t.ollamaUrlLabel}</span>
            </label>
            <span className="text-[11px] text-slate-400">
              {isEn ? 'Recommended default:' : 'Padrão recomendado:'} <code className="font-mono text-brand-300">http://localhost:11434</code>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={ollamaUrlInput}
              onChange={e => setOllamaUrlInput(e.target.value)}
              onBlur={() => {
                if (ollamaUrlInput.trim()) {
                  updateSettings({ ollamaBaseUrl: ollamaUrlInput.trim() });
                }
              }}
              placeholder="http://localhost:11434"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface border border-border text-slate-100 font-mono text-xs outline-none focus:border-brand-500 transition-colors"
            />

            <button
              type="button"
              onClick={handleTestOllamaConnection}
              disabled={isCheckingOllama}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-surface-elevated hover:bg-surface border border-border hover:border-brand-500/40 text-slate-200 text-xs font-bold transition-all shadow-sm"
            >
              <RefreshCw size={13} className={isCheckingOllama ? 'animate-spin text-brand-400' : 'text-slate-400'} />
              <span>{isCheckingOllama ? t.ollamaTesting : t.ollamaTestBtn}</span>
            </button>
          </div>
        </div>

        {/* Chatbot Co-Pilot Dual Engine Selection & Active Local Model */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Default Chat Engine */}
          <div className="p-4 rounded-2xl bg-surface-elevated/70 border border-border space-y-2.5">
            <label className="text-slate-200 font-bold flex items-center gap-1.5">
              <Bot size={14} className="text-brand-400" />
              <span>{isEn ? 'Default Co-Pilot Chatbot Engine' : 'Motor Padrão do Chatbot Co-Pilot'}</span>
            </label>
            <p className="text-[11px] text-slate-400">
              {isEn ? 'Choose which AI responds primarily in side chat.' : 'Escolha qual inteligência responderá prioritariamente no chat lateral.'}
            </p>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => updateSettings({ aiChatProvider: 'gemini' })}
                className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                  settings.aiChatProvider === 'gemini' || !settings.aiChatProvider
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 shadow-sm'
                    : 'bg-surface border-border text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="font-bold text-xs flex items-center gap-1">
                  <Cloud size={13} className="text-amber-400" /> Gemini Cloud
                </span>
                <span className="text-[10px] text-slate-400">{isEn ? 'Recommended • No installation needed' : 'Recomendado • Sem instalação'}</span>
              </button>

              <button
                type="button"
                onClick={() => updateSettings({ aiChatProvider: 'ollama' })}
                className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                  settings.aiChatProvider === 'ollama'
                    ? 'bg-brand-500/15 border-brand-500/40 text-brand-200 shadow-sm'
                    : 'bg-surface border-border text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="font-bold text-xs flex items-center gap-1">
                  <Terminal size={13} className="text-brand-400" /> Ollama Local
                </span>
                <span className="text-[10px] text-slate-400">Privado • Funciona offline</span>
              </button>
            </div>
          </div>

          {/* Dynamic Installed Models Dropdown */}
          <div className="p-4 rounded-2xl bg-surface-elevated/70 border border-border space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-200 font-bold flex items-center gap-1.5">
                <Cpu size={14} className="text-brand-400" />
                <span>{t.ollamaModelSelect}</span>
              </label>
              {ollamaStatus?.installedModels && ollamaStatus.installedModels.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {ollamaStatus.installedModels.length} instalado(s)
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-400">
              {isEn ? 'Models auto-discovered on your machine.' : 'Modelos descobertos automaticamente na sua máquina.'}
            </p>

            {ollamaStatus?.isAvailable && (ollamaStatus.installedModels.length > 0 || ollamaModels.length > 0) ? (
              <select
                value={settings.selectedOllamaModel || (ollamaStatus.installedModels[0] || 'llama3.2')}
                onChange={e => updateSettings({ selectedOllamaModel: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-border text-slate-100 font-semibold outline-none focus:border-brand-500 transition-colors"
              >
                {ollamaStatus.installedModels.map(mName => {
                  const detailed = ollamaModels.find(m => m.name === mName);
                  const label = detailed ? detailed.label : mName;
                  return (
                    <option key={mName} value={mName}>
                      {label}
                    </option>
                  );
                })}
              </select>
            ) : (
              <div className="p-3 rounded-xl bg-surface border border-border text-[11px] text-slate-400 leading-relaxed">
                {ollamaStatus?.isAvailable ? (
                  <span className="text-amber-300 font-medium flex items-center gap-1.5">
                    <AlertCircle size={14} className="text-amber-400 shrink-0" />
                    <span>{t.ollamaNoModels}</span>
                  </span>
                ) : (
                  <span>
                    {isEn ? 'Connect Ollama above to auto-load models installed on your machine.' : 'Conecte o Ollama acima para carregar automaticamente a lista de modelos instalados na máquina.'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Didactic Step-by-Step Onboarding Guide for Beginners */}
        <div className="p-4 rounded-2xl bg-surface-elevated/40 border border-border space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                <Sparkles size={14} className="text-accent-purple" />
                <span>{t.ollamaCardsTitle}</span>
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isEn ? 'Ollama is 100% free and open-source. Takes less than 2 minutes to get started:' : 'O Ollama é 100% gratuito e open-source. Leva menos de 2 minutos para começar:'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => window.open('https://ollama.com', '_blank')}
              className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-500/20 hover:bg-brand-500/30 text-brand-300 border border-brand-500/40 text-xs font-bold transition-all shadow-sm"
            >
              <span>{t.downloadOllama}</span>
              <ExternalLink size={12} />
            </button>
          </div>

          {/* Ready-to-copy Command Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Card 1: Meta Llama 3.2 */}
            <div className="p-3.5 rounded-2xl bg-surface border border-border hover:border-brand-500/40 transition-all flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-100">Meta Llama 3.2</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {isEn ? '2.0 GB • Lightweight' : '2.0 GB • Leve'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {isEn ? 'Ideal for any PC or laptop. Fast responses and minimal RAM usage.' : 'Ideal para qualquer PC ou notebook. Respostas rápidas e baixíssimo consumo de memória.'}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-surface-elevated border border-border/80">
                <code className="font-mono text-[11px] text-brand-300 truncate">ollama run llama3.2</code>
                <button
                  type="button"
                  onClick={() => handleCopyCommand('ollama run llama3.2')}
                  className="p-1 rounded-lg hover:bg-surface text-slate-400 hover:text-white transition-colors shrink-0"
                  title={t.copyCmd}
                >
                  {copiedCmd === 'ollama run llama3.2' ? (
                    <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-0.5">
                      <Check size={12} /> {t.copied}
                    </span>
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
            </div>

            {/* Card 2: Qwen 2.5:7b */}
            <div className="p-3.5 rounded-2xl bg-surface border border-border hover:border-brand-500/40 transition-all flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-100">Qwen 2.5:7b</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {isEn ? '4.5 GB • Balanced' : '4.5 GB • Equilibrado'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {isEn ? 'Excellent reasoning ability, code analysis, and structured media extraction.' : 'Excelente capacidade de raciocínio, análise de código e extração estruturada de mídia.'}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-surface-elevated border border-border/80">
                <code className="font-mono text-[11px] text-brand-300 truncate">ollama run qwen2.5:7b</code>
                <button
                  type="button"
                  onClick={() => handleCopyCommand('ollama run qwen2.5:7b')}
                  className="p-1 rounded-lg hover:bg-surface text-slate-400 hover:text-white transition-colors shrink-0"
                  title={t.copyCmd}
                >
                  {copiedCmd === 'ollama run qwen2.5:7b' ? (
                    <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-0.5">
                      <Check size={12} /> {t.copied}
                    </span>
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
            </div>

            {/* Card 3: DeepSeek R1:8b */}
            <div className="p-3.5 rounded-2xl bg-surface border border-border hover:border-brand-500/40 transition-all flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-100">DeepSeek R1:8b</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {isEn ? '5.0 GB • Reasoning' : '5.0 GB • Raciocínio'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {isEn ? 'Advanced reasoning model with granular chain-of-thought on your machine.' : 'Modelo de raciocínio avançado com pensamento granular (Chain-of-Thought) na sua máquina.'}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-surface-elevated border border-border/80">
                <code className="font-mono text-[11px] text-brand-300 truncate">ollama run deepseek-r1:8b</code>
                <button
                  type="button"
                  onClick={() => handleCopyCommand('ollama run deepseek-r1:8b')}
                  className="p-1 rounded-lg hover:bg-surface text-slate-400 hover:text-white transition-colors shrink-0"
                  title={t.copyCmd}
                >
                  {copiedCmd === 'ollama run deepseek-r1:8b' ? (
                    <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-0.5">
                      <Check size={12} /> {t.copied}
                    </span>
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 1: AI Strategy Engine & Dual AI Brain Configuration */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-5">
        <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
          <IconBadge icon={<Cpu size={14} />} variant="sapphire" size="sm" />
          <span>{t.aiStrategySection}</span>
        </h3>

        {/* Global Default Engine Selector (4 Engines) */}
        <AiEngineSelector variant="cards" />

        {/* Gemini Cloud Vision & Scout Model */}
        <div className="pt-3 border-t border-border">
          <div className="p-4 rounded-2xl bg-surface-elevated/70 border border-amber-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-amber-300 font-bold flex items-center gap-1.5 text-xs">
                <Zap size={14} className="text-amber-400" />
                <span>{t.geminiModelLabel}</span>
              </label>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {isEn ? 'Vision & Selector Scout' : 'Visão & Descoberta de Seletores'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {t.geminiModelDesc}
            </p>
            <select
              value={settings.geminiModel || 'gemini-3.6-flash'}
              onChange={e => updateSettings({ geminiModel: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-border text-slate-100 text-xs font-semibold outline-none focus:border-amber-400 transition-colors"
            >
              <option value="gemini-3.6-flash">{isEn ? 'Gemini 3.6 Flash (Recommended — Ultra-fast & Most Stable)' : 'Gemini 3.6 Flash (Recomendado — Ultrarrápido & Mais Estável)'}</option>
              <option value="gemini-3.7-flash">{isEn ? 'Gemini 3.7 Flash (Recent Multimodal)' : 'Gemini 3.7 Flash (Multimodal Recente)'}</option>
              <option value="gemini-3.5-flash">{isEn ? 'Gemini 3.5 Flash (Balanced & Low Latency)' : 'Gemini 3.5 Flash (Equilibrado & Baixa Latência)'}</option>
              <option value="gemini-3.5-pro">{isEn ? 'Gemini 3.5 Pro (High Cognitive Capacity)' : 'Gemini 3.5 Pro (Alta Capacidade Cognitiva)'}</option>
              <option value="gemini-3.1-pro-preview">{isEn ? 'Gemini 3.1 Pro (Deep Reasoning for Hard Cases)' : 'Gemini 3.1 Pro (Raciocínio Profundo para Casos Difíceis)'}</option>
            </select>
          </div>
        </div>

        {/* Educational Guide: Como Funciona a Combinação de Motor e Modelo */}
        <div className="p-4 rounded-2xl bg-surface-elevated/50 border border-border/80 space-y-3 mt-3">
          <div className="flex items-center gap-2 text-brand-300 font-bold text-xs">
            <HelpCircle size={15} />
            <span>{isEn ? 'Quick Guide: AI Engines & Operations' : 'Guia Rápido: Motores de IA & Operação'}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
            <div className="p-3 rounded-xl bg-surface/80 border border-white/5 space-y-1">
              <div className="font-bold text-slate-100 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                <span>{isEn ? 'AI Engine = Navigation Strategy' : 'Motor de IA = Estratégia de Navegação'}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {isEn ? (
                  <>Defines <strong>how</strong> the extractor operates: ultra-fast binary X-ray requests without opening browser, or graphical Playwright browser.</>
                ) : (
                  <>Define <strong>como</strong> o extrator opera: se faz requisições diretas com validação física de Raio-X ou se usa o navegador gráfico Playwright.</>
                )}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-surface/80 border border-white/5 space-y-1">
              <div className="font-bold text-slate-100 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>{isEn ? 'Gemini Cloud = Visual & DOM Scout' : 'Gemini Cloud = Scout Visual & Estrutural'}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {isEn ? (
                  <>Audits unfamiliar website HTML structures and deduces original image selectors with zero manual configuration.</>
                ) : (
                  <>Analisa estruturas HTML de sites desconhecidos e deduz os seletores das imagens originais com zero configuração manual.</>
                )}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-white/5">
            <div className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <Sparkles size={13} className="text-amber-400" />
              <span>{isEn ? 'Recommended Modes:' : 'Modos Recomendados:'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="font-bold text-amber-300 flex items-center gap-1">
                  <Zap size={12} className="text-amber-300" />
                  <span>{isEn ? 'Maximum Speed:' : 'Velocidade Máxima:'}</span>
                </div>
                <div className="text-slate-200 text-[10px] mt-0.5 font-medium">Motor 2 (Surgical Scout)</div>
                <div className="text-slate-400 text-[9px] mt-0.5">{isEn ? 'Extracts with physical binary X-ray without opening browser.' : 'Extrai com Raio-X físico sem abrir navegador.'}</div>
              </div>

              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                <div className="font-bold text-cyan-300 flex items-center gap-1">
                  <Compass size={12} className="text-cyan-300" />
                  <span>{isEn ? 'Map New Site:' : 'Mapear Novo Site:'}</span>
                </div>
                <div className="text-slate-200 text-[10px] mt-0.5 font-medium">Motor 1 (Layout Explorer)</div>
                <div className="text-slate-400 text-[9px] mt-0.5">{isEn ? 'Learns layout and saves reusable recipe.' : 'Aprende o layout e salva a receita reutilizável.'}</div>
              </div>

              <div className="p-2.5 rounded-xl bg-brand-500/10 border border-brand-500/20">
                <div className="font-bold text-brand-300 flex items-center gap-1">
                  <Bot size={12} className="text-brand-300" />
                  <span>{isEn ? 'Complex / Dynamic Sites:' : 'Sites Dinâmicos / JS:'}</span>
                </div>
                <div className="text-slate-200 text-[10px] mt-0.5 font-medium">Motor 3 (Playwright Visual)</div>
                <div className="text-slate-400 text-[9px] mt-0.5">{isEn ? 'Uses full visual Playwright with Set-of-Marks.' : 'Usa Playwright visual completo com Set-of-Marks.'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Audio, Sounds & Concentration Mode */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-4">
        <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
          <IconBadge icon={<Volume2 size={14} />} variant="cyan" size="sm" />
          <span>{t.audioSection}</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Sound Effects Toggle */}
          <div className="p-4 rounded-2xl bg-surface-elevated/60 border border-border flex items-center justify-between">
            <div>
              <div className="font-bold text-slate-100 mb-0.5">{t.sfxLabel}</div>
              <div className="text-[11px] text-slate-400">{t.sfxDesc}</div>
            </div>
            <button
              onClick={() => {
                const next = !settings.soundEnabled;
                updateSettings({ soundEnabled: next });
                soundEffects.click(next);
              }}
              className={`p-2.5 rounded-xl border transition-all ${
                settings.soundEnabled
                  ? 'bg-brand-500/20 border-brand-500 text-brand-300'
                  : 'bg-surface-elevated border-border text-slate-500'
              }`}
            >
              {settings.soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>

          {/* Ambient Sound Volume */}
          <div className="p-4 rounded-2xl bg-surface-elevated/60 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100">{t.ambientVolume}</span>
              <span className="text-cyan-400 font-mono font-bold">{Math.round((settings.ambientSoundVolume || 0.3) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.ambientSoundVolume || 0.3}
              onChange={e => updateSettings({ ambientSoundVolume: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>
        </div>

        {/* Ambient Sound Presets */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            {t.soundtrackLabel}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {ambientSoundOptions.map(opt => {
              const isSelected = settings.ambientSoundType === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => updateSettings({ ambientSoundType: opt.id as any })}
                  className={`p-3 rounded-2xl border text-left transition-all ${
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-500 shadow-glow-accent text-cyan-300'
                      : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="font-bold text-xs text-slate-100">{opt.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 3: Visual Theme & Language */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-4">
        <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
          <IconBadge icon={<Palette size={14} />} variant="rose" size="sm" />
          <span>{t.visualSection}</span>
        </h3>

        {/* Language Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pb-3 border-b border-border">
          <div>
            <label className="text-slate-400 block mb-1.5 font-semibold flex items-center gap-1.5">
              <Languages size={14} className="text-slate-400" />
              <span>{t.languageLabel}</span>
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => updateSettings({ language: 'pt-BR' })}
                className={`flex-1 py-2.5 rounded-xl border font-bold transition-all ${
                  settings.language === 'pt-BR'
                    ? 'bg-brand-500/20 border-brand-500 text-brand-300 shadow-glow-brand'
                    : 'bg-surface-elevated border-border text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.portuguese}
              </button>
              <button
                onClick={() => updateSettings({ language: 'en-US' })}
                className={`flex-1 py-2.5 rounded-xl border font-bold transition-all ${
                  settings.language === 'en-US'
                    ? 'bg-brand-500/20 border-brand-500 text-brand-300 shadow-glow-brand'
                    : 'bg-surface-elevated border-border text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.english}
              </button>
            </div>
          </div>
        </div>

        {/* Theme Studio */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            {t.themeLabel}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {themes.map(thm => (
              <button
                key={thm.id}
                onClick={() => updateSettings({ theme: thm.id })}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  settings.theme === thm.id
                    ? 'bg-brand-500/20 border-brand-500 shadow-glow-brand ring-1 ring-brand-500'
                    : 'bg-surface-elevated/40 border-border hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-slate-100 mb-0.5">{thm.label}</div>
                <div className="text-[11px] text-slate-400">{thm.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Section 3.5: Estúdio de Animações & Movimento do Sistema (Senior Full-Stack UI/UX) */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border">
          <div>
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <IconBadge icon={<Film size={14} />} variant="neon" size="sm" />
              <span>{t.motionSection}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {t.motionSectionDesc}
            </p>
          </div>

          {/* Master Switch: Desativar Todas as Animações (Zero Lag / Performance) */}
          <button
            onClick={() => {
              updateSettings({ disableAllAnimations: !settings.disableAllAnimations });
              triggerPreview(previewMode);
            }}
            className={`px-4 py-2 rounded-2xl border flex items-center gap-2 text-xs font-bold transition-all shadow-lg active:scale-95 cursor-pointer ${
              settings.disableAllAnimations
                ? 'bg-rose-500/20 border-rose-500 text-rose-300 ring-1 ring-rose-500 shadow-glow-rose'
                : 'bg-surface-elevated/80 border-border text-slate-300 hover:text-white hover:border-slate-600'
            }`}
          >
            <Power size={14} className={settings.disableAllAnimations ? 'text-rose-400' : 'text-slate-400'} />
            <span>
              {settings.disableAllAnimations ? (isEn ? 'Animations 100% Disabled' : 'Animações 100% Desativadas') : (isEn ? 'Disable All' : 'Desativar Todas')}
            </span>
          </button>
        </div>

        {/* Banner Informativo quando desativado */}
        {settings.disableAllAnimations && (
          <div className="p-3 rounded-2xl bg-rose-950/40 border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-200 animate-fade-in">
            <Ban size={16} className="text-rose-400 shrink-0" />
            <span>
              <strong>{isEn ? 'Zero Motion Mode Active:' : 'Modo Zero Movimento Ativo:'}</strong> {isEn ? 'All application animations are disabled. Modals, images, drawers and pages open instantaneously without transitions.' : 'Todas as animações do aplicativo estão desativadas. Modais, imagens, gavetas e páginas abrem instantaneamente sem transição.'}
            </span>
          </div>
        )}

        {/* 1. Controles Globais de Física e Ritmo */}
        <div className="space-y-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Gauge size={13} className="text-purple-400" />
            <span>Controles Globais de Ritmo & Movimento</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Velocidade Global */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold flex items-center justify-between">
                <span>{t.animSpeedLabel}</span>
                <span className="text-purple-300 font-mono text-[11px] font-bold">
                  {getSpeedMs(settings.animationSpeed || 'normal')}ms
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'ultra-fast', label: t.animSpeedUltraFast, desc: '180ms • Foco em Agilidade' },
                  { id: 'fast', label: t.animSpeedFast, desc: isEn ? '250ms • Agile Response' : '250ms • Resposta Ágil' },
                  { id: 'normal', label: t.animSpeedNormal, desc: isEn ? '350ms • Balanced Standard' : '350ms • Padrão Equilibrado' },
                  { id: 'slow', label: t.animSpeedSlow, desc: isEn ? '500ms • Cinematic' : '500ms • Cinematográfico' }
                ].map(spd => {
                  const isSelected = (settings.animationSpeed || 'normal') === spd.id;
                  return (
                    <button
                      key={spd.id}
                      onClick={() => {
                        updateSettings({ animationSpeed: spd.id as any });
                        triggerPreview(previewMode);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-purple-500/20 border-purple-500 text-purple-200 shadow-glow-brand ring-1 ring-purple-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{spd.label}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{spd.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Distância / Amplitude */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MoveHorizontal size={13} className="text-indigo-400" />
                  <span>{t.animDistanceLabel}</span>
                </span>
                <span className="text-indigo-300 font-mono text-[11px] font-bold">
                  {getDistanceLabel(settings.animationDistance || 'normal')}
                </span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'subtle', label: t.animDistSubtle, desc: t.animDistSubtleDesc },
                  { id: 'normal', label: t.animDistNormal, desc: t.animDistNormalDesc },
                  { id: 'large', label: t.animDistLarge, desc: t.animDistLargeDesc }
                ].map(dist => {
                  const isSelected = (settings.animationDistance || 'normal') === dist.id;
                  return (
                    <button
                      key={dist.id}
                      onClick={() => {
                        updateSettings({ animationDistance: dist.id as any });
                        triggerPreview(previewMode);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200 shadow-glow-brand ring-1 ring-indigo-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{dist.label}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{dist.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 2. Grupo: Transições de Interface & Telas (UI & Navegação) */}
        <div className="pt-3 border-t border-border space-y-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Layout size={13} className="text-blue-400" />
            <span>{t.uiAnimationsCategory}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* Transição de Telas & Abas */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <Layers size={13} className="text-blue-400" />
                  <span>{t.animViewTransitionLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animViewTransitionDesc}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'fade', label: isEn ? 'Fade' : 'Dissolvência' },
                  { id: 'slide', label: isEn ? 'Slide Horizontal' : 'Deslize Lateral' },
                  { id: 'zoom', label: 'Zoom Pop' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.viewTransitionAnimation || 'fade') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ viewTransitionAnimation: opt.id as any });
                        triggerPreview('view');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-blue-500/20 border-blue-500 text-blue-200 ring-1 ring-blue-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Abertura de Modais do Sistema */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <AppWindow size={13} className="text-cyan-400" />
                  <span>{t.animModalLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animModalDesc}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'scale', label: 'Zoom Pop' },
                  { id: 'slide-up', label: isEn ? 'Slide Up' : 'Deslize Inferior' },
                  { id: 'fade', label: isEn ? 'Fade' : 'Dissolvência' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.modalAnimation || 'scale') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ modalAnimation: opt.id as any });
                        triggerPreview('modal');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200 ring-1 ring-cyan-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Gavetas Laterais (Drawers) */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <PanelRight size={13} className="text-teal-400" />
                  <span>{t.animDrawerLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animDrawerDesc}
                </span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'slide', label: isEn ? 'Slide' : 'Deslize' },
                  { id: 'fade', label: 'Fade' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.drawerAnimation || 'slide') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ drawerAnimation: opt.id as any });
                        triggerPreview('drawer');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-teal-500/20 border-teal-500 text-teal-200 ring-1 ring-teal-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dock de Tarefas em Background */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <PlaySquare size={13} className="text-emerald-400" />
                  <span>{t.animTaskDockLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animTaskDockDesc}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'slide-up', label: isEn ? 'Slide Up' : 'Deslize Inferior' },
                  { id: 'bounce', label: isEn ? 'Subtle Spring' : 'Mola Sutil' },
                  { id: 'fade', label: isEn ? 'Fade' : 'Dissolvência' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.taskDockAnimation || 'slide-up') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ taskDockAnimation: opt.id as any });
                        triggerPreview('dock');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Player de Vídeo */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <Video size={13} className="text-violet-400" />
                  <span>{t.animVideoPlayerLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animVideoPlayerDesc}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'zoom', label: 'Zoom Pop' },
                  { id: 'slide-up', label: isEn ? 'Slide Up' : 'Deslize Inferior' },
                  { id: 'fade', label: isEn ? 'Fade' : 'Dissolvência' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.videoPlayerAnimation || 'zoom') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ videoPlayerAnimation: opt.id as any });
                        triggerPreview('video');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-violet-500/20 border-violet-500 text-violet-200 ring-1 ring-violet-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Grupo: Transições de Mídia, Fotos & Álbuns */}
        <div className="pt-3 border-t border-border space-y-4">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Film size={13} className="text-amber-400" />
            <span>{t.mediaAnimationsCategory}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Abertura de Foto */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <Maximize2 size={13} className="text-brand-400" />
                  <span>{t.animLightboxOpenLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animLightboxOpenDesc}
                </span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {[
                  { id: 'expand', label: t.animOptExpand || (isEn ? 'Cinematic' : 'Cinematográfica') },
                  { id: 'elastic', label: t.animOptElastic || (isEn ? 'Elastic Spring' : 'Mola Elástica') },
                  { id: 'zoom', label: 'Zoom Pop' },
                  { id: 'switch', label: t.animOptSwitch || (isEn ? 'Smooth Classic' : 'Suave Clássica') },
                  { id: 'fade', label: t.animOptFade || 'Fade In' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.lightboxOpenAnimation || 'expand') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ lightboxOpenAnimation: opt.id as any });
                        triggerPreview('open');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-brand-500/20 border-brand-500 text-brand-200 shadow-glow-brand ring-1 ring-brand-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Troca de Foto */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <MoveHorizontal size={13} className="text-emerald-400" />
                  <span>{t.animImageSwitchLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animImageSwitchDesc}
                </span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {[
                  { id: 'switch', label: isEn ? 'Classic Smooth' : 'Suave Clássica' },
                  { id: 'zoom', label: 'Zoom Pop' },
                  { id: 'fade', label: 'Crossfade' },
                  { id: 'slide', label: isEn ? 'Slide Horizontal' : 'Deslize Lateral' },
                  { id: 'elastic', label: isEn ? 'Elastic Spring' : 'Mola Elástica' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.imageSwitchAnimation || 'switch') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ imageSwitchAnimation: opt.id as any });
                        triggerPreview('switch');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200 shadow-glow-emerald ring-1 ring-emerald-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slider / Slideshow */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <PlaySquare size={13} className="text-amber-400" />
                  <span>{t.animSlideshowLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animSlideshowDesc}
                </span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {[
                  { id: 'switch', label: isEn ? 'Continuous Smooth' : 'Suave Contínua' },
                  { id: 'fade', label: 'Crossfade' },
                  { id: 'slide', label: isEn ? 'Sliding' : 'Deslizante' },
                  { id: 'zoom', label: isEn ? 'Dynamic Zoom' : 'Zoom Dinâmico' },
                  { id: 'none', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.slideshowAnimation || 'switch') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ slideshowAnimation: opt.id as any });
                        triggerPreview('slideshow');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-amber-500/20 border-amber-500 text-amber-200 ring-1 ring-amber-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modo Tela Cheia */}
            <div className="space-y-2">
              <label className="text-slate-300 font-semibold block">
                <span className="flex items-center gap-1.5">
                  <Maximize2 size={13} className="text-rose-400" />
                  <span>{t.animFullscreenLabel}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                  {t.animFullscreenDesc}
                </span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'elastic', label: isEn ? 'Elastic Spring' : 'Mola Elástica' },
                  { id: 'smooth', label: isEn ? 'Smooth Expansion' : 'Expansão Suave' },
                  { id: 'instant', label: t.animOptDisabled || (isEn ? 'Disabled' : 'Desativado') }
                ].map(opt => {
                  const isSelected = (settings.fullscreenAnimation || 'elastic') === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        updateSettings({ fullscreenAnimation: opt.id as any });
                        triggerPreview('fullscreen');
                      }}
                      className={`p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-rose-500/20 border-rose-500 text-rose-200 ring-1 ring-rose-500'
                          : 'bg-surface-elevated/40 border-border text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{opt.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 4. Visualizador Demonstrativo Interativo (Interactive Preview Theater) */}
        <div className="bg-surface-elevated/60 border border-border rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="space-y-3 text-center md:text-left flex-1 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-200 flex items-center justify-center md:justify-start gap-1.5">
                <Sparkles size={14} className="text-purple-400" />
                <span>{isEn ? 'Animation Live Preview Theater' : 'Teatro Demonstrativo de Animações (Live Preview)'}</span>
              </div>

              {/* Botões Principais de Controle: Reproduzir Animação e Loop */}
              <div className="flex items-center justify-center sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={replayAnimation}
                  className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-glow-brand transition-all active:scale-95 cursor-pointer"
                  title={isEn ? 'Click to play animation now' : 'Clique para reproduzir a animação agora'}
                >
                  <Play size={13} className="fill-white" />
                  <span>{isEn ? 'Play Animation' : 'Reproduzir Animação'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLoopingPreview(!isLoopingPreview)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isLoopingPreview
                      ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200 shadow-glow-brand'
                      : 'bg-surface-elevated border-border text-slate-400 hover:text-slate-200'
                  }`}
                  title={isEn ? 'Repeat animation continuously in loop' : 'Repetir a animação automaticamente em loop contínuo'}
                >
                  <RotateCcw size={12} className={isLoopingPreview ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">{isEn ? 'Continuous Loop' : 'Repetição Contínua'}</span>
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              {isEn
                ? 'Choose an application area to test the effect with your selected style, speed, and distance:'
                : 'Escolha a área da aplicação para testar o efeito com as opções de estilo, velocidade e amplitude selecionadas:'}
            </p>
            
            <div className="flex flex-wrap gap-1.5 pt-1 justify-center md:justify-start">
              {[
                { id: 'open', label: isEn ? '🖼️ Photo Open' : '🖼️ Abertura Foto' },
                { id: 'switch', label: isEn ? '↔️ Photo Switch' : '↔️ Troca Foto' },
                { id: 'slideshow', label: isEn ? '🎞️ Slider' : '🎞️ Slider' },
                { id: 'fullscreen', label: isEn ? '⛶ Fullscreen' : '⛶ Tela Cheia' },
                { id: 'modal', label: isEn ? '🪟 Modal' : '🪟 Modal' },
                { id: 'view', label: isEn ? '🖥️ View/Tab' : '🖥️ Tela/Aba' },
                { id: 'video', label: isEn ? '🎬 Video' : '🎬 Vídeo' },
                { id: 'drawer', label: isEn ? '📑 Drawer' : '📑 Gaveta' },
                { id: 'dock', label: isEn ? '⚓ Dock' : '⚓ Dock' }
              ].map(btn => (
                <button
                  key={btn.id}
                  onClick={() => triggerPreview(btn.id as any)}
                  className={`px-2.5 py-1.5 rounded-xl border text-[10px] font-semibold transition-all cursor-pointer ${
                    previewMode === btn.id
                      ? 'bg-purple-600 text-white border-purple-400 shadow-glow-brand ring-1 ring-purple-400'
                      : 'bg-surface-elevated border-border text-slate-300 hover:text-white'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] font-mono justify-center md:justify-start">
              <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300">
                {isEn ? 'Action:' : 'Ação:'} {previewMode.toUpperCase()}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300">
                {isEn ? 'Speed:' : 'Velocidade:'} {getSpeedMs(settings.animationSpeed || 'normal')}ms
              </span>
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300">
                {isEn ? 'Distance:' : 'Amplitude:'} {getDistanceLabel(settings.animationDistance || 'normal')}
              </span>
              {settings.disableAllAnimations && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 font-bold">
                  {isEn ? 'ZERO MOTION MODE' : 'MODO ZERO MOVIMENTO'}
                </span>
              )}
            </div>
          </div>

          {/* Caixa de Demonstração Visual Clicável (Click to Replay) */}
          <div
            onClick={replayAnimation}
            className="w-40 h-32 sm:w-52 sm:h-36 bg-black/80 rounded-2xl border border-white/10 hover:border-purple-500/50 flex items-center justify-center overflow-hidden shrink-0 relative shadow-2xl p-2 cursor-pointer group transition-all"
            title={isEn ? "Click to replay animation" : "Clique para reproduzir novamente"}
          >
            <div
              key={previewKey}
              className={`w-32 h-24 sm:w-40 sm:h-28 bg-gradient-to-tr from-brand-600 via-purple-600 to-rose-500 rounded-xl shadow-xl flex flex-col items-center justify-center text-white text-[11px] font-bold select-none gpu-accelerated group-hover:scale-[1.02] transition-transform ${
                settings.disableAllAnimations
                  ? 'animate-photo-none'
                  : previewMode === 'view'
                  ? getViewTransitionClass(settings.viewTransitionAnimation || 'fade')
                  : previewMode === 'modal'
                  ? getModalAnimationClass(settings.modalAnimation || 'scale')
                  : previewMode === 'drawer'
                  ? getDrawerAnimationClass(settings.drawerAnimation || 'slide')
                  : previewMode === 'dock'
                  ? getTaskDockAnimationClass(settings.taskDockAnimation || 'slide-up')
                  : previewMode === 'video'
                  ? getVideoPlayerAnimationClass(settings.videoPlayerAnimation || 'zoom')
                  : previewMode === 'open'
                  ? getOpenAnimationClass(settings.lightboxOpenAnimation || 'expand')
                  : previewMode === 'switch'
                  ? getSwitchAnimationClass(settings.imageSwitchAnimation || 'switch')
                  : previewMode === 'slideshow'
                  ? getSlideshowAnimationClass(settings.slideshowAnimation || 'switch')
                  : getFullscreenAnimationClass(settings.fullscreenAnimation || 'elastic')
              } ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')}`}
            >
              <Play size={18} className="fill-white drop-shadow group-hover:scale-110 transition-transform" />
              <span className="text-[10px] tracking-wider uppercase font-mono mt-1 opacity-90">{previewMode}</span>
              <span className="text-[8px] text-white/70 font-normal mt-0.5 sm:block hidden">{isEn ? "Click to replay" : "Clique p/ reproduzir"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 5: Color Vision & On-Disk Metadata Maintenance (Fase 5 do Roadmap) */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <IconBadge icon={<Palette size={14} />} variant="neon" size="sm" />
            <span>{t.colorMaintenanceSection}</span>
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">
            {isEn ? 'Pillow MEDIANCUT 160×160 • 8 Perceptual Colors' : 'Pillow MEDIANCUT 160×160 • 8 Cores Perceptuais'}
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {t.colorMaintenanceDesc}
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-surface-elevated/80 border border-white/5">
          <label className="flex items-center gap-3 cursor-pointer text-xs text-slate-300 select-none">
            <input
              type="checkbox"
              checked={forceRepairPalettes}
              onChange={e => setForceRepairPalettes(e.target.checked)}
              className="w-4 h-4 rounded border-border text-brand-500 focus:ring-0 focus:ring-offset-0 bg-surface cursor-pointer"
            />
            <span>{t.forceRecalculateLabel}</span>
          </label>

          <button
            type="button"
            onClick={handleRepairPalettes}
            disabled={isRepairingPalettes}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-md shadow-violet-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shrink-0"
          >
            {isRepairingPalettes ? (
              <>
                <Loader2 size={14} className="animate-spin text-white" />
                <span>{t.recalculatingPalettes}</span>
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                <span>{t.recalculatePalettesBtn}</span>
              </>
            )}
          </button>
        </div>

        {paletteRepairResult && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2.5 animate-fade-in">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-emerald-200">
                {paletteRepairResult.message}
              </p>
              <p className="text-[11px] text-emerald-300/80">
                {settings.language === 'pt-BR'
                  ? `Álbuns varridos: ${paletteRepairResult.scanned_albums} | Álbuns atualizados: ${paletteRepairResult.repaired_albums} | Imagens enriquecidas: ${paletteRepairResult.repaired_images}`
                  : `Scanned albums: ${paletteRepairResult.scanned_albums} | Updated albums: ${paletteRepairResult.repaired_albums} | Enriched images: ${paletteRepairResult.repaired_images}`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
