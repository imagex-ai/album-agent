import React, { useState, useEffect } from 'react';
import { X, FolderPlus, Edit3, ArrowRight, Folder } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import {
  getModalAnimationClass,
  getSpeedClass,
  getDistanceClass
} from '../../services/motionConfig';
import { IconBadge } from './IconBadge';
import { ModalPortal } from './ModalPortal';

export const FolderModal: React.FC = () => {
  const {
    activeFolderModal,
    setActiveFolderModal,
    videoFolders,
    createVideoFolder,
    renameVideoFolder,
    moveVideo,
    batchMoveVideos,
    settings
  } = useAppStore();
  const isEn = settings?.language === 'en-US';

  const t = translations[settings.language]?.folderModal || translations['en-US'].folderModal;

  const [inputVal, setInputVal] = useState<string>('');
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!activeFolderModal) return;
    if (activeFolderModal.type === 'rename') {
      setInputVal(activeFolderModal.folderName || '');
    } else if (activeFolderModal.type === 'create') {
      setInputVal('');
    } else if (activeFolderModal.type === 'move') {
      setSelectedFolder(videoFolders[0]?.name || (isEn ? 'General' : 'Geral'));
    }
  }, [activeFolderModal, videoFolders]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeFolderModal) {
        e.preventDefault();
        setActiveFolderModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFolderModal, setActiveFolderModal]);

  if (!activeFolderModal) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (activeFolderModal.type === 'create') {
        if (inputVal.trim()) {
          await createVideoFolder(inputVal.trim());
          setActiveFolderModal(null);
        }
      } else if (activeFolderModal.type === 'rename') {
        if (inputVal.trim() && activeFolderModal.folderName) {
          await renameVideoFolder(activeFolderModal.folderName, inputVal.trim());
          setActiveFolderModal(null);
        }
      } else if (activeFolderModal.type === 'move') {
        if (activeFolderModal.videoIds && activeFolderModal.videoIds.length > 0 && selectedFolder) {
          await batchMoveVideos(activeFolderModal.videoIds, selectedFolder);
          setActiveFolderModal(null);
        } else if (activeFolderModal.videoId && selectedFolder) {
          await moveVideo(activeFolderModal.videoId, selectedFolder);
          setActiveFolderModal(null);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTitle = () => {
    if (activeFolderModal.type === 'create') return t.createTitle || (isEn ? 'Create New Video Folder' : 'Criar Nova Pasta de Vídeos');
    if (activeFolderModal.type === 'rename') return (t.renameTitle || 'Renomear Pasta "{folder}"').replace('{folder}', activeFolderModal.folderName || '');
    if (activeFolderModal.videoIds && activeFolderModal.videoIds.length > 1) {
      return (t.moveBatchTitle || (isEn ? 'Move {count} Selected Videos' : 'Mover {count} Vídeos Selecionados')).replace('{count}', String(activeFolderModal.videoIds.length));
    }
    return t.moveSingleTitle || (isEn ? 'Move Video to Another Folder' : 'Mover Vídeo para Outra Pasta');
  };

  const getBadge = () => {
    if (activeFolderModal.type === 'create') {
      return <IconBadge icon={<FolderPlus size={18} />} variant="neon" size="md" />;
    }
    if (activeFolderModal.type === 'rename') {
      return <IconBadge icon={<Edit3 size={18} />} variant="gold" size="md" />;
    }
    return <IconBadge icon={<ArrowRight size={18} />} variant="rose" size="md" />;
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) setActiveFolderModal(null);
        }}
      >
      <div className={`bg-slate-900 border border-border rounded-3xl w-full max-w-md p-5 sm:p-6 shadow-2xl relative ${getModalAnimationClass(settings.modalAnimation || 'scale', settings.disableAllAnimations)} ${getSpeedClass(settings.animationSpeed || 'normal')} ${getDistanceClass(settings.animationDistance || 'normal')}`}>
        <button
          onClick={() => setActiveFolderModal(null)}
          className="absolute top-4 right-4 p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          {getBadge()}
          <div>
            <h3 className="font-bold text-base text-slate-100">{getTitle()}</h3>
            <p className="text-xs text-slate-400">{t.storageLocation || 'Armazenamento em data/videos/'}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {activeFolderModal.type === 'move' ? (
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                {t.selectDestination || 'Selecione a pasta de destino:'}
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {videoFolders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFolder(f.name)}
                    className={`w-full p-3 rounded-xl border flex items-center justify-between text-left text-xs transition-all ${
                      selectedFolder === f.name
                        ? 'bg-brand-600/20 border-brand-500 text-white font-bold'
                        : 'bg-surface/50 border-border text-slate-300 hover:bg-surface-hover'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Folder size={15} className={selectedFolder === f.name ? 'text-brand-400' : 'text-slate-400'} />
                      <span>{f.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      {(t.videosCount || (isEn ? '{count} videos' : '{count} vídeos')).replace('{count}', String(f.videoCount || 0))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-2">
                {t.folderNameLabel || 'Nome da Pasta:'}
              </label>
              <input
                type="text"
                autoFocus
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder={t.folderNamePlaceholder || 'Ex: Clipes 4K, Viagens, Favoritos...'}
                className="w-full bg-surface px-4 py-2.5 rounded-xl border border-border focus:border-brand-500 outline-none text-sm text-slate-100 placeholder-slate-500"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveFolderModal(null)}
              className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-slate-300 text-xs font-semibold transition-colors"
            >
              {t.cancel || 'Cancelar'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (activeFolderModal.type !== 'move' && !inputVal.trim())}
              className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-glow-brand"
            >
              {isSubmitting ? (t.processing || (isEn ? 'Processing...' : 'Processando...')) : activeFolderModal.type === 'move' ? (t.moveVideo || (isEn ? 'Move Video' : 'Mover Vídeo')) : (t.saveFolder || (isEn ? 'Save Folder' : 'Salvar Pasta'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  </ModalPortal>
);
};
