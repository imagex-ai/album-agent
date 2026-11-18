import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React from 'react';
import { Bookmark, Download, Layers, List, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { profileHubReviewCopy } from '../../services/profileHubReviewCopy';

interface FloatingActionBarProps {
  selectedCount: number;
  selectedSummary: string;
  previewThumbnails: string[];
  onOpenReview: () => void;
  onSaveToGallery: () => void;
  onDownloadZip: () => void;
  onClearSelection: () => void;
  actionsDisabled?: boolean;
  saveDisabled?: boolean;
  saveDisabledReason?: string;
  disabledReason?: string;
  variant?: 'legacy' | 'review';
}

export const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  selectedCount,
  selectedSummary,
  previewThumbnails,
  onOpenReview,
  onSaveToGallery,
  onDownloadZip,
  onClearSelection,
  actionsDisabled = false,
  saveDisabled = actionsDisabled,
  saveDisabledReason,
  disabledReason,
  variant = 'legacy'
}) => {
  const { copy } = useProfileHubPresentation();
  const language = useAppStore(state => state.settings.language);
  const reviewCopy = profileHubReviewCopy[language];
  if (selectedCount === 0) return null;

  if (variant === 'review') return <section className="phr-selection-bar" aria-label={reviewCopy.active}>
    <button type="button" className="phr-selection-overview" onClick={onOpenReview} aria-label={`${reviewCopy.review}: ${selectedSummary}`}>
      <Layers size={25} aria-hidden="true" /><span><strong>{reviewCopy.active}</strong><small aria-live="polite">{selectedSummary}</small></span>
      <span className="phr-selection-previews" aria-hidden="true">{previewThumbnails.filter(Boolean).slice(0, 3).map((thumb, index) => <img key={index} src={thumb} alt="" loading="lazy" decoding="async" />)}</span>
    </button>
    <div className="phr-selection-actions"><button type="button" className="pd-button pd-primary phr-primary" data-profile-hub-review onClick={onOpenReview}><List size={16} aria-hidden="true" />{reviewCopy.review}</button>
      <button type="button" className="pd-button" onClick={onClearSelection}><X size={16} aria-hidden="true" />{reviewCopy.clear}</button></div>
  </section>;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-max max-w-[96vw] animate-in slide-in-from-bottom-5 duration-200">
      <div className="flex items-center gap-3.5 sm:gap-5 px-4 sm:px-6 py-2.5 sm:py-3 rounded-2xl bg-[#141221]/95 backdrop-blur-xl border border-white/15 shadow-[0_12px_40px_rgba(0,0,0,0.7)] ring-1 ring-purple-500/25">
        {/* Overlapping Thumbnails Preview (Matching 01_Canonico_Desktop) */}
        <div 
          onClick={onOpenReview}
          className="flex items-center -space-x-2 shrink-0 cursor-pointer group"
          title={copy.reviewHint}
        >
          {previewThumbnails.slice(0, 3).map((thumb, idx) => (
            <div
              key={idx}
              className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-lg overflow-hidden border border-white/25 shadow-md bg-slate-900 group-hover:scale-105 transition-transform"
            >
              <img loading="lazy" decoding="async" src={thumb}
                alt={copy.thumbnail}
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* Text Counts / Summary (Never truncated, generous whitespace) */}
        <div 
          onClick={onOpenReview}
          className="cursor-pointer shrink-0 select-none group flex flex-col justify-center min-w-max pr-1"
          title={copy.reviewHint}
        >
          <span className="text-xs sm:text-sm font-bold text-white tracking-tight whitespace-nowrap group-hover:text-purple-300 transition-colors">
            {selectedCount} {selectedCount === 1 ? copy.ui51 : copy.ui52}
          </span>
          <p className="text-[10px] sm:text-[11px] text-slate-300 font-medium whitespace-nowrap leading-tight mt-0.5">
            {selectedSummary}
          </p>
        </div>

        {/* Action Buttons (Strictly aligned with 01_Canonico) */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Salvar na Galeria with Bookmark Icon matching canonical */}
          <button
            type="button"
            onClick={onSaveToGallery}
            disabled={saveDisabled}
            title={saveDisabled ? saveDisabledReason || disabledReason : undefined}
            className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-purple-600/35 transition-all active:scale-95 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Bookmark size={15} className="shrink-0" />
            <span className="hidden sm:inline">{copy.ui14}</span>
            <span className="sm:hidden">{copy.ui15}</span>
          </button>

          {/* Baixar ZIP with Download Icon */}
          <button
            type="button"
            onClick={onDownloadZip}
            disabled={actionsDisabled}
            title={actionsDisabled ? disabledReason : undefined}
            className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-[#201D2E] hover:bg-[#2A273D] border border-white/10 text-white font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all active:scale-95 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={15} className="shrink-0" />
            <span className="hidden sm:inline">{copy.ui43}</span>
            <span className="sm:hidden">ZIP</span>
          </button>

          {/* Dismiss / Clear Selection */}
          <button
            type="button"
            onClick={onClearSelection}
            title={copy.clearSelection}
            className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 ml-0.5"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};
