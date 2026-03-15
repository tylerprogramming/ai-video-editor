import React, { useRef, useEffect, useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { usePlaybackStore } from '../../store/playbackStore'
import type { TimelineSegment } from '../../types/project.types'

function formatTime(s: number): string {
  s = Math.max(0, s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.floor((s % 1) * 100)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

export function PreviewPanel(): React.ReactElement {
  // Two video elements for seamless segment transitions (A/B buffering).
  // While A plays, B is pre-seeked to the next segment's clipOffset.
  // At the cut point we swap: B plays instantly (already buffered), A becomes standby.
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const activeSlotRef = useRef<'a' | 'b'>('a')
  const rafRef = useRef<number>(0)
  const canvasRafRef = useRef<number>(0)
  const pendingSeekRef = useRef<number | null>(null)
  const playingRef = useRef(false)
  const targetVideoTimeRef = useRef(0)
  const activeSegmentRef = useRef<TimelineSegment | null>(null)
  const standbyPreseekDoneRef = useRef(false)

  const project = useProjectStore((s) => s.project)
  const getClipById = useProjectStore((s) => s.getClipById)

  const currentTime = usePlaybackStore((s) => s.currentTime)
  const playing = usePlaybackStore((s) => s.playing)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setPlaying = usePlaybackStore((s) => s.setPlaying)

  useEffect(() => { playingRef.current = playing }, [playing])

  const getActive = useCallback((): HTMLVideoElement | null => {
    return activeSlotRef.current === 'a' ? videoARef.current : videoBRef.current
  }, [])

  const getStandby = useCallback((): HTMLVideoElement | null => {
    return activeSlotRef.current === 'a' ? videoBRef.current : videoARef.current
  }, [])

  const activeSegment = React.useMemo(() => {
    for (const track of project.tracks) {
      if (track.type !== 'video') continue
      for (const seg of track.segments) {
        if (currentTime >= seg.startTime && currentTime < seg.startTime + seg.duration) {
          return seg
        }
      }
    }
    return null
  }, [project.tracks, currentTime])
  activeSegmentRef.current = activeSegment

  const activeClip = activeSegment ? getClipById(activeSegment.clipId) : null
  const videoSrc = activeClip
    ? `app://${encodeURIComponent(activeClip.originalPath)}`
    : undefined

  // While paused: track target video position for canvas loop to enforce
  useEffect(() => {
    if (playing) return
    const seg = activeSegmentRef.current
    if (!seg) return
    targetVideoTimeRef.current = Math.max(0, currentTime - seg.startTime + seg.clipOffset)
  }, [currentTime, playing])

  // RAF: playback loop with pre-seek dual-buffer transitions
  useEffect(() => {
    if (!playing) return
    let lastStoreUpdate = 0

    const tick = (now: number) => {
      const video = getActive()
      const seg = activeSegmentRef.current

      if (video && seg) {
        const segEnd = seg.clipOffset + seg.duration
        const timeLeft = segEnd - video.currentTime

        // Find next segment (read from store directly — no stale closure)
        const allVideoSegs = useProjectStore.getState().project.tracks
          .filter((t) => t.type === 'video')
          .flatMap((t) => t.segments)
          .sort((a, b) => a.startTime - b.startTime)
        const nextSeg = allVideoSegs.find(
          (s) => s.startTime >= seg.startTime + seg.duration - 0.05 && s.id !== seg.id
        )

        // Pre-seek standby 300ms before the cut so it's buffered and ready
        if (nextSeg && timeLeft <= 0.3 && timeLeft > 0 && !standbyPreseekDoneRef.current) {
          const standby = getStandby()
          if (standby) {
            standby.currentTime = nextSeg.clipOffset
            standbyPreseekDoneRef.current = true
          }
        }

        // Execute transition: swap active/standby
        if (timeLeft <= 0.02) {
          if (nextSeg) {
            const standby = getStandby()
            if (standby) {
              video.pause()
              video.muted = true
              standby.muted = false
              standby.play().catch((e) => console.warn('[PreviewPanel] standby.play:', e))
              activeSlotRef.current = activeSlotRef.current === 'a' ? 'b' : 'a'
              activeSegmentRef.current = nextSeg
              standbyPreseekDoneRef.current = false
              setCurrentTime(nextSeg.startTime)
            }
          } else {
            // End of project
            setPlaying(false)
            setCurrentTime(0)
          }
        } else if (now - lastStoreUpdate >= 33) {
          const t = seg.startTime + video.currentTime - seg.clipOffset
          setCurrentTime(t)
          lastStoreUpdate = now
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, getActive, getStandby])

  // Canvas loop: draws from the active video + enforces position while paused
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let lastDraw = 0
    const renderFrame = (now: number) => {
      const video = getActive()

      // While paused: continuously nudge active video to correct position
      if (!playingRef.current && video && video.readyState >= 1) {
        const target = targetVideoTimeRef.current
        if (Math.abs(video.currentTime - target) > 0.05) {
          video.currentTime = target
        }
      }

      // Draw frame to canvas at ~30fps
      if (video && now - lastDraw >= 33 && video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        lastDraw = now
      }
      canvasRafRef.current = requestAnimationFrame(renderFrame)
    }
    canvasRafRef.current = requestAnimationFrame(renderFrame)
    return () => cancelAnimationFrame(canvasRafRef.current)
  }, [videoSrc, getActive])

  // canplay: apply pending seek on the active video, then play if needed
  const handleCanPlayA = useCallback(() => {
    if (activeSlotRef.current !== 'a') return
    const video = videoARef.current
    if (!video) return
    if (pendingSeekRef.current !== null) {
      video.currentTime = Math.max(0, pendingSeekRef.current)
      pendingSeekRef.current = null
    }
    if (playingRef.current) {
      video.play().catch((e) => console.warn('[PreviewPanel] canplayA→play:', e))
    }
  }, [])

  const handleCanPlayB = useCallback(() => {
    if (activeSlotRef.current !== 'b') return
    const video = videoBRef.current
    if (!video) return
    if (pendingSeekRef.current !== null) {
      video.currentTime = Math.max(0, pendingSeekRef.current)
      pendingSeekRef.current = null
    }
    if (playingRef.current) {
      video.play().catch((e) => console.warn('[PreviewPanel] canplayB→play:', e))
    }
  }, [])

  // src changes: store pending seek, reset slot to A, reset mute state
  const prevSrcRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (videoSrc !== prevSrcRef.current) {
      prevSrcRef.current = videoSrc
      if (videoSrc && activeSegment) {
        pendingSeekRef.current = currentTime - activeSegment.startTime + activeSegment.clipOffset
      }
      // Reset to A as active, B as standby
      activeSlotRef.current = 'a'
      standbyPreseekDoneRef.current = false
      if (videoARef.current) videoARef.current.muted = false
      if (videoBRef.current) videoBRef.current.muted = true
    }
  }, [videoSrc])

  // Play/pause: play active, pause both on pause
  useEffect(() => {
    if (playing) {
      const video = getActive()
      video?.play().catch((e) => console.warn('[PreviewPanel] play:', e))
    } else {
      videoARef.current?.pause()
      videoBRef.current?.pause()
    }
  }, [playing, getActive])

  const togglePlay = useCallback(() => setPlaying(!playing), [playing, setPlaying])
  const totalDuration = project.duration

  return (
    <div
      style={{
        background: '#1e1e1e',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #333',
        overflow: 'hidden',
      }}
    >
      {/* Video area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {videoSrc ? (
          <>
            {/* Video A — starts as active (audio on) */}
            <video
              ref={videoARef}
              src={videoSrc}
              preload="auto"
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
              onCanPlay={handleCanPlayA}
              onEnded={() => setPlaying(false)}
              onError={(e) => console.error('[PreviewPanel] videoA error:', (e.target as HTMLVideoElement).error)}
            />
            {/* Video B — starts as standby (muted), pre-seeked to next segment */}
            <video
              ref={videoBRef}
              src={videoSrc}
              preload="auto"
              muted
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
              onCanPlay={handleCanPlayB}
              onError={(e) => console.error('[PreviewPanel] videoB error:', (e.target as HTMLVideoElement).error)}
            />
            {/* Canvas renders frames from whichever video is active */}
            <canvas
              ref={canvasRef}
              style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
            />
          </>
        ) : (
          <div style={{ color: '#444', fontSize: '14px' }}>
            {project.clips.length === 0
              ? 'Import media and drag to timeline'
              : 'No clip at playhead position'}
          </div>
        )}
      </div>

      {/* Transport bar */}
      <div
        style={{
          background: '#252525',
          borderTop: '1px solid #333',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexShrink: 0,
        }}
      >
        <button
          onClick={togglePlay}
          style={{
            background: 'none',
            border: 'none',
            color: '#ddd',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '2px',
            lineHeight: 1,
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <span style={{ color: '#4a9eff', fontFamily: 'monospace', fontSize: '12px', minWidth: '80px' }}>
          {formatTime(currentTime)}
        </span>

        <input
          type="range"
          min={0}
          max={totalDuration}
          step={0.01}
          value={currentTime}
          onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: '#4a9eff', height: '3px', cursor: 'pointer' }}
        />

        <span style={{ color: '#666', fontFamily: 'monospace', fontSize: '12px', minWidth: '60px', textAlign: 'right' }}>
          {formatTime(totalDuration)}
        </span>
      </div>
    </div>
  )
}
