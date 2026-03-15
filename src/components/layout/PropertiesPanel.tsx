import React from 'react'
import { useProjectStore } from '../../store/projectStore'

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2)
  return `${m}:${sec.padStart(5, '0')}`
}

export function PropertiesPanel(): React.ReactElement {
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId)
  const getSelectedSegment = useProjectStore((s) => s.getSelectedSegment)
  const getClipById = useProjectStore((s) => s.getClipById)

  const segment = getSelectedSegment()
  const clip = segment ? getClipById(segment.clipId) : undefined

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {!clip ? (
          <div style={{ color: '#555', fontSize: '12px' }}>
            Select a clip on the timeline to see properties
          </div>
        ) : (
          <>
            <PropGroup label="Clip">
              <PropRow label="Name" value={clip.name} />
              <PropRow label="Duration" value={formatDuration(clip.duration)} />
              <PropRow label="Resolution" value={`${clip.width} × ${clip.height}`} />
              <PropRow label="Frame Rate" value={`${clip.fps} fps`} />
            </PropGroup>

            {segment && (
              <PropGroup label="Segment">
                <PropRow label="Start" value={formatDuration(segment.startTime)} />
                <PropRow label="Duration" value={formatDuration(segment.duration)} />
                <PropRow label="Offset" value={formatDuration(segment.clipOffset)} />
              </PropGroup>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PropGroup({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          color: '#888',
          fontSize: '10px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '8px',
          paddingBottom: '4px',
          borderBottom: '1px solid #333',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function PropRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '3px 0',
        gap: '8px',
      }}
    >
      <span style={{ color: '#777', fontSize: '12px', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: '#ccc',
          fontSize: '12px',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}
