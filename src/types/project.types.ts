export interface MediaClip {
  id: string
  originalPath: string
  name: string
  duration: number
  width: number
  height: number
  fps: number
  thumbnailPath: string
  waveformData: number[] | null  // serialized Float32Array
}

export interface TimelineSegment {
  id: string
  clipId: string
  trackId: string
  startTime: number     // position on timeline (seconds)
  duration: number
  clipOffset: number    // where in source clip this starts
  transition?: { type: string; duration: number }
}

export interface Track {
  id: string
  name: string
  type: 'video' | 'audio'
  segments: TimelineSegment[]
  muted: boolean
  locked: boolean
}

export interface Project {
  id: string
  name: string
  clips: MediaClip[]
  tracks: Track[]
  duration: number
  resolution: { width: number; height: number }
  fps: number
}
