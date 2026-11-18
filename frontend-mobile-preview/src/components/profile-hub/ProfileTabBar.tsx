import { useProfileHubPresentation } from '../../services/profileHubPresentation';
import React from 'react';
import { ProfileCategoryTab } from './profileHubTypes';

interface ProfileTabBarProps {
  activeTab: ProfileCategoryTab;
  onTabChange: (tab: ProfileCategoryTab) => void;
}

export const ProfileTabBar: React.FC<ProfileTabBarProps> = ({
  activeTab,
  onTabChange
}) => {
  const { copy } = useProfileHubPresentation();
  const tabs: { id: ProfileCategoryTab; label: string }[] = [
    { id: 'destaques', label: copy.ui0 },
    { id: 'playlists', label: copy.ui3 },
    { id: 'albuns', label: copy.ui5 },
    { id: 'videos', label: copy.ui4 }
  ];

  return (
    <div className="flex items-center gap-2 mb-6 overflow-x-auto no-scrollbar py-1">
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap active:scale-95 ${
              isActive
                ? 'bg-[#7C3AED] text-white shadow-lg shadow-purple-600/30 ring-1 ring-purple-400/30'
                : 'bg-[#181624] text-slate-300 hover:bg-[#221F33] hover:text-white border border-white/5'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
