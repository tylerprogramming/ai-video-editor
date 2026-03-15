import type { MediaClip } from './project.types'

export interface ImportMediaResult {
  clip: MediaClip
}

export interface ProbeResult {
  duration: number
  width: number
  height: number
  fps: number
}

export interface WaveformResult {
  data: number[]   // Float32Array serialized to number[]
}

export interface TranscriptSegment {
  id: number
  start: number
  end: number
  text: string
}

export interface TranscriptWord {
  word: string
  start: number
  end: number
}

export interface TranscriptResult {
  task: string
  language: string
  duration: number
  text: string
  segments: TranscriptSegment[]
  words?: TranscriptWord[]
}

export interface SavedTranscript {
  clipId: string
  clipName: string
  savedAt: number
  language: string
  duration: number
  segments: TranscriptSegment[]
  words?: TranscriptWord[]
}

export interface ElectronAPI {
  importMedia: () => Promise<ImportMediaResult | null>
  getWaveform: (clipId: string, filePath: string) => Promise<WaveformResult | null>
  transcribeClip: (clipId: string, filePath: string, apiKey: string) => Promise<TranscriptResult>
  transcribeTimeline: (clipId: string, filePath: string, keepRanges: { start: number; end: number }[], apiKey: string) => Promise<TranscriptResult>
  saveTranscript: (clipId: string, data: SavedTranscript) => Promise<{ path: string }>
  loadTranscript: (clipId: string) => Promise<SavedTranscript | null>
  saveEditedTranscript: (clipId: string, data: SavedTranscript) => Promise<{ path: string }>
  onMenuImport: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
