import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MediaClip, Track, TimelineSegment, Project } from '../types/project.types'

interface ProjectState {
  project: Project
  selectedSegmentId: string | null

  addClip: (clip: MediaClip) => void
  updateClipWaveform: (clipId: string, waveformData: number[]) => void
  addSegmentToTrack: (trackId: string, segment: TimelineSegment) => void
  selectSegment: (id: string | null) => void
  getClipById: (clipId: string) => MediaClip | undefined
  getSelectedSegment: () => TimelineSegment | undefined
  updateProjectDuration: () => void
  applyTranscriptEdits: (clipId: string, removeRanges: { start: number; end: number }[]) => void
  splitSegment: (segmentId: string, timelineTime: number) => void
  rippleCompact: () => void
  deleteSegment: (segmentId: string) => void
  resetClipToOriginal: (clipId: string) => void
}

const defaultVideoTrack: Track = {
  id: 'track-video-1',
  name: 'Video 1',
  type: 'video',
  segments: [],
  muted: false,
  locked: false,
}

const defaultAudioTrack: Track = {
  id: 'track-audio-1',
  name: 'Audio 1',
  type: 'audio',
  segments: [],
  muted: false,
  locked: false,
}

const defaultProject: Project = {
  id: 'project-1',
  name: 'Untitled Project',
  clips: [],
  tracks: [defaultVideoTrack, defaultAudioTrack],
  duration: 60,
  resolution: { width: 1920, height: 1080 },
  fps: 30,
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
  project: defaultProject,
  selectedSegmentId: null,

  addClip: (clip) =>
    set((state) => ({
      project: { ...state.project, clips: [...state.project.clips, clip] },
    })),

  updateClipWaveform: (clipId, waveformData) =>
    set((state) => ({
      project: {
        ...state.project,
        clips: state.project.clips.map((c) =>
          c.id === clipId ? { ...c, waveformData } : c
        ),
      },
    })),

  addSegmentToTrack: (trackId, segment) =>
    set((state) => {
      const tracks = state.project.tracks.map((t) =>
        t.id === trackId ? { ...t, segments: [...t.segments, segment] } : t
      )
      return { project: { ...state.project, tracks } }
    }),

  selectSegment: (id) => set({ selectedSegmentId: id }),

  getClipById: (clipId) => get().project.clips.find((c) => c.id === clipId),

  getSelectedSegment: () => {
    const { project, selectedSegmentId } = get()
    if (!selectedSegmentId) return undefined
    for (const track of project.tracks) {
      const seg = track.segments.find((s) => s.id === selectedSegmentId)
      if (seg) return seg
    }
    return undefined
  },

  updateProjectDuration: () =>
    set((state) => {
      let maxEnd = 60
      for (const track of state.project.tracks) {
        for (const seg of track.segments) {
          maxEnd = Math.max(maxEnd, seg.startTime + seg.duration)
        }
      }
      return { project: { ...state.project, duration: maxEnd + 10 } }
    }),

  applyTranscriptEdits: (clipId, removeRanges) =>
    set((state) => {
      if (removeRanges.length === 0) return state

      // Sort and merge overlapping ranges
      const sorted = [...removeRanges].sort((a, b) => a.start - b.start)
      const merged: { start: number; end: number }[] = []
      for (const r of sorted) {
        if (merged.length && r.start <= merged[merged.length - 1].end) {
          merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end)
        } else {
          merged.push({ ...r })
        }
      }

      const tracks = state.project.tracks.map((track) => {
        const clipSegs = track.segments.filter((s) => s.clipId === clipId)
        const otherSegs = track.segments.filter((s) => s.clipId !== clipId)
        if (clipSegs.length === 0) return track

        const newSegs: typeof track.segments = []

        for (const seg of clipSegs) {
          const clipEnd = seg.clipOffset + seg.duration
          const keepRanges: { clipStart: number; clipEnd: number }[] = []
          let pos = seg.clipOffset

          for (const rm of merged) {
            if (rm.end <= seg.clipOffset || rm.start >= clipEnd) continue
            const rmStart = Math.max(rm.start, seg.clipOffset)
            const rmEnd = Math.min(rm.end, clipEnd)
            if (pos < rmStart) keepRanges.push({ clipStart: pos, clipEnd: rmStart })
            pos = rmEnd
          }
          if (pos < clipEnd) keepRanges.push({ clipStart: pos, clipEnd })

          let cumulative = 0
          for (const kr of keepRanges) {
            newSegs.push({
              id: `seg-${Math.random().toString(36).slice(2, 9)}`,
              clipId,
              trackId: track.id,
              startTime: seg.startTime + cumulative,
              duration: kr.clipEnd - kr.clipStart,
              clipOffset: kr.clipStart,
            })
            cumulative += kr.clipEnd - kr.clipStart
          }
        }

        return { ...track, segments: [...otherSegs, ...newSegs] }
      })

      return { project: { ...state.project, tracks } }
    }),

  splitSegment: (segmentId, timelineTime) =>
    set((state) => {
      const tracks = state.project.tracks.map((track) => {
        const segIdx = track.segments.findIndex((s) => s.id === segmentId)
        if (segIdx === -1) return track
        const seg = track.segments[segIdx]
        // timelineTime must be strictly inside the segment
        if (timelineTime <= seg.startTime + 0.033 || timelineTime >= seg.startTime + seg.duration - 0.033) return track
        const splitOffset = timelineTime - seg.startTime
        const seg1: TimelineSegment = {
          ...seg,
          id: `seg-${Math.random().toString(36).slice(2, 9)}`,
          duration: splitOffset,
        }
        const seg2: TimelineSegment = {
          ...seg,
          id: `seg-${Math.random().toString(36).slice(2, 9)}`,
          startTime: timelineTime,
          clipOffset: seg.clipOffset + splitOffset,
          duration: seg.duration - splitOffset,
        }
        const newSegments = [...track.segments]
        newSegments.splice(segIdx, 1, seg1, seg2)
        return { ...track, segments: newSegments }
      })
      return { project: { ...state.project, tracks } }
    }),

  rippleCompact: () =>
    set((state) => {
      const tracks = state.project.tracks.map((track) => {
        const sorted = [...track.segments].sort((a, b) => a.startTime - b.startTime)
        let cursor = 0
        const compacted = sorted.map((seg) => {
          const s = { ...seg, startTime: cursor }
          cursor += seg.duration
          return s
        })
        return { ...track, segments: compacted }
      })
      return { project: { ...state.project, tracks } }
    }),

  deleteSegment: (segmentId) =>
    set((state) => {
      const tracks = state.project.tracks.map((track) => ({
        ...track,
        segments: track.segments.filter((s) => s.id !== segmentId),
      }))
      return { project: { ...state.project, tracks } }
    }),

  resetClipToOriginal: (clipId) =>
    set((state) => {
      const clip = state.project.clips.find((c) => c.id === clipId)
      if (!clip) return state
      // Find the earliest startTime currently used by this clip's segments
      const clipSegs = state.project.tracks.flatMap((t) => t.segments).filter((s) => s.clipId === clipId)
      const earliestStart = clipSegs.length > 0 ? Math.min(...clipSegs.map((s) => s.startTime)) : 0
      const tracks = state.project.tracks.map((track) => {
        const otherSegs = track.segments.filter((s) => s.clipId !== clipId)
        if (track.type !== 'video') return { ...track, segments: otherSegs }
        const restored: TimelineSegment = {
          id: `seg-${Math.random().toString(36).slice(2, 9)}`,
          clipId,
          trackId: track.id,
          startTime: earliestStart,
          duration: clip.duration,
          clipOffset: 0,
        }
        return { ...track, segments: [...otherSegs, restored] }
      })
      return { project: { ...state.project, tracks } }
    }),
    }),
    { name: 'ai-video-editor-project', partialize: (s) => ({ project: s.project }) }
  )
)
