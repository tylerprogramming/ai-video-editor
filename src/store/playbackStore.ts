import { create } from 'zustand'

interface PlaybackState {
  currentTime: number
  playing: boolean
  pixelsPerSecond: number  // zoom level
  scrollLeft: number

  setCurrentTime: (t: number) => void
  setPlaying: (v: boolean) => void
  setZoom: (pps: number) => void
  setScrollLeft: (x: number) => void
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTime: 0,
  playing: false,
  pixelsPerSecond: 80,
  scrollLeft: 0,

  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (v) => set({ playing: v }),
  setZoom: (pps) => set({ pixelsPerSecond: Math.max(20, Math.min(pps, 400)) }),
  setScrollLeft: (x) => set({ scrollLeft: x }),
}))
