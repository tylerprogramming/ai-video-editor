import React, { useRef, useCallback, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { usePlaybackStore } from '../../store/playbackStore'
import { useUIStore } from '../../store/uiStore'
import { TimelineCanvas } from './TimelineCanvas'
import type { TimelineSegment } from '../../types/project.types'

const TRACK_HEADER_WIDTH = 120

export function Timeline(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const addSegmentToTrack = useProjectStore((s) => s.addSegmentToTrack)
  const getClipById = useProjectStore((s) => s.getClipById)
  const updateProjectDuration = useProjectStore((s) => s.updateProjectDuration)
  const rippleCompact = useProjectStore((s) => s.rippleCompact)

  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond)
  const setZoom = usePlaybackStore((s) => s.setZoom)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)

  const draggingClipId = useUIStore((s) => s.draggingClipId)
  const setDraggingClip = useUIStore((s) => s.setDraggingClip)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [cutMode, setCutMode] = useState(false)

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft((e.currentTarget as HTMLDivElement).scrollLeft)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!draggingClipId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [draggingClipId]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const clipId = e.dataTransfer.getData('clipId')
      if (!clipId) return

      const clip = getClipById(clipId)
      if (!clip) return

      // Calculate drop position on timeline
      const rect = e.currentTarget.getBoundingClientRect()
      const scrollLeft = scrollRef.current?.scrollLeft ?? 0
      const x = e.clientX - rect.left - TRACK_HEADER_WIDTH + scrollLeft
      const startTime = Math.max(0, x / pixelsPerSecond)

      // Drop onto first video track
      const videoTrack = project.tracks.find((t) => t.type === 'video')
      if (!videoTrack) return

      const segment: TimelineSegment = {
        id: `seg-${Math.random().toString(36).slice(2, 9)}`,
        clipId,
        trackId: videoTrack.id,
        startTime,
        duration: clip.duration,
        clipOffset: 0,
      }

      addSegmentToTrack(videoTrack.id, segment)
      updateProjectDuration()
      setDraggingClip(null)
    },
    [draggingClipId, getClipById, project.tracks, pixelsPerSecond, addSegmentToTrack, updateProjectDuration, setDraggingClip]
  )

  return (
    <div
      style={{
        background: '#1e1e1e',
        borderTop: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          height: '32px',
          background: '#252525',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: '12px',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#888', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Timeline
        </span>
        <button
          onClick={() => setCutMode(c => !c)}
          title="Cut tool (split clip at click)"
          style={{
            background: cutMode ? '#4a9eff' : '#333',
            border: cutMode ? '1px solid #4a9eff' : '1px solid #555',
            color: cutMode ? '#fff' : '#aaa',
            padding: '2px 8px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          ✂
        </button>
        <button
          onClick={() => { rippleCompact(); updateProjectDuration() }}
          title="Ripple compact — pull all clips together, removing gaps"
          style={{
            background: '#333',
            border: '1px solid #555',
            color: '#aaa',
            padding: '2px 8px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          🧲
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#666', fontSize: '11px' }}>Zoom</span>
        <button
          onClick={() => setZoom(pixelsPerSecond / 1.5)}
          style={{ background: '#333', border: 'none', color: '#ccc', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '14px' }}
        >
          −
        </button>
        <span style={{ color: '#aaa', fontSize: '11px', minWidth: '45px', textAlign: 'center' }}>
          {Math.round(pixelsPerSecond)}px/s
        </span>
        <button
          onClick={() => setZoom(pixelsPerSecond * 1.5)}
          style={{ background: '#333', border: 'none', color: '#ccc', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '14px' }}
        >
          +
        </button>
      </div>

      {/* Scrollable canvas area */}
      <div
        ref={scrollRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
          position: 'relative',
        }}
      >
        <TimelineCanvas
          scrollContainerRef={scrollRef}
          trackHeaderWidth={TRACK_HEADER_WIDTH}
          scrollLeft={scrollLeft}
          cutMode={cutMode}
          onCutModeUsed={() => setCutMode(false)}
        />
      </div>
    </div>
  )
}
