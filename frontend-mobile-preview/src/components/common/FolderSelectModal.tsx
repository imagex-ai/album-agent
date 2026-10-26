import React, { useState } from 'react';
import { Folder, FolderPlus, Check, X, HardDrive } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { translations } from '../../i18n/translations';
import { IconBadge } from './IconBadge';
import { ModalPortal } from './ModalPortal';

interface FolderSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFolder?: (folderName: string, rememberAsDefault: boolean) => void;
  onConfirm?: (folderName: string, rememberAsDefault?: boolean) => void;
  existingFolders: string[];
  currentFolder?: string;
  defaultFolder?: string;
  title?: string;
  subtitle?: string;
  itemTitle?: string;
  mediaType?: 'video' | 'album' | string;
  type?: string;
}

export const FolderSelectModal: React.FC<FolderSelectModalProps> = ({
  isOpen,
  onClose,
  onSelectFolder,
  onConfirm,
  existingFolders,
  currentFolder,
  defaultFolder,
  title,
  subtitle,
  itemTitle,
  mediaType,
  type
}) => {
  const { settings, albumFolders, videoFolders, createAlbumFolder, createVideoFolder, updateSettings } = useAppStore();
  const t = translations[settings.language]?.folderModal || translations['en-US'].folderModal;
  const tCommon = translations[settings.language]?.common || translations['en-US'].common;

  const modalTitle = title || t.defaultTitle;
  const initialMediaType = (mediaType || type || 'album') as 'video' | 'album';
  const defaultFallbackFolder = initialMediaType === 'video' ? (tCommon.defaultVideoFolder || 'Extracted') : (tCommon.defaultAlbumFolder || 'General');
  const initialFolder = currentFolder || defaultFolder || defaultFallbackFolder;
  const [selectedFolder, setSelectedFolder] = useState<string>(initialFolder);
  const [newFolderName, setNewFolderName] = useState('');
  const [createdFolders, setCreatedFolders] = useState<string[]>([]);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [rememberDefault, setRememberDefault] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setSelectedFolder(currentFolder || defaultFolder || defaultFallbackFolder);
      setIsCreatingNew(false);
      setNewFolderName('');
    }
  }, [isOpen, currentFolder, defaultFolder, defaultFallbackFolder]);

  if (!isOpen) return null;

  // Clean and deduplicate folders list including pre-suggested/current folder, store folders, and newly created folders
  const storeFolders = (initialMediaType === 'video' ? (videoFolders || []) : (albumFolders || [])).map(f => f.name);
  const folders = Array.from(new Set([
    ...(currentFolder ? [currentFolder.trim()] : []),
    ...(defaultFolder ? [defaultFolder.trim()] : []),
    defaultFallbackFolder,
    ...(existingFolders || []).filter(Boolean),
    ...storeFolders.filter(Boolean),
    ...createdFolders.filter(Boolean)
  ])).filter(Boolean);

  const handleConfirm = async () => {
    let finalFolder = selectedFolder.trim();
    if (isCreatingNew && newFolderName.trim()) {
      finalFolder = newFolderName.trim();
      setCreatedFolders(prev => Array.from(new Set([...prev, finalFolder])));
      try {
        if (initialMediaType === 'video') {
          await createVideoFolder(finalFolder);
        } else {
          await createAlbumFolder(finalFolder);
        }
      } catch (err) {
        console.warn('Erro ao criar pasta:', err);
      }
    }
    if (!finalFolder) {
      finalFolder = defaultFallbackFolder;
    }
    if (rememberDefault && finalFolder) {
      if (initialMediaType === 'video') {
        updateSettings({ defaultVideoFolder: finalFolder });
      } else {
        updateSettings({ defaultAlbumFolder: finalFolder });
      }
    }
    if (onSelectFolder) {
      onSelectFolder(finalFolder, rememberDefault);
    } else if (onConfirm) {
      onConfirm(finalFolder, rememberDefault);
    }
    onClose();
  };


  const handleCreateNewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const clean = newFolderName.trim();
    setCreatedFolders(prev => Array.from(new Set([...prev, clean])));
    setSelectedFolder(clean);
    setIsCreatingNew(false);
    setNewFolderName('');

    try {
      if (initialMediaType === 'video') {
        await createVideoFolder(clean);
      } else {
        await createAlbumFolder(clean);
      }
    } catch (err) {
      console.warn('Erro ao criar pasta no store:', err);
    }
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <IconBadge icon={<Folder size={18} />} variant={initialMediaType === 'video' ? 'rose' : 'gold'} size="md" />
            <div>
              <h3 className="text-base font-bold text-slate-100">{modalTitle}</h3>
              {itemTitle && (
                <p className="text-xs text-slate-400 truncate max-w-[280px]">
                  {itemTitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Existing Folders Grid */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">
            {t.selectExisting}
          </label>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {folders.map((folder) => {
              const isSelected = selectedFolder === folder && !isCreatingNew;
              return (
                <button
                  key={folder}
                  type="button"
                  onClick={() => {
                    setSelectedFolder(folder);
                    setIsCreatingNew(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                    isSelected
                      ? 'bg-brand-600/20 border-brand-500/60 text-brand-200 font-semibold shadow-sm'
                      : 'bg-slate-800/40 hover:bg-slate-800/80 border-slate-700/50 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Folder size={14} className={isSelected ? 'text-brand-400' : 'text-slate-400'} />
                    <span className="truncate">{folder}</span>
                  </div>
                  {isSelected && <Check size={14} className="text-brand-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Create New Folder Inline */}
        <div className="pt-1">
          {isCreatingNew ? (
            <form onSubmit={handleCreateNewSubmit} className="space-y-2">
              <label className="text-xs font-medium text-slate-300">
                {t.newFolderName}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder={t.placeholder}
                  className="flex-1 px-3 py-2 bg-slate-950 border border-brand-500/50 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-3 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors"
                >
                  {t.add}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl"
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsCreatingNew(true);
                setNewFolderName('');
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-slate-700 hover:border-brand-500/50 hover:bg-brand-500/5 text-xs text-slate-400 hover:text-brand-300 transition-all"
            >
              <FolderPlus size={14} />
              <span>{t.createNew}</span>
            </button>
          )}
        </div>

        {/* Remember Default Checkbox */}
        <div className="pt-2 border-t border-slate-800/80">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-400 hover:text-slate-300">
            <input
              type="checkbox"
              checked={rememberDefault}
              onChange={(e) => setRememberDefault(e.target.checked)}
              className="rounded border-slate-700 text-brand-500 focus:ring-brand-500 bg-slate-950"
            />
            <span>{t.rememberDefault}</span>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-lg shadow-brand-500/20 transition-colors flex items-center gap-1.5"
          >
            <Check size={14} />
            <span>{t.saveToFolder}</span>
          </button>
        </div>
      </div>
    </div>
  </ModalPortal>
);
};
