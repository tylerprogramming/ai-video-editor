import React, { useState } from 'react'
import { MediaBin } from './MediaBin'
import { PreviewPanel } from './PreviewPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { TranscriptPanel } from './TranscriptPanel'
import { Timeline } from '../timeline/Timeline'

type RightTab = 'properties' | 'transcript'

export function AppShell(): React.ReactElement {
  const [rightTab, setRightTab] = useState<RightTab>('properties')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '32px 1fr 280px',
        height: '100vh',
        background: '#1a1a1a',
      }}
    >
      {/* Menu bar */}
      <div
        className="titlebar-drag"
        style={{
          background: '#111',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '80px',
          paddingRight: '12px',
          gap: '16px',
        }}
      >
        <span style={{ color: '#888', fontSize: '12px', fontWeight: 600 }}>
          AI Video Editor
        </span>
      </div>

      {/* Middle row: MediaBin | Preview | Right panel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 280px',
          minHeight: 0,
        }}
      >
        <MediaBin />
        <PreviewPanel />

        {/* Right panel with tabs */}
        <div
          style={{
            background: '#252525',
            borderLeft: '1px solid #333',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #333',
              flexShrink: 0,
            }}
          >
            {(['properties', 'transcript'] as RightTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1,
                  background: rightTab === tab ? '#2d2d2d' : 'transparent',
                  border: 'none',
                  borderBottom: rightTab === tab ? '2px solid #4a9eff' : '2px solid transparent',
                  color: rightTab === tab ? '#ddd' : '#777',
                  padding: '7px 4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                }}
              >
                {tab === 'properties' ? 'Properties' : 'Transcript'}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {rightTab === 'properties' ? <PropertiesPanel /> : <TranscriptPanel />}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <Timeline />
    </div>
  )
}
