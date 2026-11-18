import React, { useState, useEffect } from 'react';
import { X, Image as ImageIcon, Download, LayoutGrid, Check } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const ContactSheetModal: React.FC = () => {
  const { contactSheetOpen, setContactSheetOpen, albums, activeAlbumId, settings } = useAppStore();
  const [layout, setLayout] = useState<'2x2' | '3x3' | 'polaroid'>('3x3');
  const [showMetadata, setShowMetadata] = useState(true);

  // Close on Escape key
  useEffect(() => {
    if (!contactSheetOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContactSheetOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contactSheetOpen, setContactSheetOpen]);

  const album = albums.find(a => a.id === activeAlbumId) || albums[0];
  if (!contactSheetOpen || !album) return null;

  const images = (album.images || []).slice(0, layout === '2x2' ? 4 : layout === '3x3' ? 9 : 6);

  const handleDownloadSheet = () => {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`
        <html>
          <head>
            <title>Contact Sheet - ${album.title}</title>
            <style>
              body { font-family: sans-serif; padding: 20px; color: #111; }
              h1 { font-size: 1.5rem; margin-bottom: 5px; }
              p { margin-top: 0; color: #666; font-size: 0.8rem; margin-bottom: 20px; }
              .grid { display: grid; gap: 10px; grid-template-columns: repeat(${layout === '2x2' ? 2 : 3}, 1fr); }
              .img-container { background: #f4f4f5; padding: 10px; border-radius: 8px; text-align: center; ${layout === 'polaroid' ? 'box-shadow: 0 4px 6px rgba(0,0,0,0.1); padding-bottom: 20px;' : ''} }
              img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; }
              .meta { display: block; font-size: 0.7rem; color: #555; margin-top: 5px; }
            </style>
          </head>
          <body>
            <h1>${album.title}</h1>
            <p>IMAGEX MASTER SHEET &bull; ${new Date().toLocaleDateString()} &bull; ${album.resolvedOriginalCount} Original ASSETS</p>
            <div class="grid">
              ${images.map((img, idx) => `
                <div class="img-container">
                  <img src="${img.thumbnailUrl}" />
                  ${showMetadata ? `<span class="meta">#${idx + 1} &bull; ${img.width}x${img.height}</span>` : ''}
                </div>
              `).join('')}
            </div>
            <script>
              window.onload = () => window.print();
            </script>
          </body>
        </html>
      `);
      w.document.close();
    }
  };

  return (
    <div
      onClick={() => setContactSheetOpen(false)}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 select-none animate-fade-in"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-border shadow-2xl rounded-3xl w-full max-w-4xl max-h-[92dvh] overflow-hidden flex flex-col"
      >
        {/* Modal Header */}
        <div className="p-3.5 sm:p-4 border-b border-border flex items-center justify-between shrink-0 bg-surface-elevated/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <LayoutGrid size={18} className="text-brand-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-xs sm:text-sm text-slate-100 truncate">
                Gerador de Folha de Contato (Contact Sheet)
              </h3>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                {settings.language === "en-US" ? "Create photographic contact sheets and high-resolution catalogs" : "Monte montagens fotográficas e catálogos em alta resolução"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setContactSheetOpen(false)}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body: Top-aligned Scrollable Canvas & Controls */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Visual Contact Sheet Canvas (Fixed: Top-aligned and smooth touch-scrolling) */}
          <div className="flex-1 bg-zinc-950 p-3 sm:p-6 overflow-y-auto flex items-start justify-center touch-scroll">
            <div className="bg-white text-zinc-900 p-4 sm:p-6 rounded-2xl shadow-2xl max-w-lg w-full my-auto sm:my-2">
              {/* Header Title */}
              <div className="border-b-2 border-zinc-900 pb-2 mb-3 sm:mb-4 flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <h4 className="font-black text-xs sm:text-sm tracking-wider uppercase truncate">
                    {album.title}
                  </h4>
                  <p className="text-[9px] text-zinc-600 font-mono truncate">
                    IMAGEX MASTER SHEET • {new Date().toLocaleDateString()} • {album.resolvedOriginalCount} Original ASSETS
                  </p>
                </div>
                <span className="text-[9px] sm:text-[10px] font-black font-mono px-2 py-0.5 border border-zinc-900 shrink-0">
                  {settings.language === "en-US" ? "Original Resolution" : "Resolução Original"}
                </span>
              </div>

              {/* Grid of Photos */}
              <div
                className={`grid gap-2 ${
                  layout === '2x2' ? 'grid-cols-2' : layout === '3x3' ? 'grid-cols-3' : 'grid-cols-3'
                }`}
              >
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className={`bg-zinc-100 p-1 flex flex-col items-center rounded ${
                      layout === 'polaroid' ? 'shadow-md pb-2.5' : ''
                    }`}
                  >
                    <img
                      src={img.thumbnailUrl}
                      alt={img.title}
                      className="w-full h-20 sm:h-24 object-cover rounded"
                    />
                    {showMetadata && (
                      <span className="text-[8px] font-mono text-zinc-600 mt-1 truncate max-w-full text-center">
                        #{idx + 1} • {img.width}x{img.height}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="w-full md:w-64 border-t md:border-t-0 md:border-l border-border p-3 sm:p-4 bg-surface-elevated/60 space-y-3.5 text-xs shrink-0">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                {settings.language === "en-US" ? "Page Layout Grid" : "Layout de Diagramação"}
              </label>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                <button
                  onClick={() => setLayout('2x2')}
                  className={`py-2 rounded-xl border font-bold transition-all ${
                    layout === '2x2'
                      ? 'bg-brand-500/20 border-brand-500 text-brand-400 shadow-glow-brand'
                      : 'bg-surface border-border text-slate-400'
                  }`}
                >
                  2x2
                </button>
                <button
                  onClick={() => setLayout('3x3')}
                  className={`py-2 rounded-xl border font-bold transition-all ${
                    layout === '3x3'
                      ? 'bg-brand-500/20 border-brand-500 text-brand-400 shadow-glow-brand'
                      : 'bg-surface border-border text-slate-400'
                  }`}
                >
                  3x3
                </button>
                <button
                  onClick={() => setLayout('polaroid')}
                  className={`py-2 rounded-xl border font-bold transition-all ${
                    layout === 'polaroid'
                      ? 'bg-brand-500/20 border-brand-500 text-brand-400 shadow-glow-brand'
                      : 'bg-surface border-border text-slate-400'
                  }`}
                >
                  Polaroid
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-300 font-medium">Exibir Metadados</span>
              <input
                type="checkbox"
                checked={showMetadata}
                onChange={e => setShowMetadata(e.target.checked)}
                className="rounded text-brand-500 w-4 h-4"
              />
            </div>

            <button
              onClick={handleDownloadSheet}
              className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-glow-brand transition-all active:scale-98"
            >
              <Download size={14} />
              <span>Exportar Folha Original</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
