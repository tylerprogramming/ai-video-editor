import { create } from 'zustand'
import type { TranscriptSegment, TranscriptWord } from '../types/ipc.types'

export interface SilenceGap {
  key: string          // unique key e.g. "gap-0"
  afterSegIdx: number  // index of segment before this gap (-1 = before first seg)
  start: number        // clip time start (seconds)
  end: number          // clip time end (seconds)
  duration: number     // seconds
}

export interface DuplicateGroup {
  groupId: number
  reason: string
  bestSegmentId: number
  removeSegmentIds: number[]
}

// Find which segment index (0-based) ends at or before time t.
function segIdxBefore(t: number, segments: TranscriptSegment[]): number {
  let result = -1
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].end <= t + 0.001) result = i
  }
  return result
}

// Ground-truth silence detection from waveform amplitude data.
// Much more accurate than Whisper timestamps.
function computeGapsFromWaveform(
  waveformData: number[],
  clipDuration: number,
  segments: TranscriptSegment[],
  durationThreshold: number,
  amplitudeThreshold: number,
): SilenceGap[] {
  const gaps: SilenceGap[] = []
  let idx = 0
  const n = waveformData.length
  let silenceStart: number | null = null

  for (let i = 0; i <= n; i++) {
    const t = (i / n) * clipDuration
    const amp = i < n ? waveformData[i] : 1 // sentinel to flush trailing silence

    if (amp < amplitudeThreshold) {
      if (silenceStart === null) silenceStart = t
    } else {
      if (silenceStart !== null) {
        const duration = t - silenceStart
        if (duration >= durationThreshold) {
          gaps.push({
            key: `gap-${idx++}`,
            afterSegIdx: segIdxBefore(silenceStart, segments),
            start: silenceStart,
            end: t,
            duration,
          })
        }
        silenceStart = null
      }
    }
  }

  return gaps
}

// Fallback: segment-level gap detection (used when no waveform is available).
function computeGapsFromSegments(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
  durationThreshold: number,
): SilenceGap[] {
  const gaps: SilenceGap[] = []
  let idx = 0
  const src = words.length > 0 ? words : segments

  if (src.length > 0 && src[0].start > durationThreshold) {
    gaps.push({ key: `gap-${idx++}`, afterSegIdx: -1, start: 0, end: src[0].start, duration: src[0].start })
  }
  for (let i = 0; i < src.length - 1; i++) {
    const gap = src[i + 1].start - src[i].end
    if (gap > durationThreshold) {
      const afterIdx = words.length > 0 ? segIdxBefore(src[i].end, segments) : i
      gaps.push({ key: `gap-${idx++}`, afterSegIdx: afterIdx, start: src[i].end, end: src[i + 1].start, duration: gap })
    }
  }
  return gaps
}

interface TranscriptState {
  clipId: string
  segments: TranscriptSegment[]
  words: TranscriptWord[]
  waveformData: number[]
  clipDuration: number
  savedAt: number | null
  silenceThreshold: number
  amplitudeThreshold: number
  silenceGaps: SilenceGap[]
  duplicateGroups: DuplicateGroup[]
  removals: Record<string, boolean>
  apiKey: string
  transcriptStatus: 'idle' | 'transcribing' | 'done' | 'error'
  analyzeStatus: 'idle' | 'analyzing' | 'done' | 'error'
  error: string | null
  transcriptIsTimelineBased: boolean

  setTranscript: (clipId: string, segments: TranscriptSegment[], savedAt?: number, words?: TranscriptWord[]) => void
  setWaveformData: (data: number[], duration: number) => void
  setSilenceThreshold: (t: number) => void
  setAmplitudeThreshold: (t: number) => void
  recomputeGaps: () => void
  setDuplicateGroups: (groups: DuplicateGroup[]) => void
  toggleRemoval: (key: string) => void
  setAllSilences: (selected: boolean) => void
  setApiKey: (key: string) => void
  setSavedAt: (t: number) => void
  setTranscriptStatus: (s: TranscriptState['transcriptStatus']) => void
  setAnalyzeStatus: (s: TranscriptState['analyzeStatus']) => void
  setError: (e: string | null) => void
  setTranscriptIsTimelineBased: (v: boolean) => void
  clearSilenceGaps: () => void
  reset: () => void
}

function computeGaps(state: Pick<TranscriptState, 'segments' | 'words' | 'waveformData' | 'clipDuration' | 'silenceThreshold' | 'amplitudeThreshold'>): SilenceGap[] {
  const { segments, words, waveformData, clipDuration, silenceThreshold, amplitudeThreshold } = state
  if (waveformData.length > 0 && clipDuration > 0) {
    return computeGapsFromWaveform(waveformData, clipDuration, segments, silenceThreshold, amplitudeThreshold)
  }
  return computeGapsFromSegments(segments, words, silenceThreshold)
}

export const useTranscriptStore = create<TranscriptState>((set, get) => ({
  clipId: '',
  segments: [],
  words: [],
  waveformData: [],
  clipDuration: 0,
  savedAt: null,
  silenceThreshold: 0.5,
  amplitudeThreshold: 0.02,
  silenceGaps: [],
  duplicateGroups: [],
  removals: {},
  apiKey: localStorage.getItem('openai-api-key') ?? '',
  transcriptStatus: 'idle',
  analyzeStatus: 'idle',
  error: null,
  transcriptIsTimelineBased: false,

  setTranscript: (clipId, segments, savedAt, words = []) => {
    const state = get()
    const gaps = computeGaps({ segments, words, waveformData: state.waveformData, clipDuration: state.clipDuration, silenceThreshold: state.silenceThreshold, amplitudeThreshold: state.amplitudeThreshold })
    const removals: Record<string, boolean> = {}
    gaps.forEach(g => { removals[g.key] = true })
    set({ clipId, segments, words, savedAt: savedAt ?? null, silenceGaps: gaps, removals, duplicateGroups: [] })
  },

  setWaveformData: (data, duration) => {
    const state = get()
    const gaps = computeGaps({ ...state, waveformData: data, clipDuration: duration })
    const removals: Record<string, boolean> = {}
    // Preserve any non-gap removals (dup keys), rebuild gap keys
    Object.entries(state.removals).forEach(([k, v]) => {
      if (!k.startsWith('gap-')) removals[k] = v
    })
    gaps.forEach(g => { removals[g.key] = true })
    set({ waveformData: data, clipDuration: duration, silenceGaps: gaps, removals })
  },

  setSilenceThreshold: (t) => {
    const state = get()
    const gaps = computeGaps({ ...state, silenceThreshold: t })
    const removals = { ...state.removals }
    state.silenceGaps.forEach(g => { delete removals[g.key] })
    gaps.forEach(g => { removals[g.key] = true })
    set({ silenceThreshold: t, silenceGaps: gaps, removals })
  },

  setAmplitudeThreshold: (t) => {
    const state = get()
    const gaps = state.waveformData.length > 0 && state.clipDuration > 0
      ? computeGapsFromWaveform(state.waveformData, state.clipDuration, state.segments, state.silenceThreshold, t)
      : computeGapsFromSegments(state.segments, state.words, state.silenceThreshold)
    const removals = { ...state.removals }
    state.silenceGaps.forEach(g => { delete removals[g.key] })
    gaps.forEach(g => { removals[g.key] = true })
    set({ amplitudeThreshold: t, silenceGaps: gaps, removals })
  },

  recomputeGaps: () => {
    const state = get()
    set({ silenceGaps: computeGaps(state) })
  },

  clearSilenceGaps: () => {
    const state = get()
    const removals = { ...state.removals }
    state.silenceGaps.forEach(g => { delete removals[g.key] })
    set({ silenceGaps: [], removals })
  },

  setDuplicateGroups: (groups) => {
    const removals = { ...get().removals }
    groups.forEach(g => {
      g.removeSegmentIds.forEach(id => { removals[`dup-${id}`] = true })
    })
    set({ duplicateGroups: groups, removals })
  },

  toggleRemoval: (key) =>
    set(s => ({ removals: { ...s.removals, [key]: !s.removals[key] } })),

  setAllSilences: (selected) => {
    const removals = { ...get().removals }
    get().silenceGaps.forEach(g => { removals[g.key] = selected })
    set({ removals })
  },

  setApiKey: (key) => {
    localStorage.setItem('openai-api-key', key)
    set({ apiKey: key })
  },

  setSavedAt: (t) => set({ savedAt: t }),
  setTranscriptStatus: (s) => set({ transcriptStatus: s }),
  setAnalyzeStatus: (s) => set({ analyzeStatus: s }),
  setError: (e) => set({ error: e }),
  setTranscriptIsTimelineBased: (v) => set({ transcriptIsTimelineBased: v }),

  reset: () => set({
    segments: [], words: [], waveformData: [], clipDuration: 0, savedAt: null,
    silenceGaps: [], duplicateGroups: [], removals: {},
    transcriptStatus: 'idle', analyzeStatus: 'idle', error: null,
    transcriptIsTimelineBased: false,
  }),
}))
