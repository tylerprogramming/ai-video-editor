import React, { useRef, useEffect, useCallback, useState } from 'react'
import { Stage, Layer, Rect, Text, Line, Group } from 'react-konva'
import { useProjectStore } from '../../store/projectStore'
import { usePlaybackStore } from '../../store/playbackStore'
import { useTranscriptStore } from '../../store/transcriptStore'
import type { Track, TimelineSegment } from '../../types/project.types'

const RULER_HEIGHT = 24
const TRACK_HEIGHT = 60
const WAVEFORM_COLOR = 'rgba(100, 180, 255, 0.6)'
const CLIP_COLOR = '#2d5a8e'
const CLIP_SELECTED_COLOR = '#4a9eff'

interface TimelineCanvasProps {
  scrollContainerRef: React.RefObject<HTMLDivElement>
  trackHeaderWidth: number
  scrollLeft: number
  cutMode: boolean
  onCutModeUsed: () => void
}

export function TimelineCanvas({ scrollContainerRef, trackHeaderWidth, scrollLeft, cutMode, onCutModeUsed }: TimelineCanvasProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: RULER_HEIGHT + 2 * TRACK_HEIGHT })
  const sizeRef = useRef(size)

  // Imperative playhead refs — avoids subscribing to currentTime in React state
  const playheadLayerRef = useRef<any>(null)
  const playheadGroupRef = useRef<any>(null)

  const project = useProjectStore((s) => s.project)
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId)
  const selectSegment = useProjectStore((s) => s.selectSegment)
  const getClipById = useProjectStore((s) => s.getClipById)
  const splitSegment = useProjectStore((s) => s.splitSegment)
  const deleteSegment = useProjectStore((s) => s.deleteSegment)

  // Silence preview overlays
  const transcriptClipId = useTranscriptStore((s) => s.clipId)
  const silenceGaps = useTranscriptStore((s) => s.silenceGaps)
  const removals = useTranscriptStore((s) => s.removals)
  const transcriptSegments = useTranscriptStore((s) => s.segments)

  // No currentTime subscription here — the playhead updates imperatively below
  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setPlaying = usePlaybackStore((s) => s.setPlaying)

  // Keep sizeRef current so the subscribe callback always has the right height
  useEffect(() => { sizeRef.current = size }, [size])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = useProjectStore.getState().selectedSegmentId
        if (id) {
          useProjectStore.getState().deleteSegment(id)
          useProjectStore.getState().selectSegment(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Single ResizeObserver — also fires immediately on mount and dep changes
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const updateSize = () => {
      const totalWidth = Math.max(el.clientWidth, project.duration * pixelsPerSecond + trackHeaderWidth + 100)
      const totalHeight = RULER_HEIGHT + project.tracks.length * TRACK_HEIGHT
      setSize((prev) => {
        if (prev.width === totalWidth && prev.height === totalHeight) return prev
        return { width: totalWidth, height: totalHeight }
      })
    }
    updateSize()
    const ro = new ResizeObserver(updateSize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollContainerRef, project.duration, pixelsPerSecond, project.tracks.length, trackHeaderWidth])

  // Subscribe to currentTime imperatively — zero React re-renders during playback
  useEffect(() => {
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      const x = trackHeaderWidth + state.currentTime * state.pixelsPerSecond
      playheadGroupRef.current?.x(x)
      playheadLayerRef.current?.batchDraw()
    })
    return unsubscribe
  }, [trackHeaderWidth])

  const handleRulerClick = useCallback(
    (e: any) => {
      const x = e.evt.layerX + scrollLeft - trackHeaderWidth
      if (x < 0) return
      setCurrentTime(x / pixelsPerSecond)
      setPlaying(false)
    },
    [trackHeaderWidth, pixelsPerSecond, scrollLeft, setCurrentTime, setPlaying]
  )

  const handleStageClick = useCallback(
    (e: any) => {
      if (e.target !== e.target.getStage() && e.target.name() !== 'background') return
      if (e.evt.layerY < RULER_HEIGHT) return
      const x = e.evt.layerX + scrollLeft - trackHeaderWidth
      if (x < 0) return
      setCurrentTime(x / pixelsPerSecond)
    },
    [trackHeaderWidth, pixelsPerSecond, scrollLeft, setCurrentTime]
  )

  const handleSelectSegment = useCallback((id: string) => selectSegment(id), [selectSegment])

  const rulerMarks = React.useMemo(() => {
    const marks: { x: number; label: string; major: boolean }[] = []
    const totalSeconds = (size.width - trackHeaderWidth) / pixelsPerSecond
    let tickInterval = 1
    if (pixelsPerSecond < 30) tickInterval = 10
    else if (pixelsPerSecond < 60) tickInterval = 5
    else if (pixelsPerSecond < 150) tickInterval = 2
    for (let t = 0; t <= totalSeconds; t += tickInterval) {
      const x = trackHeaderWidth + t * pixelsPerSecond
      const m = Math.floor(t / 60)
      const s = Math.floor(t % 60)
      marks.push({ x, label: `${m}:${s.toString().padStart(2, '0')}`, major: t % (tickInterval * 5) === 0 })
    }
    return marks
  }, [size.width, pixelsPerSecond, trackHeaderWidth])

  const initialX = trackHeaderWidth + usePlaybackStore.getState().currentTime * pixelsPerSecond

  return (
    <div ref={containerRef} style={{ width: `${size.width}px`, height: `${size.height}px`, position: 'relative' }}>
      <Stage width={size.width} height={size.height} onClick={handleStageClick} style={{ cursor: cutMode ? 'crosshair' : 'default' }}>

        {/* Layer 1: Static backgrounds + ruler */}
        <Layer>
          <Rect name="background" x={0} y={0} width={size.width} height={size.height} fill="#1e1e1e" listening={false} />

          {project.tracks.map((track, i) => {
            const y = RULER_HEIGHT + i * TRACK_HEIGHT
            return (
              <Group key={track.id} listening={false}>
                <Rect name="background" x={0} y={y} width={size.width} height={TRACK_HEIGHT} fill={i % 2 === 0 ? '#242424' : '#202020'} />
                <Rect x={0} y={y} width={trackHeaderWidth} height={TRACK_HEIGHT} fill="#2a2a2a" />
                <Rect x={trackHeaderWidth - 1} y={y} width={1} height={TRACK_HEIGHT} fill="#3a3a3a" />
                <Text x={8} y={y + TRACK_HEIGHT / 2 - 6} text={track.name} fontSize={11} fill="#999" />
                <Text x={8} y={y + TRACK_HEIGHT / 2 + 6} text={track.type.toUpperCase()} fontSize={9} fill="#555" />
                <Rect x={0} y={y + TRACK_HEIGHT - 1} width={size.width} height={1} fill="#2e2e2e" />
              </Group>
            )
          })}

          <Rect x={0} y={0} width={size.width} height={RULER_HEIGHT} fill="#222" listening={false} />
          <Rect x={0} y={RULER_HEIGHT - 1} width={size.width} height={1} fill="#3a3a3a" listening={false} />

          {rulerMarks.map((mark) => (
            <Group key={mark.x} listening={false}>
              <Line points={[mark.x, mark.major ? 8 : 14, mark.x, RULER_HEIGHT]} stroke={mark.major ? '#555' : '#3a3a3a'} strokeWidth={1} />
              {mark.major && <Text x={mark.x + 3} y={4} text={mark.label} fontSize={9} fill="#666" />}
            </Group>
          ))}

          {/* Single clickable rect for the entire ruler — no per-mark handlers */}
          <Rect x={trackHeaderWidth} y={0} width={size.width - trackHeaderWidth} height={RULER_HEIGHT} fill="transparent" onClick={handleRulerClick} />
          <Rect x={0} y={0} width={trackHeaderWidth} height={RULER_HEIGHT} fill="#252525" listening={false} />
        </Layer>

        {/* Layer 2: Clip segments */}
        <Layer>
          {project.tracks.map((track, i) => {
            const y = RULER_HEIGHT + i * TRACK_HEIGHT
            return (
              <Group key={track.id}>
                {track.segments.map((seg) => (
                  <ClipSegment
                    key={seg.id}
                    segment={seg}
                    track={track}
                    trackY={y}
                    trackHeight={TRACK_HEIGHT}
                    pixelsPerSecond={pixelsPerSecond}
                    trackHeaderWidth={trackHeaderWidth}
                    scrollLeft={scrollLeft}
                    selected={seg.id === selectedSegmentId}
                    waveformData={getClipById(seg.clipId)?.waveformData ?? null}
                    clipDuration={getClipById(seg.clipId)?.duration ?? seg.duration}
                    clipName={getClipById(seg.clipId)?.name ?? ''}
                    onSelect={handleSelectSegment}
                    cutMode={cutMode}
                    onCutModeUsed={onCutModeUsed}
                    splitSegment={splitSegment}
                  />
                ))}
              </Group>
            )
          })}
        </Layer>

        {/* Layer 3: Silence removal preview overlays */}
        <Layer listening={false}>
          {transcriptClipId && silenceGaps.map((gap) => {
            if (!removals[gap.key]) return null
            // Find all timeline segments for this clip and map clip-time gap to timeline position
            return project.tracks.flatMap((track, i) =>
              track.segments
                .filter(seg => seg.clipId === transcriptClipId)
                .map(seg => {
                  // Clip-time range of this segment: [seg.clipOffset, seg.clipOffset + seg.duration]
                  const segClipEnd = seg.clipOffset + seg.duration
                  const overlapStart = Math.max(gap.start, seg.clipOffset)
                  const overlapEnd = Math.min(gap.end, segClipEnd)
                  if (overlapEnd <= overlapStart) return null
                  const tlStart = seg.startTime + (overlapStart - seg.clipOffset)
                  const tlEnd = seg.startTime + (overlapEnd - seg.clipOffset)
                  const rx = trackHeaderWidth + tlStart * pixelsPerSecond
                  const rw = Math.max(2, (tlEnd - tlStart) * pixelsPerSecond)
                  const ry = RULER_HEIGHT + i * TRACK_HEIGHT + 1
                  return (
                    <Rect
                      key={`${gap.key}-${seg.id}`}
                      x={rx} y={ry} width={rw} height={TRACK_HEIGHT - 2}
                      fill="rgba(255, 60, 60, 0.35)"
                      stroke="rgba(255, 80, 80, 0.7)"
                      strokeWidth={1}
                      cornerRadius={2}
                    />
                  )
                })
            )
          })}
          {/* Orange overlays for duplicate transcript segments flagged for removal */}
          {transcriptClipId && transcriptSegments.map((seg) => {
            const key = `dup-${seg.id}`
            if (!removals[key]) return null
            return project.tracks.flatMap((track, ti) =>
              track.segments
                .filter((ts) => ts.clipId === transcriptClipId)
                .map((ts) => {
                  const overlapStart = Math.max(seg.start, ts.clipOffset)
                  const overlapEnd = Math.min(seg.end, ts.clipOffset + ts.duration)
                  if (overlapEnd <= overlapStart) return null
                  const tlStart = ts.startTime + (overlapStart - ts.clipOffset)
                  const tlEnd = ts.startTime + (overlapEnd - ts.clipOffset)
                  const rx = trackHeaderWidth + tlStart * pixelsPerSecond
                  const rw = Math.max(2, (tlEnd - tlStart) * pixelsPerSecond)
                  const ry = RULER_HEIGHT + ti * TRACK_HEIGHT + 1
                  return (
                    <Rect
                      key={`${key}-${ts.id}`}
                      x={rx} y={ry} width={rw} height={TRACK_HEIGHT - 2}
                      fill="rgba(255, 153, 68, 0.35)"
                      stroke="rgba(255, 153, 68, 0.7)"
                      strokeWidth={1}
                      cornerRadius={2}
                    />
                  )
                })
            )
          })}
        </Layer>

        {/* Layer 4: Playhead — draggable handle, line updated imperatively */}
        <Layer ref={playheadLayerRef}>
          <Group
            ref={playheadGroupRef}
            x={initialX}
            y={0}
            draggable
            dragBoundFunc={(pos) => ({ x: Math.max(trackHeaderWidth, pos.x), y: 0 })}
            onDragMove={() => {
              // Konva moves the group imperatively — no store update during drag
              // (avoids triggering video.currentTime seek on every pixel)
            }}
            onDragEnd={(e) => {
              const t = Math.max(0, (e.target.x() - trackHeaderWidth) / pixelsPerSecond)
              usePlaybackStore.getState().setPlaying(false)
              usePlaybackStore.getState().setCurrentTime(t)
            }}
          >
            <Line points={[0, 0, 0, size.height]} stroke="#ff4444" strokeWidth={1.5} listening={false} />
            {/* Wider invisible hit area over the handle for easy grabbing */}
            <Rect x={-8} y={0} width={16} height={size.height} fill="transparent" />
            <Rect x={-6} y={0} width={12} height={16} fill="#ff4444" cornerRadius={2} />
          </Group>
        </Layer>
      </Stage>
    </div>
  )
}

interface ClipSegmentProps {
  segment: TimelineSegment
  track: Track
  trackY: number
  trackHeight: number
  pixelsPerSecond: number
  trackHeaderWidth: number
  scrollLeft: number
  selected: boolean
  waveformData: number[] | null
  clipDuration: number
  clipName: string
  onSelect: (id: string) => void
  cutMode: boolean
  onCutModeUsed: () => void
  splitSegment: (segmentId: string, timelineTime: number) => void
}

const ClipSegment = React.memo(function ClipSegment({
  segment,
  track,
  trackY,
  trackHeight,
  pixelsPerSecond,
  trackHeaderWidth,
  scrollLeft,
  selected,
  waveformData,
  clipDuration,
  clipName,
  onSelect,
  cutMode,
  onCutModeUsed,
  splitSegment,
}: ClipSegmentProps): React.ReactElement {
  const x = trackHeaderWidth + segment.startTime * pixelsPerSecond
  const width = Math.max(4, segment.duration * pixelsPerSecond)
  const height = trackHeight - 2
  const y = trackY + 1

  const clipColor = selected ? CLIP_SELECTED_COLOR : CLIP_COLOR

  const waveformPoints = React.useMemo(() => {
    if (!waveformData || waveformData.length === 0 || track.type !== 'video') return null
    const totalData = waveformData.length
    // Cap render resolution: no point iterating more pixels than data points
    // This fixes severe lag when zoomed in (e.g. 400px/s × 60s = 24000px → capped at 10000)
    const pixelWidth = Math.min(Math.floor(width), totalData)
    if (pixelWidth <= 0) return null

    // Find display peak for normalization (so waveform fills track height)
    let displayPeak = 0.001
    for (const v of waveformData) if (v > displayPeak) displayPeak = v

    const points: number[] = []
    const midY = y + height / 2
    const halfH = (height - 8) * 0.5
    const scaleX = width / pixelWidth // stretch bars to fill full clip width
    for (let px = 0; px < pixelWidth; px++) {
      const t0 = (px / pixelWidth) * segment.duration + segment.clipOffset
      const t1 = ((px + 1) / pixelWidth) * segment.duration + segment.clipOffset
      const i0 = Math.floor((t0 / clipDuration) * totalData)
      const i1 = Math.ceil((t1 / clipDuration) * totalData)
      let peak = 0
      for (let i = i0; i < Math.min(i1, totalData); i++) {
        peak = Math.max(peak, waveformData[i] ?? 0)
      }
      const amp = (peak / displayPeak) * halfH
      const drawX = x + px * scaleX
      points.push(drawX, midY - amp, drawX, midY + amp)
    }
    return points
  }, [waveformData, segment, clipDuration, width, height, x, y, track.type])

  const handleClick = useCallback((e: any) => {
    if (cutMode) {
      // compute timeline time from click position
      const clickX = e.evt.layerX + scrollLeft - trackHeaderWidth
      const timelineTime = clickX / pixelsPerSecond
      splitSegment(segment.id, timelineTime)
      onCutModeUsed()
    } else {
      onSelect(segment.id)
    }
  }, [cutMode, onSelect, segment.id, splitSegment, onCutModeUsed, scrollLeft, trackHeaderWidth, pixelsPerSecond])

  return (
    <Group onClick={(e) => handleClick(e)}>
      <Rect x={x} y={y} width={width} height={height} fill={clipColor} cornerRadius={3} stroke={selected ? '#7abfff' : '#1a3a5e'} strokeWidth={1} />
      <Text x={x + 4} y={y + 4} text={clipName} fontSize={10} fill="rgba(255,255,255,0.8)" width={width - 8} ellipsis wrap="none" listening={false} />
      {waveformPoints && waveformPoints.length > 0 && (
        <Line points={waveformPoints} stroke={WAVEFORM_COLOR} strokeWidth={1} lineCap="round" listening={false} />
      )}
    </Group>
  )
})
