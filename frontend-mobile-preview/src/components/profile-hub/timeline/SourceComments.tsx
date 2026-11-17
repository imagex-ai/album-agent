import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ChevronDown, Heart, ThumbsDown, ThumbsUp} from 'lucide-react';
import {useAppStore} from '../../../store/useAppStore';
import {fetchWatchCommentsPage, WatchComment, WatchCommentsPage, WatchCommentsCursorExpired} from '../../../services/profileHubWatchApi';
import {fetchProfileHubComments, ProfileHubCommentsResponse, SourceTimelineComment} from '../../../services/profileHubComments';
import {SourceAvatar} from '../common/SourceAvatar';

type LegacyRequest = {promise?: Promise<ProfileHubCommentsResponse>; controller: AbortController};
function legacyEntries(comments: SourceTimelineComment[], complete: boolean, parent = 'root', path = ''): WatchComment[] {
  return comments.flatMap((entry, index) => {
    // Missing source IDs remain absent from remote requests; these keys only identify
    // nodes in the legacy response's explicit nested tree, inside this component.
    const key = entry.id || `legacy-ui:${path}${index}`;
    return [{...entry, id:key, parent, reply_count:complete ? (entry.replies?.length || 0) : null, reply_context_available:!!entry.replies?.length, replies:[]}, ...legacyEntries(entry.replies || [], complete, key, `${path}${index}.`)];
  });
}
/** One source-bound page chain. Replies use their source parent, never list position. */
const commentsPageCache = new Map<string, { page: WatchCommentsPage; entries: WatchComment[]; cursor?: string; complete: boolean }>();

function CommentPages({sourceUrl, parentId, ancestors = [], legacy, onReportedTotal, showHeading = true, restartRoot, active = true, suspended = false}: {sourceUrl: string; parentId?: string; ancestors?: string[]; legacy?: LegacyRequest; onReportedTotal?: (total:number|null) => void; showHeading?: boolean; restartRoot: () => void; active?: boolean; suspended?: boolean}) {
  const isEn = useAppStore(state => state.settings.language === 'en-US');
  const cacheKey = `${sourceUrl}::${parentId || 'root'}`;
  const initialCached = commentsPageCache.get(cacheKey);
  const [page, setPage] = useState<WatchCommentsPage | null>(() => initialCached?.page ?? null);
  const [entries, setEntries] = useState<WatchComment[]>(() => initialCached?.entries ?? []);
  const [loading, setLoading] = useState(() => !initialCached);
  const reportedCallbackRef = useRef(onReportedTotal);
  reportedCallbackRef.current = onReportedTotal;
  const [error, setError] = useState(false);
  const [expired, setExpired] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [revealedHidden, setRevealedHidden] = useState<Set<string>>(() => new Set());
  const requestRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<string | undefined>(initialCached?.cursor);
  const completeRef = useRef(Boolean(initialCached?.complete));
  const loadingRef = useRef(false);
  const aliveRef = useRef(false);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const pendingPageRef = useRef(!initialCached);
  const activeRef = useRef(active);
  activeRef.current = active;
  const ancestorsRef = useRef(ancestors);
  ancestorsRef.current = ancestors;
  const load = useCallback(async (initial = false) => {
    if (suspendedRef.current || !aliveRef.current || (!initial && !activeRef.current) || loadingRef.current || completeRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    loadingRef.current = true; setLoading(true); setError(false); setExpired(false);
    try {
      let result: WatchCommentsPage;
      if (legacy) {
        if (legacy.controller.signal.aborted) { legacy.controller = new AbortController(); legacy.promise = undefined; }
        if (!legacy.promise) legacy.promise = fetchProfileHubComments(sourceUrl, legacy.controller.signal).catch(error => {legacy.promise = undefined; throw error;});
        const response = await legacy.promise;
        if (response.source_url !== sourceUrl) throw new Error('Legacy comments source mismatch');
        result = {...response, entries:legacyEntries(response.comments, response.complete).filter(entry => entry.parent === (parentId || 'root')), next_cursor:null};
      } else result = await fetchWatchCommentsPage(sourceUrl, controller.signal, cursorRef.current, parentId);
      if (controller.signal.aborted || requestRef.current !== controller) return;
      if (result.entries.some(entry => entry.parent !== (parentId || 'root') || ancestorsRef.current.includes(entry.id))) throw new Error('Comment parent mismatch');
      if (result.next_cursor && result.next_cursor === cursorRef.current) throw new Error('Comment cursor did not advance');
      let mergedEntries: WatchComment[] = [];
      setEntries(previous => {
        const byId = new Map(previous.map(entry => [entry.id, entry]));
        result.entries.forEach(entry => byId.set(entry.id, entry));
        mergedEntries = [...byId.values()];
        return mergedEntries;
      });
      pendingPageRef.current = false;
      cursorRef.current = result.next_cursor || undefined;
      completeRef.current = result.complete || !result.next_cursor || result.status !== 'ready';
      setPage(result);
      commentsPageCache.set(cacheKey, {
        page: result,
        entries: mergedEntries,
        cursor: cursorRef.current,
        complete: completeRef.current,
      });
      if (!parentId) reportedCallbackRef.current?.(result.status === 'ready' ? result.reported_total : null);
    } catch (failure) {
      if (!controller.signal.aborted && requestRef.current === controller) {pendingPageRef.current = false; setError(true);setExpired(failure instanceof WatchCommentsCursorExpired);}
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; loadingRef.current = false; setLoading(false); }
    }
  }, [sourceUrl, parentId, legacy]);
  useEffect(() => {
    aliveRef.current = true;
    const cached = commentsPageCache.get(cacheKey);
    if (cached && !parentId) {
      reportedCallbackRef.current?.(cached.page.status === 'ready' ? cached.page.reported_total : null);
    }
    if (!suspendedRef.current && !cached) void load(true);
    return () => { aliveRef.current = false; requestRef.current?.abort(); requestRef.current = null; loadingRef.current = false; };
  }, [load, cacheKey, parentId]);
  useEffect(() => {
    if (suspended) {
      if (requestRef.current) {
        pendingPageRef.current = true;
        requestRef.current.abort(); requestRef.current = null;
        loadingRef.current = false; setLoading(false);
      }
      legacy?.controller.abort();
    } else if (pendingPageRef.current) void load(cursorRef.current === undefined);
  }, [suspended, active, load, legacy]);
  useEffect(() => {
    if (suspended || !active || !page?.next_cursor || error || loading || typeof IntersectionObserver === 'undefined' || !sentinelRef.current) return;
    const observer = new IntersectionObserver(items => {
      if (activeRef.current && items.some(item => item.isIntersecting)) void load();
    }, {rootMargin: '160px'});
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [suspended, active, page, error, loading, load]);
  return <div className="space-y-4" aria-busy={loading}>
    {!parentId && !legacy && showHeading && <p data-source-comment-count className="text-xs font-semibold text-[var(--tl-text-secondary)]">{isEn ? 'Source comments' : 'Comentários na origem'} · {page?.reported_total ?? '—'}</p>}
    {entries.map(entry => {
      const authorName = entry.author || entry.handle || '—';
      const avatar = (
        <SourceAvatar
          name={entry.author || entry.handle || authorName}
          src={entry.avatar}
          profileUrl={entry.author_url}
          referer={sourceUrl}
          lazyHydrate
          className="w-8 h-8 rounded-full object-cover shrink-0 bg-[var(--tl-surface-elevated)]"
        />
      );
      // Older servers expose only an exact decimal likes string; compact labels
      // are not exact counts and do not establish a source's reaction capability.
      const legacyLikes = /^\d+$/.test(entry.likes || '') ? Number(entry.likes) : null;
      const reactions = entry.reactions === undefined ? {
        kind: 'like' as const,
        like_count: legacyLikes !== null && Number.isSafeInteger(legacyLikes) ? legacyLikes : null,
        dislike_count: null, heart_count: null, vote_score: null, creator_hearted: null,
      } : entry.reactions;
      const unknownCount = isEn ? 'Count not provided by the source' : 'Contagem não informada pela origem';
      const reactionMetrics = reactions?.kind === 'like_dislike' ? [
        {kind:'like', label:isEn ? 'Source likes' : 'Curtidas na origem', count:reactions.like_count, Icon:ThumbsUp},
        {kind:'dislike', label:isEn ? 'Source dislikes' : 'Não gostei na origem', count:reactions.dislike_count, Icon:ThumbsDown},
      ] : reactions?.kind === 'like' ? [
        {kind:'like', label:isEn ? 'Source likes' : 'Curtidas na origem', count:reactions.like_count, Icon:ThumbsUp},
      ] : reactions?.kind === 'heart' ? [
        {kind:'heart', label:isEn ? 'Source hearts' : 'Corações na origem', count:reactions.heart_count, Icon:Heart},
      ] : [];
      const rawTime = String(entry.time || '').trim();
      const displayTime = rawTime && rawTime.toLowerCase() !== authorName.trim().toLowerCase() ? rawTime : '';
      const isHiddenComment = entry.hidden === true && !revealedHidden.has(entry.id);
      return <div key={entry.id} className="flex items-start gap-3" data-source-comment-id={entry.id}>
      {entry.author_url ? <a href={entry.author_url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true" className="w-8 h-8 shrink-0 rounded-full hover:opacity-80">{avatar}</a> : avatar}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap gap-2 items-center">{entry.author_url ? <a href={entry.author_url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-[var(--tl-text-primary)] hover:text-[var(--tl-accent-text)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tl-accent-hover)]">{authorName}</a> : <span className="text-xs font-bold text-[var(--tl-text-primary)]">{authorName}</span>}{displayTime && <span className="text-[11px] text-[var(--tl-text-muted)]">{displayTime}</span>}</div>
        {isHiddenComment ? (
          <button
            type="button"
            data-comment-reveal={entry.id}
            onClick={() => setRevealedHidden(previous => { const next = new Set(previous); next.add(entry.id); return next; })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--tl-border)] bg-[var(--tl-surface-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:border-[var(--tl-border-strong)] smooth-transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"
          >
            {isEn ? 'Low-score comment hidden. Show' : 'Comentário com pontuação baixa oculto. Mostrar'}
          </button>
        ) : (
          <>
            <p className="text-[13px] leading-5 text-[var(--tl-text-secondary)] whitespace-pre-wrap break-words">{entry.text}</p>
            {entry.hidden === true && (
              <button
                type="button"
                onClick={() => setRevealedHidden(previous => { const next = new Set(previous); next.delete(entry.id); return next; })}
                className="text-[11px] font-medium text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"
              >
                {isEn ? 'Hide comment' : 'Ocultar comentário'}
              </button>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--tl-text-secondary)]">
          {reactionMetrics.map(({kind, label, count, Icon}) => <span key={kind} data-comment-reaction-kind={kind} data-comment-reaction-count={count ?? undefined} className="inline-flex items-center gap-1" aria-label={`${label}: ${count ?? unknownCount}`} title={count == null ? `${label}: ${unknownCount}` : label}><Icon className="w-3 h-3" aria-hidden="true"/>{count ?? '—'}</span>)}
          {reactions?.kind === 'score' && <span data-comment-reaction-kind="score" data-comment-reaction-count={reactions.vote_score ?? undefined} aria-label={`${isEn ? 'Source vote score' : 'Saldo de votos na origem'}: ${reactions.vote_score ?? unknownCount}`} title={reactions.vote_score == null ? unknownCount : undefined}>{isEn ? 'Vote score' : 'Saldo de votos'}: {reactions.vote_score == null ? '—' : reactions.vote_score > 0 ? `+${reactions.vote_score}` : reactions.vote_score}</span>}
          {reactions?.creator_hearted === true && <span data-comment-creator-hearted className="inline-flex items-center gap-1 text-[var(--tl-accent-text)]"><Heart className="w-3 h-3 fill-current" aria-hidden="true"/>{isEn ? 'Hearted by creator' : 'Coração do criador'}</span>}
        </div>
        {entry.reply_count !== 0 && entry.reply_context_available !== false && <button type="button" aria-expanded={expanded.has(entry.id)} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} className="cute-press flex items-center gap-1 py-2 text-xs font-semibold text-[var(--tl-accent-text)] hover:text-[var(--tl-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tl-accent-hover)]"><ChevronDown className={`w-4 h-4 transition-transform duration-300 motion-reduce:transition-none ${expanded.has(entry.id) ? 'rotate-180' : ''}`}/>{expanded.has(entry.id) ? (isEn ? 'Hide replies' : 'Ocultar respostas') : (isEn ? 'Show replies' : 'Ver respostas')}{entry.reply_count != null ? ` (${entry.reply_count})` : ''}</button>}
        {expanded.has(entry.id) && <div className="pl-3 border-l border-[var(--tl-border)] watch-panel-reveal"><CommentPages sourceUrl={sourceUrl} parentId={entry.id} ancestors={[...ancestors, entry.id]} legacy={legacy} restartRoot={restartRoot} active={active} suspended={suspended}/></div>}
      </div>
    </div>;
    })}
    {loading && <p role="status" className="text-xs text-[var(--tl-text-muted)] py-4">{isEn ? 'Loading source comments…' : 'Carregando comentários da origem…'}</p>}
    {error && <div role="alert" className="text-xs text-[var(--tl-text-muted)] space-y-2"><p>{expired ? (isEn ? 'This comment session expired. Reload comments to continue.' : 'Esta sessão de comentários expirou. Recarregue os comentários para continuar.') : (isEn ? 'Could not load source comments.' : 'Não foi possível carregar os comentários da origem.')}</p><button type="button" onClick={expired ? restartRoot : () => void load()} className="text-[var(--tl-accent-text)] underline py-2">{expired ? (isEn ? 'Reload comments' : 'Recarregar comentários') : (isEn ? 'Try again' : 'Tentar novamente')}</button></div>}
    {!loading && !error && page?.status === 'unsupported' && <p className="text-xs text-[var(--tl-text-muted)]">{parentId ? (isEn ? 'Reading these replies is not supported. Open the source to view them.' : 'A leitura destas respostas não é suportada. Abra a origem para vê-las.') : (isEn ? 'Reading comments from this source is not supported.' : 'A leitura de comentários desta origem não é suportada.')}</p>}
    {!loading && !error && page?.status === 'disabled' && <p className="text-xs text-[var(--tl-text-muted)]">{isEn ? 'Comments are disabled on the source.' : 'Os comentários estão desativados na origem.'}</p>}
    {!loading && !error && page?.status === 'ready' && !entries.length && page.complete && <p className="text-xs text-[var(--tl-text-muted)]">{parentId ? (isEn ? 'The source confirms there are no replies.' : 'A origem confirmou que não há respostas.') : (isEn ? 'The source confirms there are no comments.' : 'A origem confirmou que não há comentários.')}</p>}
    {page?.status === 'ready' && <p className="text-[11px] text-[var(--tl-text-muted)]">{!parentId ? (isEn ? `Loaded top-level comments: ${entries.length}. Source-reported total: ${page.reported_total ?? '—'}.` : `Comentários principais carregados: ${entries.length}. Total informado pela origem: ${page.reported_total ?? '—'}.`) : (isEn ? `Loaded replies: ${entries.length}.` : `Respostas carregadas: ${entries.length}.`)}{!page.complete && !page.next_cursor ? (isEn ? ' Partial results; more may be available on the source.' : ' Resultado parcial; pode haver mais na origem.') : ''}</p>}
    <div ref={sentinelRef}/>
    {page?.next_cursor && !error && <button type="button" disabled={loading} onClick={() => void load()} className="text-xs text-[var(--tl-accent-text)] underline py-2 disabled:opacity-50">{isEn ? 'Load more' : 'Carregar mais'}</button>}
  </div>;
}
export const SourceComments: React.FC<{sourceUrl: string; transport?: 'paged' | 'legacy'; onReportedTotal?: (total:number|null) => void; descriptionId?: string; showHeading?: boolean; active?: boolean; suspended?: boolean}> = ({sourceUrl, transport = 'paged', onReportedTotal, descriptionId, showHeading = true, active = true, suspended = false}) => {
  const [generation, setGeneration] = useState(0);
  const restartRoot = () => {onReportedTotal?.(null);setGeneration(value => value + 1);};
  const legacy = useMemo<LegacyRequest>(() => ({controller:new AbortController()}), [sourceUrl]);
  useEffect(() => () => legacy.controller.abort(), [legacy]);
  const isEn = useAppStore(state => state.settings.language === 'en-US');
  return <section aria-label={isEn ? 'Source comments' : 'Comentários na origem'} className="space-y-4"><CommentPages key={`${sourceUrl}:${generation}`} sourceUrl={sourceUrl} legacy={transport === 'legacy' ? legacy : undefined} onReportedTotal={onReportedTotal} showHeading={showHeading} restartRoot={restartRoot} active={active} suspended={suspended}/><p id={descriptionId} className="text-[10px] text-[var(--tl-text-muted)]">{isEn ? 'Read-only comments published on the source.' : 'Leitura dos comentários publicados na origem.'}</p><a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--tl-accent-text)] underline">{isEn ? 'Open on source' : 'Abrir na origem'}</a></section>;
};
