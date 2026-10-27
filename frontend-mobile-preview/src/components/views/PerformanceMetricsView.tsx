import { translations } from '../../i18n/translations';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart3,
  HardDrive,
  Sparkles,
  Image as ImageIcon,
  CheckCircle,
  FileImage,
  Layers,
  Cloud,
  Server,
  RefreshCw,
  AlertTriangle,
  Link2,
  SlidersHorizontal,
  Grid,
  Hash,
  Database,
  ShieldCheck,
  Disc
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const PerformanceMetricsView: React.FC = () => {
  const { albums, jobs, settings, syncAlbums, syncJobs } = useAppStore();
  const isEn = settings?.language === 'en-US';
  const tPerf = translations[settings.language].performance;

  const [activeTab, setActiveTab] = useState<'tiers' | 'exact'>('tiers');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(true);

  const loadStorageStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch('/api/storage/analytics', { cache: 'no-store' });
      if (res.ok) {
        setStats(await res.json());
      }
    } catch (e) {
      console.warn('Erro ao carregar estatísticas de storage:', e);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Sincroniza dados ao vivo ao montar o componente
  useEffect(() => {
    if (typeof syncAlbums === 'function') syncAlbums(false);
    if (typeof syncJobs === 'function') syncJobs();
    loadStorageStats();
    const interval = setInterval(loadStorageStats, 15000);
    return () => clearInterval(interval);
  }, [syncAlbums, syncJobs, loadStorageStats]);

  const handleGlobalRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        typeof syncAlbums === 'function' ? syncAlbums(true) : Promise.resolve(),
        typeof syncJobs === 'function' ? syncJobs() : Promise.resolve(),
        loadStorageStats()
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const allImages = useMemo(() => albums.flatMap(a => a.images || []), [albums]);
  const totalImages = allImages.length || albums.reduce((acc, a) => acc + (a.imageCount || 0), 0);
  const totalLibraryBytes = albums.reduce((acc, a) => acc + (a.totalSizeBytes || 0), 0);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 MB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  const resolvedImages = allImages.filter(img => img.isResolvedOriginal || img.status === 'resolved');
  const yieldPercent = totalImages > 0 ? Math.round((resolvedImages.length / totalImages) * 100) : 0;

  // 1. Distribuição de Resolução Categorizada em NÚMEROS (Orientation-aware)
  // Sem termos vagos ou exclusões arbitrárias: 100% dos arquivos classificados
  const numericTiers = useMemo(() => {
    let r2160 = 0;
    let r1440 = 0;
    let r1080 = 0;
    let r720 = 0;
    let r480 = 0;
    let r360 = 0;
    let rSub360 = 0;
    let rUnknown = 0;

    for (const img of allImages) {
      const w = img.width || 0;
      const h = img.height || 0;
      if (w <= 0 || h <= 0) {
        rUnknown++;
        continue;
      }
      const short = Math.min(w, h);
      const long = Math.max(w, h);

      if (short >= 2160 || long >= 3840) {
        r2160++;
      } else if (short >= 1440 || long >= 2560) {
        r1440++;
      } else if (short >= 1080 || long >= 1920) {
        r1080++;
      } else if (short >= 720 || long >= 1280) {
        r720++;
      } else if (short >= 480 || long >= 854) {
        r480++;
      } else if (short >= 360 || long >= 640) {
        r360++;
      } else {
        rSub360++;
      }
    }

    const total = allImages.length;
    const calcPct = (c: number) => (total > 0 ? (c / total) * 100 : 0);

    return [
      {
        id: '2160p',
        label: '≥ 2160p',
        range: '≥ 3840×2160 px',
        badge: '4K+',
        count: r2160,
        pct: calcPct(r2160),
        color: 'bg-emerald-500',
        textColor: 'text-emerald-400',
        borderColor: 'border-emerald-500/40',
        glowColor: 'shadow-emerald-500/20'
      },
      {
        id: '1440p',
        label: '1440p',
        range: '2560×1440 - 2159p',
        badge: '2K QHD',
        count: r1440,
        pct: calcPct(r1440),
        color: 'bg-purple-500',
        textColor: 'text-purple-400',
        borderColor: 'border-purple-500/40',
        glowColor: 'shadow-purple-500/20'
      },
      {
        id: '1080p',
        label: '1080p',
        range: '1920×1080 - 1439p',
        badge: 'FHD',
        count: r1080,
        pct: calcPct(r1080),
        color: 'bg-blue-500',
        textColor: 'text-blue-400',
        borderColor: 'border-blue-500/40',
        glowColor: 'shadow-blue-500/20'
      },
      {
        id: '720p',
        label: '720p',
        range: '1280×720 - 1079p',
        badge: 'HD',
        count: r720,
        pct: calcPct(r720),
        color: 'bg-cyan-500',
        textColor: 'text-cyan-400',
        borderColor: 'border-cyan-500/40',
        glowColor: 'shadow-cyan-500/20'
      },
      {
        id: '480p',
        label: '480p',
        range: '854×480 - 719p',
        badge: 'SD',
        count: r480,
        pct: calcPct(r480),
        color: 'bg-amber-500',
        textColor: 'text-amber-400',
        borderColor: 'border-amber-500/40',
        glowColor: 'shadow-amber-500/20'
      },
      {
        id: '360p',
        label: '360p',
        range: '640×360 - 479p',
        badge: 'ED',
        count: r360,
        pct: calcPct(r360),
        color: 'bg-orange-500',
        textColor: 'text-orange-400',
        borderColor: 'border-orange-500/40',
        glowColor: 'shadow-orange-500/20'
      },
      {
        id: 'sub360p',
        label: '< 360p',
        range: '< 640×360 px (Web/Thumb)',
        badge: 'Miniaturas',
        count: rSub360,
        pct: calcPct(rSub360),
        color: 'bg-rose-500',
        textColor: 'text-rose-400',
        borderColor: 'border-rose-500/40',
        glowColor: 'shadow-rose-500/20'
      },
      {
        id: 'unknown',
        label: '0×0',
        range: 'Não dimensionado / Stream',
        badge: 'Direto',
        count: rUnknown,
        pct: calcPct(rUnknown),
        color: 'bg-slate-600',
        textColor: 'text-slate-400',
        borderColor: 'border-slate-600/40',
        glowColor: 'shadow-slate-600/20'
      }
    ].filter(tier => tier.count > 0 || total === 0);
  }, [allImages]);

  // 2. Top Resoluções Reais em Números (Largura × Altura)
  const topExactResolutions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const img of allImages) {
      if ((img.width || 0) > 0 && (img.height || 0) > 0) {
        const key = `${img.width}×${img.height}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    const total = allImages.length;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([res, count]) => {
        const [w, h] = res.split('×').map(Number);
        const mp = ((w * h) / 1000000).toFixed(1);
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
        const orientation = h > w ? (isEn ? 'Portrait' : 'Retrato') : w > h ? (isEn ? 'Landscape' : 'Paisagem') : (isEn ? 'Square' : 'Quadrado');
        return { res, count, pct, mp, w, h, orientation };
      });
  }, [allImages, isEn]);

  // Formatos detectados
  const formatCounts = useMemo(() => {
    return allImages.reduce((acc: Record<string, number>, img) => {
      const fmt = (img.format || 'jpeg').toUpperCase();
      acc[fmt] = (acc[fmt] || 0) + 1;
      return acc;
    }, {});
  }, [allImages]);

  // Médias
  const avgSizeBytes = allImages.length > 0 ? totalLibraryBytes / allImages.length : 0;
  const avgMp = allImages.length > 0
    ? (allImages.reduce((acc, img) => acc + (img.megapixels || 0), 0) / allImages.length).toFixed(1)
    : '0';

  // Tarefas ativas/em andamento
  const activeJobsCount = jobs.filter(
    j => j.status === 'active' || j.status === 'queued' || (j.status as string) === 'running'
  ).length;

  const localStorage = stats?.local_storage;

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full">
      {/* Header com Atualização em Tempo Real */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2">
            <BarChart3 size={22} className="text-brand-400 shrink-0" />
            <span>{tPerf.title || 'Performance & Storage Analytics'}</span>
          </h1>
          <p className="text-xs text-slate-400">
            {tPerf.subtitle || (isEn ? "Consolidated real-time metrics based on albums and images extracted in the system" : "Métricas consolidadas em tempo real com base nos álbuns e imagens extraídos no sistema")}
          </p>
        </div>
        <button
          onClick={handleGlobalRefresh}
          disabled={isRefreshing}
          className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface border border-border text-xs text-slate-200 hover:text-white flex items-center gap-2 transition-all shadow-sm"
          title="Sincronizar com banco de dados e arquivos locais"
        >
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-brand-400' : 'text-slate-400'} />
          <span>{isRefreshing ? (isEn ? 'Syncing...' : 'Sincronizando...') : (isEn ? 'Live Refresh' : 'Atualizar Dados')}</span>
        </button>
      </div>

      {/* Metric Cards Top Row - 5 Cards com Destaque para Gravado no Disco Local */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Card 1: Volume da Biblioteca */}
        <div className="p-4 sm:p-5 glass-panel rounded-3xl border border-border space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Volume da Biblioteca</span>
            <Database size={16} className="text-accent-purple shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono text-slate-100">
            {formatBytes(totalLibraryBytes)}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">
            {(tPerf.albumsInLibrary || (isEn ? "{count} albums in library" : "{count} álbuns em biblioteca")).replace('{count}', String(albums.length))}
          </p>
        </div>

        {/* Card 2: Gravado Localmente no PC */}
        <div className="p-4 sm:p-5 glass-panel rounded-3xl border border-amber-500/30 bg-amber-500/5 space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between text-amber-300 text-xs">
            <span className="font-bold flex items-center gap-1">
              <HardDrive size={14} className="text-amber-400 shrink-0" />
              <span>Gravado no PC (Local)</span>
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {localStorage?.drive_letter || 'C:'}
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono text-amber-300">
            {formatBytes(localStorage?.total_app_bytes || 0)}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-300 font-medium truncate">
            {localStorage ? `${(localStorage.videos_count || 0)} vídeos • ${formatBytes(localStorage.cache_bytes || 0)} cache` : 'Carregando disco...'}
          </p>
        </div>

        {/* Card 3: Rendimento Original */}
        <div className="p-4 sm:p-5 glass-panel rounded-3xl border border-border space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Rendimento Original</span>
            <Sparkles size={16} className="text-emerald-400 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono text-emerald-400">
            {totalImages > 0 ? `${yieldPercent}% Yield` : '0%'}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">
            {(tPerf.resolvedOriginals || '{count} de {total} fotos em resolução original').replace('{count}', String(resolvedImages.length)).replace('{total}', String(totalImages))}
          </p>
        </div>

        {/* Card 4: Total de Imagens */}
        <div className="p-4 sm:p-5 glass-panel rounded-3xl border border-border space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Total de Imagens</span>
            <ImageIcon size={16} className="text-brand-400 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono text-brand-400">
            {totalImages.toLocaleString()}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">
            {(tPerf.avgMegapixels || (isEn ? "Average {avg} MP per image" : "Média de {avg} MP por imagem")).replace('{avg}', String(avgMp))}
          </p>
        </div>

        {/* Card 5: Tamanho Médio */}
        <div className="p-4 sm:p-5 glass-panel rounded-3xl border border-border space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>{tPerf.avgSize || (isEn ? "Average Size" : "Tamanho Médio")}</span>
            <Layers size={16} className="text-sky-400 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono text-sky-400">
            {formatBytes(avgSizeBytes)}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">
            {(tPerf.tasksCompleted || (isEn ? "{count} tasks completed successfully" : "{count} tarefas concluídas com sucesso")).replace('{count}', String(jobs.filter(j => j.status === 'completed').length))}
          </p>
        </div>
      </div>

      {/* Resolution Distribution Section (Baseada em Números e Dimensões Reais) */}
      <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-border space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-border/50">
          <div>
            <div className="flex items-center gap-2">
              <Hash size={16} className="text-brand-400" />
              <h3 className="font-bold text-xs sm:text-sm text-slate-100">
                {tPerf.resolutionDistribution || (isEn ? "Numeric Resolution Distribution" : "Distribuição Numérica de Resoluções")}
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {tPerf.noExclusions || "100% categorizadas"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {tPerf.resolutionDistributionSubtitle || (isEn ? "Categorization based on real pixel dimensions and vertical tiers (p), without excluding any files." : "Categorização baseada em dimensões reais de pixel e faixas verticais (p), sem exclusão de arquivos.")}
            </p>
          </div>

          {/* Toggle entre Faixas Numéricas (p) e Top Dimensões Exatas (px) */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-elevated/70 border border-border self-start sm:self-auto">
            <button
              onClick={() => setActiveTab('tiers')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                activeTab === 'tiers'
                  ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal size={13} />
              <span>{tPerf.numericTiersTab || (isEn ? "Numeric Tiers (p)" : "Faixas Numéricas (p)")}</span>
            </button>
            <button
              onClick={() => setActiveTab('exact')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                activeTab === 'exact'
                  ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid size={13} />
              <span>{tPerf.exactResolutionsTab || (isEn ? "Top Exact Resolutions (px)" : "Top Resoluções Exatas (px)")}</span>
            </button>
          </div>
        </div>

        {allImages.length > 0 ? (
          <>
            {/* Barra empilhada contínua com todas as faixas numéricas */}
            <div className="space-y-2">
              <div className="h-4 sm:h-4.5 w-full bg-slate-900 rounded-full overflow-hidden flex shadow-inner border border-slate-800">
                {numericTiers.map(tier => {
                  if (tier.pct <= 0) return null;
                  return (
                    <div
                      key={tier.id}
                      className={`h-full ${tier.color} transition-all duration-500 hover:opacity-90 relative group cursor-pointer`}
                      style={{ width: `${tier.pct.toFixed(2)}%` }}
                      title={`${tier.label} (${tier.range}): ${tier.count.toLocaleString()} fotos (${tier.pct.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>0 px</span>
                <span>{(tPerf.photosAnalyzed || "{count} fotos analisadas").replace('{count}', allImages.length.toLocaleString())}</span>
                <span>≥ 3840 px</span>
              </div>
            </div>

            {/* Visualização de Faixas Numéricas */}
            {activeTab === 'tiers' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-1">
                {numericTiers.map(tier => (
                  <div
                    key={tier.id}
                    className={`p-2.5 rounded-2xl bg-surface-elevated/40 border ${tier.borderColor} flex flex-col justify-between hover:bg-surface-elevated/60 transition-all`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-200">
                        <span className={`w-2 h-2 rounded-full ${tier.color} shrink-0`}></span>
                        <span>{tier.label}</span>
                      </span>
                      <span className="text-[9px] px-1 py-0.2 rounded bg-surface/80 text-slate-400 font-mono">
                        {tier.badge}
                      </span>
                    </div>

                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-base font-extrabold font-mono text-slate-100">
                        {tier.count.toLocaleString()}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                        <span className={tier.textColor}>{tier.pct.toFixed(1)}%</span>
                        <span className="text-slate-500 text-[9px] truncate max-w-[65px]" title={tier.range}>
                          {tier.range}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Visualização de Top Dimensões Exatas em Números (px) */}
            {activeTab === 'exact' && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{tPerf.mostFrequentDimensions || "Resoluções mais frequentes na biblioteca:"}</span>
                  <span className="font-mono text-[11px] text-slate-500">Top 12 dimensões identificadas</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {topExactResolutions.map(item => (
                    <div
                      key={item.res}
                      className="p-2.5 rounded-2xl bg-surface-elevated/40 border border-border/80 hover:border-brand-500/40 transition-all space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-black text-brand-300">
                          {item.res}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-surface text-slate-400 font-mono">
                          {item.orientation}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between pt-0.5">
                        <span className="text-sm font-extrabold font-mono text-slate-100">
                          {item.count.toLocaleString()}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400">
                          {item.pct}%
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        ~{item.mp} Megapixels
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-6 text-center text-xs text-slate-500">
            {tPerf.noImagesExtracted || (isEn ? "No images extracted yet to compute distribution." : "Nenhuma imagem extraída ainda para calcular a distribuição.")}
          </div>
        )}
      </div>

      {/* Formatos e Eficiência do Pipeline */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Formatos breakdown */}
        <div className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3">
          <h3 className="font-bold text-xs sm:text-sm text-slate-200 flex items-center gap-2">
            <FileImage size={16} className="text-brand-400" />
            <span>Formatos de Imagem Detectados</span>
          </h3>
          {Object.keys(formatCounts).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {Object.entries(formatCounts).map(([fmt, count]) => (
                <div key={fmt} className="p-3 rounded-2xl bg-surface-elevated/40 border border-border text-center">
                  <div className="text-xs font-mono font-bold text-brand-300">{fmt}</div>
                  <div className="text-lg font-mono font-extrabold text-slate-100">{count.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400">
                    {allImages.length > 0 ? ((count / allImages.length) * 100).toFixed(1) : 0}%
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Nenhum formato registrado.</p>
          )}
        </div>

        {/* Extraction Summary */}
        <div className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3">
          <h3 className="font-bold text-xs sm:text-sm text-slate-200 flex items-center gap-2">
            <CheckCircle size={16} className="text-emerald-400" />
            <span>{tPerf.pipelineEfficiency || (isEn ? "Pipeline Efficiency" : "Eficiência do Pipeline")}</span>
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between p-2.5 rounded-xl bg-surface-elevated/30 border border-border/50">
              <span className="text-slate-400">{tPerf.originalYieldRate || (isEn ? "Original Resolution Rate:" : "Taxa de Resolução Original:")}</span>
              <span className="font-mono font-bold text-emerald-400">{yieldPercent}%</span>
            </div>
            <div className="flex justify-between p-2.5 rounded-xl bg-surface-elevated/30 border border-border/50">
              <span className="text-slate-400">{tPerf.totalIndexedAlbums || (isEn ? "Total Indexed Albums:" : "Total de Álbuns Indexados:")}</span>
              <span className="font-mono font-bold text-slate-200">{albums.length.toLocaleString()}</span>
            </div>
            <div className="flex justify-between p-2.5 rounded-xl bg-surface-elevated/30 border border-border/50">
              <span className="text-slate-400">Fila de Processamento:</span>
              <span className="font-mono font-bold text-slate-200 flex items-center gap-1.5">
                {activeJobsCount > 0 && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>}
                <span>{activeJobsCount} em andamento</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Cloud & Local Storage Infrastructure Dashboard (Sem Menções a Render) */}
      <StorageInfrastructureSection stats={stats} loading={statsLoading} onRefresh={loadStorageStats} />
    </div>
  );
};

// Componente dedicado para monitoramento em tempo real do Disco Local (PC) e Hugging Face Hub
interface StorageInfrastructureProps {
  stats: any;
  loading: boolean;
  onRefresh: () => void;
}

const StorageInfrastructureSection: React.FC<StorageInfrastructureProps> = ({ stats, loading, onRefresh }) => {
  const { settings } = useAppStore();
  const isEn = settings?.language === 'en-US';
  const tPerf = translations[settings.language].performance;

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 MB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const hf = stats?.cloud_huggingface;
  const localDisk = stats?.local_storage;
  const streamOnly = stats?.stream_only;

  return (
    <div className="glass-panel p-5 sm:p-6 rounded-3xl border border-brand-500/30 bg-gradient-to-b from-slate-900/60 to-slate-950/80 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h2 className="text-sm sm:text-base font-black text-slate-100 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Infraestrutura de Armazenamento: Disco Local (PC) & Nuvem</span>
          </h2>
          <p className="text-xs text-slate-400">
            Monitoramento físico e remoto: Disco Rígido deste computador, Hugging Face Hub e Streams sem download
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="self-start sm:self-auto px-3.5 py-1.5 rounded-xl bg-surface-elevated border border-border text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-all shadow-sm"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-brand-400' : ''} />
          <span>{loading ? (isEn ? 'Updating...' : 'Atualizando...') : (isEn ? 'Refresh Storage' : 'Atualizar Espaço')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. Disco Rígido Local do PC (Armazenamento Físico Permanente) */}
        <div className="p-4 rounded-2xl bg-surface/50 border border-amber-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <HardDrive size={15} className="text-amber-400" />
              <span>{tPerf.localDisk || (isEn ? "Local Hard Disk (PC)" : "Disco Rígido Local (PC)")}</span>
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {localDisk?.drive_letter || 'C:'} (LOCAL)
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-mono font-black text-slate-100">
                {formatBytes(localDisk?.total_app_bytes || 0)}
              </span>
              <span className="text-xs font-mono text-slate-400">
                gravado pelo app
              </span>
            </div>

            {/* Accessible Progress Bar seguindo Modern Web Guidance */}
            <div className="space-y-1 pt-0.5">
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>{isEn ? "Drive Usage:" : "Uso do Disco:"}</span>
                <span className="text-amber-300 font-bold">
                  {localDisk?.drive_used_percentage || 0}% ({formatBytes(localDisk?.drive_used_bytes || 0)} de {formatBytes(localDisk?.drive_total_bytes || 0)})
                </span>
              </div>
              <progress
                className="w-full h-2 rounded-full overflow-hidden appearance-none bg-slate-800 border-0 [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500 transition-all duration-700"
                value={localDisk?.drive_used_percentage || 0}
                max={100}
                aria-label={`Uso do disco ${localDisk?.drive_letter || 'C:'}: ${localDisk?.drive_used_percentage || 0}%`}
              />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 space-y-1 pt-1 border-t border-border/40">
            <div className="flex justify-between">
              <span>Vídeos no Disco:</span>
              <span className="font-mono text-slate-200">
                {formatBytes(localDisk?.videos_bytes || 0)} ({(localDisk?.videos_count || 0)} vídeos)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Cache SSD (Imagens):</span>
              <span className="font-mono text-slate-200">
                {formatBytes(localDisk?.cache_bytes || 0)} ({(localDisk?.cache_files_count || 0).toLocaleString()} fotos)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Espaço Livre no PC:</span>
              <span className="font-bold text-emerald-400 font-mono">
                {formatBytes(localDisk?.drive_free_bytes || 0)} livres
              </span>
            </div>
          </div>

          {localDisk?.is_low_space && (
            <p className="text-[10px] text-amber-300/90 leading-tight flex items-start gap-1 pt-1 border-t border-amber-500/20">
              <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <span>Atenção: Restam {formatBytes(localDisk?.drive_free_bytes || 0)} de espaço livre no drive {localDisk?.drive_letter}. Os arquivos estão seguros permanentemente no seu disco local.</span>
            </p>
          )}
        </div>

        {/* 2. Hugging Face Cloud Storage (Nuvem Gratuita) */}
        <div className="p-4 rounded-2xl bg-surface/50 border border-purple-500/30 space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-400 flex items-center gap-1.5">
              <Cloud size={15} className="text-purple-400" />
              <span>Hugging Face Hub</span>
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
              hf?.is_connected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            }`}>
              {hf?.is_connected ? '● CONECTADO' : '○ OFFLINE'}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-mono font-black text-slate-100">
                {formatBytes(hf?.total_bytes_used || 0)}
              </span>
              <span className="text-xs font-mono text-slate-400">
                de 10.00 GB ref ({hf?.used_percentage || 0}%)
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 rounded-full overflow-hidden bg-slate-800">
              <div
                className={`h-full transition-all duration-700 ${
                  (hf?.used_percentage || 0) > 85 ? 'bg-rose-500' : 'bg-purple-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, hf?.used_percentage || 0))}%` }}
              />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 space-y-1 pt-1 border-t border-border/40">
            <div className="flex justify-between">
              <span>{tPerf.secureStorage || (isEn ? "Secure Storage:" : "Repositório Seguro:")}</span>
              <span className="font-mono text-purple-300 truncate max-w-[170px]" title={hf?.repo_id}>{hf?.repo_id || 'album-data'}</span>
            </div>
            <div className="flex justify-between">
              <span>{tPerf.archivedVideos || (isEn ? "Archived Videos:" : "Vídeos Arquivados:")}</span>
              <span className="font-mono text-slate-200">{(hf?.app_recorded_videos || hf?.files_count || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Custo:</span>
              <span className="font-bold text-emerald-400">{tPerf.freeForever || "100% Gratuito (Sem Cartão)"}</span>
            </div>
          </div>
        </div>

        {/* 3. Streaming Remoto / Sem Custo de Disco */}
        <div className="p-4 rounded-2xl bg-surface/50 border border-cyan-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
              <Link2 size={15} className="text-cyan-400" />
              <span>Streaming Puro (URLs)</span>
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              ZERO DISCO
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-mono font-black text-cyan-300">
                {(streamOnly?.videos_count || 0).toLocaleString()} {isEn ? "videos" : "vídeos"}
              </span>
              <span className="text-xs font-mono text-slate-400">
                0 MB consumidos
              </span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden bg-slate-800">
              <div className="h-full bg-cyan-500 w-full" />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 space-y-1 pt-1 border-t border-border/40">
            <p className="text-[10px] text-slate-300 leading-tight">
              {isEn ? "Videos streamed directly from origin servers without physical download, saving 100% disk storage on your PC." : "Vídeos reproduzidos diretamente do servidor de origem sem download físico, preservando 100% do espaço no seu disco rígido."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
