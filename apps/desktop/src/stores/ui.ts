import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type SidebarSection = 'collections' | 'flows' | 'apis' | 'environments' | 'history';

interface UiState {
  theme: Theme;
  sidebar: SidebarSection;
  smartPanel: boolean;
  revealSecrets: boolean;
  envManagerOpen: boolean;
  envManagerSelected: string | null;
  searchOpen: boolean;
  setTheme: (t: Theme) => void;
  setSidebar: (s: SidebarSection) => void;
  toggleSmartPanel: () => void;
  setRevealSecrets: (v: boolean) => void;
  openEnvManager: (id?: string | null) => void;
  closeEnvManager: () => void;
  setSearchOpen: (v: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebar: 'collections',
      smartPanel: false,
      revealSecrets: false,
      envManagerOpen: false,
      envManagerSelected: null,
      searchOpen: false,
      setTheme: (theme) => set({ theme }),
      setSidebar: (sidebar) => set({ sidebar }),
      toggleSmartPanel: () => set((s) => ({ smartPanel: !s.smartPanel })),
      setRevealSecrets: (revealSecrets) => set({ revealSecrets }),
      openEnvManager: (id = null) => set({ envManagerOpen: true, envManagerSelected: id }),
      closeEnvManager: () => set({ envManagerOpen: false }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
    }),
    {
      name: 'postguy.ui',
      partialize: (s) => ({ theme: s.theme, sidebar: s.sidebar, smartPanel: s.smartPanel }),
    },
  ),
);
