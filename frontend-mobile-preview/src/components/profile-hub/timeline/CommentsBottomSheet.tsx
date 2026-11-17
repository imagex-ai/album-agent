import React, {useEffect, useRef, useState} from 'react';
import {X} from 'lucide-react';
import {TimelinePost} from './timelineModel';
import {timelineCommentsSourceUrl} from '../../../services/profileHubComments';
import {useAppStore} from '../../../store/useAppStore';
import {AppDialog} from '../../common/AppDialog';
import {SourceComments} from './SourceComments';

interface CommentsBottomSheetProps {post: TimelinePost | null; isOpen: boolean; onClose: () => void;}
export const CommentsBottomSheet: React.FC<CommentsBottomSheetProps> = ({post, isOpen, onClose}) => {
  const isEn = useAppStore(state => state.settings.language === 'en-US');
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [reported, setReported] = useState<{source:string; total:number|null} | null>(null);
  useEffect(() => { setReported(null); }, [isOpen, post?.id]);
  if (!isOpen || !post) return null;
  const sourceUrl = timelineCommentsSourceUrl(post);
  return <AppDialog titleId="timeline-comments-title" descriptionId="timeline-comments-source-description" initialFocusRef={closeRef} onClose={onClose} className="tl-themed fixed inset-0 m-0 h-[100dvh] w-screen max-h-none max-w-none border-0 bg-transparent p-0 text-[var(--tl-text-primary)]">
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm overscroll-contain" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-[var(--tl-surface)] border-t sm:border border-[var(--tl-border-strong)] rounded-t-3xl sm:rounded-2xl max-h-[85vh] sm:max-h-[80vh] flex flex-col shadow-2xl overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--tl-border)]"><div className="flex items-center gap-2"><h3 id="timeline-comments-title" className="text-sm font-bold text-[var(--tl-text-primary)]">{isEn ? 'Comments' : 'Comentários'}</h3><span data-source-comment-count className="px-2 py-0.5 rounded-full bg-[var(--tl-accent-soft)] text-[var(--tl-accent-text)] text-xs font-mono font-bold">{reported?.source === sourceUrl ? reported.total ?? '—' : '—'}</span></div><button ref={closeRef} type="button" onClick={onClose} aria-label={isEn ? 'Close' : 'Fechar'} className="p-2 rounded-full text-[var(--tl-text-muted)] hover:text-[var(--tl-text-primary)] hover:bg-[var(--tl-surface-hover)]"><X className="w-4 h-4"/></button></div>
        <div className="overflow-y-auto p-4">{sourceUrl ? <SourceComments key={sourceUrl} sourceUrl={sourceUrl} showHeading={false} descriptionId="timeline-comments-source-description" onReportedTotal={total => setReported({source:sourceUrl, total})}/> : <p id="timeline-comments-source-description" className="text-xs text-[var(--tl-text-muted)]">{isEn ? 'The original URL is unavailable for this post.' : 'A URL original deste post não está disponível.'}</p>}</div>
      </div>
    </div>
  </AppDialog>;
};
