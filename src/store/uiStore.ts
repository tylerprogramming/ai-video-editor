import { create } from 'zustand'

type ActivePanel = 'properties' | 'effects' | null

interface UIState {
  activePanel: ActivePanel
  draggingClipId: string | null
  setActivePanel: (panel: ActivePanel) => void
  setDraggingClip: (clipId: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  activePanel: 'properties',
  draggingClipId: null,
  setActivePanel: (panel) => set({ activePanel: panel }),
  setDraggingClip: (clipId) => set({ draggingClipId: clipId }),
}))
