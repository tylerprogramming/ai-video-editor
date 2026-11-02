import React, { useCallback, useState, useEffect } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { usePlaybackStore } from '../../store/playbackStore'
import { useTranscriptStore } from '../../store/transcriptStore'
import type { DuplicateGroup } from '../../store/transcriptStore'
import type { TranscriptSegment, TranscriptWord, SavedTranscript } from '../../types/ipc.types'

// Remove Whisper hallucinations: empty segments and consecutive repeated phrases.
function deduplicateSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = []
  for (const seg of segments) {
    if (!seg.text.trim()) continue // drop empty
    const norm = seg.text.trim().toLowerCase()
    // If the last 3 kept segments all have this text, it's a hallucination loop
    const recent = result.slice(-3).map(s => s.text.trim().toLowerCase())
    if (recent.length >= 1 && recent.every(t => t === norm)) continue
    result.push(seg)
  }
  return result
}

// Build an edited transcript by removing the given clip-time ranges and adjusting timestamps
function buildEditedSegments(
  segments: TranscriptSegment[],
  removeRanges: { start: number; end: number }[]
): TranscriptSegment[] {
  if (removeRanges.length === 0) return [...segments]

  // Sort + merge
  const sorted = [...removeRanges].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const r of sorted) {
    if (merged.length && r.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end)
    } else {
      merged.push({ ...r })
    }
  }

  const result: TranscriptSegment[] = []
  for (const seg of segments) {
    // Total removed time before this segment (for timestamp shift)
    const shift = merged
      .filter(rm => rm.end <= seg.start)
      .reduce((acc, rm) => acc + rm.end - rm.start, 0)

    // Check full removal
    if (merged.some(rm => rm.start <= seg.start && rm.end >= seg.end)) continue

    // Trim start/end if partially overlapping
    let start = seg.start
    let end = seg.end
    for (const rm of merged) {
      if (rm.start < end && rm.end > start) {
        if (rm.start <= start) start = rm.end
        else end = rm.start
      }
    }
    if (end <= start) continue

    result.push({ ...seg, start: start - shift, end: end - shift })
  }
  return result
}

function formatRelativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function formatTimestamp(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return `${m}:${sec.padStart(4, '0')}`
}

function smallBtnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: '#ccc',
    border: '1px solid #555',
    borderRadius: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '11px',
  }
}

export function TranscriptPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project)
  const resetClipToOriginal = useProjectStore((s) => s.resetClipToOriginal)
  const updateProjectDuration = useProjectStore((s) => s.updateProjectDuration)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setPlaying = usePlaybackStore((s) => s.setPlaying)

  const {
    clipId,
    segments,
    savedAt,
    silenceThreshold,
    amplitudeThreshold,
    silenceGaps,
    duplicateGroups,
    removals,
    apiKey,
    transcriptStatus,
    analyzeStatus,
    error,
    transcriptIsTimelineBased,
    setTranscript,
    setWaveformData,
    setSilenceThreshold,
    setAmplitudeThreshold,
    setDuplicateGroups,
    toggleRemoval,
    setAllSilences,
    setApiKey,
    setSavedAt,
    setTranscriptStatus,
    setAnalyzeStatus,
    setError,
    setTranscriptIsTimelineBased,
    clearSilenceGaps,
    reset,
  } = useTranscriptStore()

  const [selectedClipId, setSelectedClipId] = useState<string>(clipId || '')
  const [applySuccess, setApplySuccess] = useState(false)

  // Auto-load saved transcript + set waveform when clip selection changes
  useEffect(() => {
    if (!selectedClipId) return
    const clip = project.clips.find(c => c.id === selectedClipId)

    // Only load waveform (for silence detection) if the clip hasn't been cut yet.
    // After cuts, the original waveform spans removed sections too, so it would
    // re-detect phantom silences that are already gone from the timeline.
    const clipSegs = project.tracks.flatMap(t => t.segments).filter(s => s.clipId === selectedClipId)
    const isCut = clipSegs.length > 1 || (
      clipSegs.length === 1 && clip &&
      (clipSegs[0].clipOffset > 0.1 || clipSegs[0].duration < clip.duration - 0.1)
    )

    if (!isCut && clip?.waveformData && clip.waveformData.length > 0) {
      setWaveformData(clip.waveformData, clip.duration)
    } else if (isCut) {
      // Clear any stale waveform so gap detection doesn't fire on original clip data
      setWaveformData([], 0)
    }

    window.electronAPI.loadTranscript(selectedClipId).then((saved) => {
      if (saved) {
        setTranscript(saved.clipId, saved.segments, saved.savedAt, saved.words)
        setTranscriptStatus('done')
        // If clip was cut, gaps are stale — clear them
        if (isCut) clearSilenceGaps()
      } else {
        setTranscriptStatus('idle')
        setTranscript(selectedClipId, [], undefined, [])
      }
    }).catch(() => { /* no saved transcript */ })
  }, [selectedClipId])

  const videoClips = project.clips

  // ---- Transcribe ----
  const handleTranscribe = useCallback(async () => {
    const clip = project.clips.find((c) => c.id === selectedClipId)
    if (!clip) return
    if (!apiKey.trim()) {
      setError('OpenAI API key is required')
      return
    }
    const clipSegs = project.tracks
      .flatMap((t) => t.segments)
      .filter((s) => s.clipId === clip.id)
      .sort((a, b) => a.startTime - b.startTime)

    const isCut =
      clipSegs.length > 1 ||
      (clipSegs.length === 1 &&
        (clipSegs[0].clipOffset > 0.1 || clipSegs[0].duration < clip.duration - 0.1))

    setError(null)
    setTranscriptStatus('transcribing')
    console.log('[Transcribe] isCut:', isCut, 'clipSegs:', clipSegs.length, clipSegs.map(s => `startTime=${s.startTime} clipOffset=${s.clipOffset} dur=${s.duration.toFixed(2)}`))
    try {
      let result
      if (isCut) {
        const keepRanges = clipSegs.map((s) => ({
          start: s.clipOffset,
          end: s.clipOffset + s.duration,
        }))
        console.log('[Transcribe] Using transcribeTimeline with keepRanges:', JSON.stringify(keepRanges))
        result = await window.electronAPI.transcribeTimeline(clip.id, clip.originalPath, keepRanges, apiKey)
        setTranscriptIsTimelineBased(true)
      } else {
        console.log('[Transcribe] Using transcribeClip (full clip)')
        result = await window.electronAPI.transcribeClip(clip.id, clip.originalPath, apiKey)
        setTranscriptIsTimelineBased(false)
      }
      const now = Date.now()
      // Deduplicate hallucinated repeated segments before storing
      const cleanSegments = deduplicateSegments(result.segments)
      // Set waveform data first so gap detection uses real amplitude
      if (clip.waveformData && clip.waveformData.length > 0) {
        setWaveformData(clip.waveformData, clip.duration)
      }
      setTranscript(clip.id, cleanSegments, now, result.words)
      setTranscriptStatus('done')
      // Persist to disk (save original + deduped segments)
      const savedData: SavedTranscript = {
        clipId: clip.id,
        clipName: clip.name,
        savedAt: now,
        language: result.language,
        duration: result.duration,
        segments: cleanSegments,
        words: result.words,
      }
      window.electronAPI.saveTranscript(clip.id, savedData)
        .then(() => setSavedAt(now))
        .catch((err: unknown) => console.error('[TranscriptPanel] saveTranscript failed:', err))
    } catch (e) {
      console.error('[TranscriptPanel] transcribeClip error:', e)
      setError(e instanceof Error ? e.message : String(e))
      setTranscriptStatus('error')
    }
  }, [selectedClipId, apiKey, project.clips, project.tracks, setTranscript, setTranscriptStatus, setError, setTranscriptIsTimelineBased])

  // ---- Detect Repeats ----
  const handleDetectRepeats = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('OpenAI API key is required')
      return
    }
    if (segments.length === 0) {
      setError('No transcript segments to analyze')
      return
    }
    setError(null)
    setAnalyzeStatus('analyzing')
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5.4-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are a video editing assistant. Identify groups of transcript segments where the speaker repeated themselves (re-recorded the same content). Return JSON only with this exact shape: {"duplicateGroups": [{"groupId": number, "reason": string, "bestSegmentId": number, "removeSegmentIds": number[]}]}. If no duplicates, return {"duplicateGroups": []}.',
            },
            {
              role: 'user',
              content: `Analyze this transcript for repeated takes:\n\n${segments.map(s => `[${s.id}] ${formatTimestamp(s.start)}-${formatTimestamp(s.end)}: "${s.text.trim()}"`).join('\n')}`,
            },
          ],
        }),
      })
      const data = await response.json()
      const parsed = JSON.parse(data.choices[0].message.content) as { duplicateGroups: DuplicateGroup[] }
      setDuplicateGroups(parsed.duplicateGroups ?? [])
      setAnalyzeStatus('done')
    } catch (e) {
      console.error('[TranscriptPanel] detectRepeats error:', e)
      setError(e instanceof Error ? e.message : String(e))
      setAnalyzeStatus('error')
    }
  }, [apiKey, segments, setDuplicateGroups, setAnalyzeStatus, setError])

  // ---- Apply to Timeline ----
  const handleApply = useCallback(() => {
    const isTimelineBased = useTranscriptStore.getState().transcriptIsTimelineBased
    const projectTracks = useProjectStore.getState().project.tracks

    const toClipTime = (t: number): number => {
      if (!isTimelineBased) return t
      const clipSegs = projectTracks
        .flatMap((tr) => tr.segments)
        .filter((s) => s.clipId === clipId)
        .sort((a, b) => a.startTime - b.startTime)
      for (const seg of clipSegs) {
        if (t >= seg.startTime && t < seg.startTime + seg.duration) {
          return seg.clipOffset + (t - seg.startTime)
        }
      }
      return t
    }

    const removeRanges: { start: number; end: number }[] = []

    // Silence gaps
    for (const gap of silenceGaps) {
      if (removals[gap.key]) {
        removeRanges.push({ start: gap.start, end: gap.end })
      }
    }

    // Duplicate segments
    for (const group of duplicateGroups) {
      for (const segId of group.removeSegmentIds) {
        if (removals[`dup-${segId}`]) {
          const seg = segments.find((s) => s.id === segId)
          if (seg) {
            removeRanges.push({ start: toClipTime(seg.start), end: toClipTime(seg.end) })
          }
        }
      }
    }

    if (removeRanges.length === 0) return

    useProjectStore.getState().applyTranscriptEdits(clipId, removeRanges)
    useProjectStore.getState().updateProjectDuration()

    // Save edited transcript copy
    const clip = useProjectStore.getState().project.clips.find(c => c.id === clipId)
    if (clip) {
      const editedSegs = buildEditedSegments(segments, removeRanges)
      const editedData: SavedTranscript = {
        clipId,
        clipName: clip.name,
        savedAt: Date.now(),
        language: '',
        duration: editedSegs.length > 0 ? editedSegs[editedSegs.length - 1].end : 0,
        segments: editedSegs,
      }
      window.electronAPI.saveEditedTranscript(clipId, editedData)
        .catch((err: unknown) => console.error('[TranscriptPanel] saveEditedTranscript failed:', err))
    }

    // Instead of resetting, filter the transcript to only the segments that
    // weren't fully removed — keeping original timestamps so a second pass
    // (e.g. Detect Repeats) works on exactly what's left in the video.
    const sorted = [...removeRanges].sort((a, b) => a.start - b.start)
    const merged: { start: number; end: number }[] = []
    for (const r of sorted) {
      if (merged.length && r.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end)
      } else {
        merged.push({ ...r })
      }
    }
    const isFullyRemoved = (start: number, end: number) =>
      merged.some(rm => rm.start <= start && rm.end >= end)

    const filteredSegments = segments.filter(s => !isFullyRemoved(s.start, s.end))
    const currentWords = useTranscriptStore.getState().words
    const filteredWords = currentWords.filter(w => !isFullyRemoved(w.start, w.end))

    // Clear stale waveform (belongs to original clip; gap detection now uses filtered segments)
    setWaveformData([], 0)
    setTranscript(clipId, filteredSegments, Date.now(), filteredWords)
    setTranscriptIsTimelineBased(false)  // filtered segments use original clip-time

    // Clear silence gaps immediately — they belonged to the original clip waveform
    // and would be phantom after cuts. User should re-transcribe for a clean pass.
    clearSilenceGaps()

    usePlaybackStore.getState().setPlaying(false)
    usePlaybackStore.getState().setCurrentTime(0)
    setApplySuccess(true)
    setTimeout(() => setApplySuccess(false), 3000)
  }, [silenceGaps, duplicateGroups, removals, segments, clipId, setTranscript, setWaveformData, setTranscriptIsTimelineBased, clearSilenceGaps])

  const anyRemovalSelected = Object.values(removals).some(Boolean)

  // Sets for duplicate segment styling
  const dupRemoveIds = new Set<number>()
  const dupBestIds = new Set<number>()
  for (const group of duplicateGroups) {
    group.removeSegmentIds.forEach(id => dupRemoveIds.add(id))
    dupBestIds.add(group.bestSegmentId)
  }

  // Build interleaved list: segments with silence gaps between them
  type ListItem =
    | { type: 'segment'; segIdx: number }
    | { type: 'gap'; gapKey: string }

  const listItems: ListItem[] = []
  if (segments.length > 0) {
    const preGap = silenceGaps.find(g => g.afterSegIdx === -1)
    if (preGap) listItems.push({ type: 'gap', gapKey: preGap.key })

    for (let i = 0; i < segments.length; i++) {
      listItems.push({ type: 'segment', segIdx: i })
      const gap = silenceGaps.find(g => g.afterSegIdx === i)
      if (gap) listItems.push({ type: 'gap', gapKey: gap.key })
    }
  }

  return (
    <div
      style={{
        background: '#1e1e1e',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        fontSize: '13px',
        color: '#ccc',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 600, color: '#eee', fontSize: '14px' }}>Transcript Editor</div>

        {/* Clip selector */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ color: '#888', whiteSpace: 'nowrap' }}>Clip:</label>
          <select
            value={selectedClipId}
            onChange={(e) => setSelectedClipId(e.target.value)}
            style={{
              flex: 1,
              background: '#2a2a2a',
              border: '1px solid #444',
              color: '#ccc',
              borderRadius: '4px',
              padding: '4px 6px',
              fontSize: '12px',
            }}
          >
            <option value="">-- select clip --</option>
            {videoClips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* API key */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ color: '#888', whiteSpace: 'nowrap' }}>API Key:</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={{
              flex: 1,
              background: '#2a2a2a',
              border: '1px solid #444',
              color: '#ccc',
              borderRadius: '4px',
              padding: '4px 6px',
              fontSize: '12px',
            }}
          />
        </div>

        {/* Transcribe button + saved indicator */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleTranscribe}
            disabled={!selectedClipId || transcriptStatus === 'transcribing'}
            style={{
              flex: 1,
              background: transcriptStatus === 'transcribing' ? '#333' : '#4a9eff',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 10px',
              cursor: selectedClipId && transcriptStatus !== 'transcribing' ? 'pointer' : 'not-allowed',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {transcriptStatus === 'transcribing'
              ? 'Transcribing...'
              : savedAt
              ? 'Retranscribe'
              : 'Transcribe'}
          </button>
          {savedAt && (
            <span style={{ color: '#555', fontSize: '11px', whiteSpace: 'nowrap' }}>
              {'Saved '}{formatRelativeTime(savedAt)}
            </span>
          )}
        </div>

        {/* Reset to original */}
        {selectedClipId && (
          <button
            onClick={() => {
              resetClipToOriginal(selectedClipId)
              updateProjectDuration()
              setPlaying(false)
              setCurrentTime(0)
            }}
            style={smallBtnStyle('#3a1a1a')}
            title="Restore clip to full original — undoes all cuts"
          >
            Reset to Original
          </button>
        )}

        {/* Sliders — show as soon as a clip is selected (waveform detection works pre-transcription) */}
        {clipId && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ color: '#888', whiteSpace: 'nowrap', fontSize: '12px' }}>
              {'Silence > '}{silenceThreshold.toFixed(1)}s
            </label>
            <input
              type="range"
              min={0.1}
              max={3.0}
              step={0.1}
              value={silenceThreshold}
              onChange={(e) => setSilenceThreshold(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#4a9eff' }}
            />
          </div>
        )}

        {clipId && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ color: '#888', whiteSpace: 'nowrap', fontSize: '12px' }}>
              {'Noise < '}{(amplitudeThreshold * 100).toFixed(0)}{'%'}
            </label>
            <input
              type="range"
              min={0.01}
              max={0.15}
              step={0.01}
              value={amplitudeThreshold}
              onChange={(e) => setAmplitudeThreshold(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#ff9944' }}
            />
          </div>
        )}

        {/* Silence quick-select + Detect Repeats */}
        {(silenceGaps.length > 0 || segments.length > 0) && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {silenceGaps.length > 0 && (
              <>
                <button onClick={() => setAllSilences(true)} style={smallBtnStyle('#333')}>
                  All Silences
                </button>
                <button onClick={() => setAllSilences(false)} style={smallBtnStyle('#333')}>
                  None
                </button>
              </>
            )}
            {segments.length > 0 && (
              <button
                onClick={handleDetectRepeats}
                disabled={analyzeStatus === 'analyzing'}
                style={smallBtnStyle(analyzeStatus === 'analyzing' ? '#333' : '#5a5a00')}
              >
                {analyzeStatus === 'analyzing' ? 'Analyzing...' : 'Detect Repeats'}
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              color: '#ff4444',
              fontSize: '12px',
              background: '#2a1010',
              padding: '6px 8px',
              borderRadius: '4px',
            }}
          >
            {error}
          </div>
        )}

        {/* Success */}
        {applySuccess && (
          <div
            style={{
              color: '#44cc77',
              fontSize: '12px',
              background: '#0f2a1a',
              padding: '6px 8px',
              borderRadius: '4px',
            }}
          >
            Applied to timeline successfully!
          </div>
        )}
      </div>

      {/* Transcript body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {/* Empty state */}
        {!clipId && transcriptStatus !== 'transcribing' && (
          <div style={{ color: '#555', textAlign: 'center', marginTop: '32px' }}>
            {videoClips.length === 0 ? 'Import a video clip first' : 'Select a clip above'}
          </div>
        )}

        {transcriptStatus === 'transcribing' && (
          <div style={{ color: '#888', textAlign: 'center', marginTop: '32px' }}>
            Transcribing... this may take a minute
          </div>
        )}

        {/* Pre-transcription: show waveform-detected gaps with a hint */}
        {clipId && segments.length === 0 && silenceGaps.length > 0 && transcriptStatus !== 'transcribing' && (
          <>
            <div style={{ color: '#555', fontSize: '11px', textAlign: 'center', marginBottom: '8px' }}>
              {silenceGaps.length} silence gap{silenceGaps.length !== 1 ? 's' : ''} detected — transcribe to see text
            </div>
            {silenceGaps.map((gap) => {
              const selected = !!removals[gap.key]
              return (
                <div
                  key={gap.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 6px',
                    margin: '2px 0',
                    background: selected ? '#1a1a2a' : 'transparent',
                    borderRadius: '4px',
                    opacity: selected ? 1 : 0.5,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleRemoval(gap.key)}
                    style={{ accentColor: '#4a9eff', cursor: 'pointer' }}
                  />
                  <span style={{ color: '#666', fontStyle: 'italic', fontSize: '12px' }}>
                    ⏸ {gap.duration.toFixed(1)}s silence
                  </span>
                  <span style={{ color: '#444', fontSize: '11px', marginLeft: 'auto', fontFamily: 'monospace' }}>
                    {formatTimestamp(gap.start)}
                  </span>
                </div>
              )
            })}
          </>
        )}

        {/* No gaps and no transcript yet */}
        {clipId && segments.length === 0 && silenceGaps.length === 0 && transcriptStatus === 'idle' && (
          <div style={{ color: '#555', textAlign: 'center', marginTop: '32px' }}>
            Click Transcribe to analyze
          </div>
        )}

        {listItems.map((item) => {
          if (item.type === 'gap') {
            const gap = silenceGaps.find(g => g.key === item.gapKey)
            if (!gap) return null
            const selected = !!removals[gap.key]
            return (
              <div
                key={gap.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 6px',
                  margin: '2px 0',
                  background: selected ? '#1a1a2a' : 'transparent',
                  borderRadius: '4px',
                  opacity: selected ? 1 : 0.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleRemoval(gap.key)}
                  style={{ accentColor: '#4a9eff', cursor: 'pointer' }}
                />
                <span style={{ color: '#666', fontStyle: 'italic', fontSize: '12px' }}>
                  {'\u23F8'} {gap.duration.toFixed(1)}s silence
                </span>
              </div>
            )
          }

          // segment item
          const seg = segments[item.segIdx]
          const isRemoveDup = dupRemoveIds.has(seg.id)
          const isBestDup = dupBestIds.has(seg.id)
          const dupKey = `dup-${seg.id}`
          const dupRemovalSelected = !!removals[dupKey]

          const group = duplicateGroups.find(
            g => g.removeSegmentIds.includes(seg.id) || g.bestSegmentId === seg.id
          )

          const borderColor = isRemoveDup ? '#ff9944' : isBestDup ? '#44cc77' : 'transparent'
          const textDecoration: React.CSSProperties['textDecoration'] =
            isRemoveDup && dupRemovalSelected ? 'line-through' : 'none'
          const textColor = isRemoveDup ? '#ffcc99' : isBestDup ? '#44cc77' : '#ddd'

          return (
            <div
              key={seg.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '5px 8px',
                margin: '2px 0',
                borderLeft: `3px solid ${borderColor}`,
                borderRadius: '0 4px 4px 0',
                background: isRemoveDup ? '#2a1a08' : isBestDup ? '#0f2a1a' : 'transparent',
              }}
            >
              {/* Checkbox for dup removal */}
              {isRemoveDup && (
                <input
                  type="checkbox"
                  checked={dupRemovalSelected}
                  onChange={() => toggleRemoval(dupKey)}
                  style={{ accentColor: '#ff9944', cursor: 'pointer', marginTop: '2px', flexShrink: 0 }}
                />
              )}

              {/* Timestamp */}
              <button
                onClick={() => {
                  setPlaying(false)
                  setCurrentTime(seg.start)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#4a9eff',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  padding: '0',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  marginTop: '1px',
                }}
              >
                {formatTimestamp(seg.start)}
              </button>

              {/* Text */}
              <span style={{ color: textColor, textDecoration, lineHeight: '1.4', flex: 1 }}>
                {seg.text.trim()}
              </span>

              {/* Badges */}
              {isRemoveDup && (
                <span
                  title={group?.reason}
                  style={{
                    background: '#ff9944',
                    color: '#fff',
                    fontSize: '10px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    flexShrink: 0,
                    alignSelf: 'center',
                  }}
                >
                  Remove
                </span>
              )}
              {isBestDup && (
                <span
                  style={{
                    background: '#44cc77',
                    color: '#000',
                    fontSize: '10px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    flexShrink: 0,
                    alignSelf: 'center',
                  }}
                >
                  Best take
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Apply to Timeline footer */}
      {anyRemovalSelected && (
        <div
          style={{
            padding: '10px 12px',
            borderTop: '1px solid #333',
            flexShrink: 0,
          }}
        >
          <button
            onClick={handleApply}
            style={{
              width: '100%',
              background: '#4a9eff',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 12px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            {`Apply to Timeline (${Object.values(removals).filter(Boolean).length} item${Object.values(removals).filter(Boolean).length !== 1 ? 's' : ''} selected)`}
          </button>
        </div>
      )}
    </div>
  )
}

// Re-export DuplicateGroup for consumers
export type { DuplicateGroup }
