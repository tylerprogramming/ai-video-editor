import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { basename, join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { probeVideo, generateThumbnail, extractWaveform, extractAudioMp3, extractAudioSegments } from '../services/ffmpeg.service'
import type { MediaClip } from '../../src/types/project.types'

function transcriptDir() {
  return join(app.getPath('userData'), 'ai-video-editor-transcripts')
}

async function ensureTranscriptDir() {
  await mkdir(transcriptDir(), { recursive: true })
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export function registerMediaIpc(win: BrowserWindow): void {
  // Import a media file via dialog
  ipcMain.handle('media:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Media',
      filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const clipId = generateId()

    const [metadata, thumbnailPath] = await Promise.all([
      probeVideo(filePath),
      generateThumbnail(clipId, filePath),
    ])

    const clip: MediaClip = {
      id: clipId,
      originalPath: filePath,
      name: basename(filePath),
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      thumbnailPath,
      waveformData: null, // loaded lazily
    }

    return { clip }
  })

  // Extract waveform for a clip (called after import)
  ipcMain.handle('media:waveform', async (_event, clipId: string, filePath: string) => {
    try {
      const data = await extractWaveform(clipId, filePath)
      return { data }
    } catch (e) {
      console.error('Waveform extraction failed:', e)
      return null
    }
  })

  // Transcribe a clip via OpenAI Whisper (extracts MP3 first, then calls API)
  ipcMain.handle('media:transcribe', async (_event, clipId: string, filePath: string, apiKey: string) => {
    // Step 1: extract compressed MP3
    const mp3Path = await extractAudioMp3(clipId, filePath)

    // Step 2: read the file buffer
    const audioBuffer = await readFile(mp3Path)

    // Step 3: POST to OpenAI Whisper as multipart/form-data
    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3')
    formData.append('model', 'whisper-1')
    formData.append('response_format', 'verbose_json')
    formData.append('timestamp_granularities[]', 'segment')
    formData.append('timestamp_granularities[]', 'word')
    formData.append('temperature', '0')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${err}`)
    }

    return response.json()
  })

  // Transcribe only the kept timeline segments — returns timestamps in edited timeline time
  ipcMain.handle('media:transcribeTimeline', async (
    _event,
    clipId: string,
    filePath: string,
    keepRanges: { start: number; end: number }[],
    apiKey: string
  ) => {
    console.log('[IPC] transcribeTimeline clipId:', clipId, 'keepRanges:', JSON.stringify(keepRanges))
    const mp3Path = await extractAudioSegments(clipId, filePath, keepRanges)
    console.log('[IPC] transcribeTimeline mp3Path:', mp3Path)
    const audioBuffer = await readFile(mp3Path)

    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3')
    formData.append('model', 'whisper-1')
    formData.append('response_format', 'verbose_json')
    formData.append('timestamp_granularities[]', 'segment')
    formData.append('timestamp_granularities[]', 'word')
    formData.append('temperature', '0')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${err}`)
    }

    return response.json()
  })

  // Save transcript to disk (userData/ai-video-editor-transcripts/{clipId}.json)
  ipcMain.handle('media:saveTranscript', async (_event, clipId: string, data: object) => {
    await ensureTranscriptDir()
    const filePath = join(transcriptDir(), `${clipId}.json`)
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return { path: filePath }
  })

  // Load transcript from disk — returns null if not saved yet
  ipcMain.handle('media:loadTranscript', async (_event, clipId: string) => {
    const filePath = join(transcriptDir(), `${clipId}.json`)
    if (!existsSync(filePath)) return null
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  })

  // Save an edited (post-cut) copy of the transcript alongside the original
  ipcMain.handle('media:saveEditedTranscript', async (_event, clipId: string, data: object) => {
    await ensureTranscriptDir()
    const filePath = join(transcriptDir(), `${clipId}-edited-${Date.now()}.json`)
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return { path: filePath }
  })
}
