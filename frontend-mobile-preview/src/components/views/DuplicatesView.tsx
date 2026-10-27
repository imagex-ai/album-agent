import React, { useMemo, useState, useEffect } from 'react';
import { Copy, Trash2, CheckCircle2, ShieldCheck, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { ImageItem } from '../../types';
import { translations } from '../../i18n/translations';
import { IconBadge } from '../common/IconBadge';
import { getDuplicateSourceKey } from '../../utils/duplicateSource';

interface DuplicateEntry {
  image: ImageItem;
  albumId: string;
  albumTitle: string;
}

interface DuplicateCluster {
  id: string;
  matchReason: string;
  bestItem: DuplicateEntry;
  redundantItems: DuplicateEntry[];
}

export const DuplicatesView: React.FC = () => {
  const { albums, removeImagesFromAlbum, addNotification, openLightbox, settings } = useAppStore();
  const [filterQuery, setFilterQuery] = useState('');
  const t = translations[settings.language].duplicates;
  const isEn = settings.language === 'en-US';

  // Real Duplicate Detection Algorithm
  const clusters: DuplicateCluster[] = useMemo(() => {
    // 1. Gather all images with their album metadata
    const allEntries: DuplicateEntry[] = [];
    albums.forEach(album => {
      (album.images || []).forEach(img => {
        allEntries.push({
          image: img,
          albumId: album.id,
          albumTitle: album.title
        });
      });
    });

    if (allEntries.length === 0) return [];

    // 2. Group only identical original sources, retaining host and query parameters.
    const groups = new Map<string, DuplicateEntry[]>();

    allEntries.forEach(entry => {
      const img = entry.image;
      const source = getDuplicateSourceKey(img.rawOriginalUrl || img.originalUrl || '');
      const groupKey = source ? `url:${source}` : '';

      if (groupKey) {
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(entry);
      }
    });

    // 3. Filter only groups that have 2 or more distinct image IDs
    const resultClusters: DuplicateCluster[] = [];
    let clusterCounter = 1;

    groups.forEach((items) => {
      // IDs are scoped to the album; the same ID in another album is a separate entry.
      const uniqueItems: DuplicateEntry[] = [];
      const seenIds = new Set<string>();
      items.forEach(it => {
        const entryId = JSON.stringify([it.albumId, it.image.id]);
        if (!seenIds.has(entryId)) {
          seenIds.add(entryId);
          uniqueItems.push(it);
        }
      });

      if (uniqueItems.length >= 2) {
        // Sort items: best resolution / resolved original first
        uniqueItems.sort((a, b) => {
          const resA = (a.image.width || 0) * (a.image.height || 0);
          const resB = (b.image.width || 0) * (b.image.height || 0);
          if (resA !== resB) return resB - resA;
          if (a.image.isResolvedOriginal && !b.image.isResolvedOriginal) return -1;
          if (!a.image.isResolvedOriginal && b.image.isResolvedOriginal) return 1;
          return (b.image.fileSizeBytes || 0) - (a.image.fileSizeBytes || 0);
        });

        const best = uniqueItems[0];
        const redundant = uniqueItems.slice(1);

        resultClusters.push({
          id: `cluster-${clusterCounter++}`,
          matchReason: t.identicalUrl,
          bestItem: best,
          redundantItems: redundant
        });
      }
    });

    return resultClusters;
  }, [albums, t.identicalUrl]);

  const filteredClusters = useMemo(() => {
    if (!filterQuery) return clusters;
    const q = filterQuery.toLowerCase();
    return clusters.filter(c =>
      c.bestItem.albumTitle.toLowerCase().includes(q) ||
      c.bestItem.image.title.toLowerCase().includes(q)
    );
  }, [clusters, filterQuery]);

  // Carregamento progressivo (Buffer Inteligente): exibe inicialmente 16 grupos
  // e expande sob demanda ao rolar a página, evitando sobrecarga de rede e memória
  const [visibleClusterCount, setVisibleClusterCount] = useState(16);

  useEffect(() => {
    setVisibleClusterCount(16);
  }, [filterQuery, clusters.length]);

  const displayedClusters = useMemo(() => {
    return filteredClusters.slice(0, visibleClusterCount);
  }, [filteredClusters, visibleClusterCount]);

  const totalRedundantCount = clusters.reduce((acc, c) => acc + c.redundantItems.length, 0);
  const totalWastedBytes = clusters.reduce(
    (acc, c) => acc + c.redundantItems.reduce((sum, r) => sum + (r.image.fileSizeBytes || 0), 0),
    0
  );

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb >= 1024) {
      return `${(kb / 1024).toFixed(1)} MB`;
    }
    return `${Math.round(kb)} KB`;
  };

  const handleDiscardSingle = async (entry: DuplicateEntry) => {
    const removed = await removeImagesFromAlbum(entry.albumId, [entry.image.id]).catch(() => false);
    if (!removed) return;
    addNotification({
      title: t.discardToast,
      message: t.discardToastMsg.replace('{image}', entry.image.title).replace('{album}', entry.albumTitle),
      type: 'success'
    });
  };

  const handleDiscardAllRedundant = async () => {
    if (clusters.length === 0) return;

    // Group images to delete by albumId
    const deletionsByAlbum = new Map<string, string[]>();
    clusters.forEach(c => {
      c.redundantItems.forEach(r => {
        if (!deletionsByAlbum.has(r.albumId)) {
          deletionsByAlbum.set(r.albumId, []);
        }
        deletionsByAlbum.get(r.albumId)!.push(r.image.id);
      });
    });

    const outcomes = await Promise.allSettled(
      Array.from(deletionsByAlbum, ([albumId, imageIds]) => removeImagesFromAlbum(albumId, imageIds))
    );
    if (!outcomes.every(outcome => outcome.status === 'fulfilled' && outcome.value)) return;

    addNotification({
      title: t.cleanupDone,
      message: t.cleanupDoneMsg.replace('{count}', String(totalRedundantCount)).replace('{size}', formatBytes(totalWastedBytes)),
      type: 'success'
    });
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 flex items-center gap-2.5">
            <IconBadge icon={<Copy size={20} />} variant="gold" size="md" />
            <span>{t.title}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {t.subtitle}
          </p>
        </div>

        {totalRedundantCount > 0 && (
          <button
            onClick={handleDiscardAllRedundant}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-glow-emerald transition-colors"
          >
            <ShieldCheck size={16} />
            <span>{t.keepOnlyOriginals.replace('{count}', String(totalRedundantCount))}</span>
          </button>
        )}
      </div>

      {/* Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface-elevated/40 border border-border text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <AlertCircle size={15} className="text-brand-400 shrink-0" />
          <span>
            {clusters.length > 0
              ? `${t.clustersFound.replace('{count}', String(clusters.length))} (${totalRedundantCount} • ${t.spaceReclaimable.replace('{size}', formatBytes(totalWastedBytes))}).`
              : t.noDuplicates}
          </span>
        </div>

        {clusters.length > 0 && (
          <input
            type="text"
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="px-3 py-1.5 rounded-xl bg-surface border border-border text-xs text-slate-200 outline-none focus:border-brand-500"
          />
        )}
      </div>

      {/* Clusters List */}
      {filteredClusters.length > 0 ? (
        <div className="space-y-4">
          {displayedClusters.map((cluster) => {
            const best = cluster.bestItem;
            return (
              <div key={cluster.id} className="glass-panel p-4 sm:p-5 rounded-3xl border border-border space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold text-[10px]">
                      {cluster.matchReason}
                    </span>
                    <span className="font-semibold text-slate-200 truncate max-w-[200px] sm:max-w-md">
                      {(t.albumLabel || (isEn ? "Album: " : "Álbum: ")) + best.albumTitle}
                    </span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">
                    {(t.redundancySummary || '1 Original + {count} Redundantes').replace('{count}', String(cluster.redundantItems.length))}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {/* Best Item (Keep) */}
                  <div className="p-3 rounded-2xl bg-emerald-950/20 border-2 border-emerald-500 shadow-glow-emerald flex flex-col justify-between">
                    <div className="relative group cursor-pointer" onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      openLightbox(best.image, undefined, {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                      });
                    }}>
                      <img
                        src={best.image.thumbnailUrl || best.image.originalUrl}
                        alt={best.image.title}
                        className="w-full h-40 object-cover rounded-xl mb-2 bg-slate-950"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-emerald-500 text-black font-mono font-bold text-[9px]">
                        {t.keepBadge || 'MANTER'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-emerald-400 truncate max-w-[130px]">
                          {t.bestResolution || (isEn ? "Best Resolution" : "Melhor Resolução")}
                        </span>
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      </div>
                      <p className="text-[11px] font-mono text-slate-300">
                        {best.image.width > 0 ? `${best.image.width}×${best.image.height} px` : (t.originalSize || 'Tamanho Original')}
                        {best.image.fileSizeBytes > 0 ? ` • ${formatBytes(best.image.fileSizeBytes)}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Redundant Items (Discard) */}
                  {cluster.redundantItems.map((redundant) => (
                    <div
                      key={JSON.stringify([redundant.albumId, redundant.image.id])}
                      className="p-3 rounded-2xl bg-surface-elevated/40 border border-border flex flex-col justify-between opacity-85 hover:opacity-100 transition-opacity"
                    >
                      <div className="relative group cursor-pointer" onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        openLightbox(redundant.image, undefined, {
                          x: Math.round(rect.left),
                          y: Math.round(rect.top),
                          width: Math.round(rect.width),
                          height: Math.round(rect.height),
                        });
                      }}>
                        <img
                          src={redundant.image.thumbnailUrl || redundant.image.originalUrl}
                          alt={redundant.image.title}
                          className="w-full h-40 object-cover rounded-xl mb-2 bg-slate-950"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                        <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-rose-500/80 text-white font-mono font-bold text-[9px]">
                          {t.duplicateBadge || 'DUPLICATA'}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-300 truncate max-w-[130px]">
                              {redundant.albumTitle}
                            </span>
                            <span className="text-[10px] font-mono text-rose-400 font-bold">{t.discard || 'DESCARTAR'}</span>
                          </div>
                          <p className="text-[11px] font-mono text-slate-400">
                            {redundant.image.width > 0 ? `${redundant.image.width}×${redundant.image.height} px` : (t.redundantLabel || 'Redundante')}
                            {redundant.image.fileSizeBytes > 0 ? ` • ${formatBytes(redundant.image.fileSizeBytes)}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDiscardSingle(redundant)}
                          className="w-full py-1.5 px-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
                        >
                          <Trash2 size={13} />
                          <span>{t.discardSingle}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Sentinela de Rolagem Suave sob Demanda */}
          {visibleClusterCount < filteredClusters.length && (
            <div
              ref={(el) => {
                if (!el) return;
                const observer = new IntersectionObserver(
                  (entries) => {
                    if (entries[0].isIntersecting) {
                      setVisibleClusterCount((prev) => Math.min(prev + 16, filteredClusters.length));
                    }
                  },
                  { rootMargin: '600px' }
                );
                observer.observe(el);
              }}
              className="py-8 flex flex-col items-center justify-center gap-2 select-none"
            >
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-slate-400 font-mono">
                {isEn
                  ? `Loading more duplicate groups (${displayedClusters.length} of ${filteredClusters.length})...`
                  : `Carregando mais grupos de duplicatas (${displayedClusters.length} de ${filteredClusters.length})...`}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="p-12 glass-panel rounded-3xl border border-border text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 size={24} />
          </div>
          <h3 className="font-bold text-slate-200 text-sm">{t.noDuplicates}</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {t.noDuplicatesDesc}
          </p>
        </div>
      )}
    </div>
  );
};

