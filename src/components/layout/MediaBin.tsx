import React, { useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useUIStore } from '../../store/uiStore'
import type { MediaClip, TimelineSegment } from '../../types/project.types'

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function MediaBin(): React.ReactElement {
  const clips = useProjectStore((s) => s.project.clips)
  const addClip = useProjectStore((s) => s.addClip)
  const addSegmentToTrack = useProjectStore((s) => s.addSegmentToTrack)
  const updateClipWaveform = useProjectStore((s) => s.updateClipWaveform)
  const updateProjectDuration = useProjectStore((s) => s.updateProjectDuration)
  const setDraggingClip = useUIStore((s) => s.setDraggingClip)

  const handleImport = useCallback(async () => {
    const result = await window.electronAPI.importMedia()
    if (!result) return

    addClip(result.clip)

    // Auto-add to first video track after last existing segment
    const tracks = useProjectStore.getState().project.tracks
    const videoTrack = tracks.find((t) => t.type === 'video')
    if (videoTrack) {
      const nextStart = videoTrack.segments.reduce(
        (max, s) => Math.max(max, s.startTime + s.duration),
        0
      )
      const segment: TimelineSegment = {
        id: `seg-${Math.random().toString(36).slice(2, 9)}`,
        clipId: result.clip.id,
        trackId: videoTrack.id,
        startTime: nextStart,
        duration: result.clip.duration,
        clipOffset: 0,
      }
      addSegmentToTrack(videoTrack.id, segment)
      updateProjectDuration()
    }

    // Load waveform in background
    window.electronAPI
      .getWaveform(result.clip.id, result.clip.originalPath)
      .then((wResult) => {
        if (wResult) updateClipWaveform(result.clip.id, wResult.data)
      })
      .catch(console.error)
  }, [addClip, addSegmentToTrack, updateClipWaveform, updateProjectDuration])

  const handleDragStart = useCallback(
    (e: React.DragEvent, clip: MediaClip) => {
      e.dataTransfer.setData('clipId', clip.id)
      e.dataTransfer.effectAllowed = 'copy'
      setDraggingClip(clip.id)
    },
    [setDraggingClip]
  )

  const handleDragEnd = useCallback(() => {
    setDraggingClip(null)
  }, [setDraggingClip])

  return (
    <div
      style={{
        background: '#252525',
        borderRight: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ color: '#aaa', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Media
        </span>
        <button
          onClick={handleImport}
          style={{
            background: '#4a9eff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Import
        </button>
      </div>

      {/* Clip grid */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '6px',
          alignContent: 'start',
        }}
      >
        {clips.length === 0 && (
          <div
            style={{
              gridColumn: '1/-1',
              color: '#555',
              textAlign: 'center',
              paddingTop: '40px',
              fontSize: '12px',
            }}
          >
            Import media to get started
          </div>
        )}
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    </div>
  )
}

interface ClipCardProps {
  clip: MediaClip
  onDragStart: (e: React.DragEvent, clip: MediaClip) => void
  onDragEnd: (e: React.DragEvent) => void
}

function ClipCard({ clip, onDragStart, onDragEnd }: ClipCardProps): React.ReactElement {
  // Convert absolute path to app:// protocol for img src
  const thumbSrc = clip.thumbnailPath
    ? `app://${encodeURIComponent(clip.thumbnailPath)}`
    : undefined

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, clip)}
      onDragEnd={onDragEnd}
      style={{
        background: '#2d2d2d',
        borderRadius: '6px',
        overflow: 'hidden',
        cursor: 'grab',
        border: '1px solid #3a3a3a',
        userSelect: 'none',
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '16/9', background: '#111' }}>
        {thumbSrc && (
          <img
            src={thumbSrc}
            alt={clip.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            bottom: '2px',
            right: '4px',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            fontSize: '10px',
            padding: '1px 4px',
            borderRadius: '2px',
          }}
        >
          {formatDuration(clip.duration)}
        </div>
      </div>
      <div style={{ padding: '4px 6px' }}>
        <div
          style={{
            color: '#ccc',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={clip.name}
        >
          {clip.name}
        </div>
      </div>
    </div>
  )
}
