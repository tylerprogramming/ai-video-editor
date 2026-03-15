import ffmpeg from 'fluent-ffmpeg'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, existsSync } from 'fs'
import { PassThrough } from 'stream'

// Locate ffmpeg binary — use system ffmpeg on macOS
function findFfmpeg(): string {
  const candidates = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return 'ffmpeg' // fallback to PATH
}

function findFfprobe(): string {
  const candidates = [
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/usr/bin/ffprobe',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return 'ffprobe'
}

ffmpeg.setFfmpegPath(findFfmpeg())
ffmpeg.setFfprobePath(findFfprobe())

export interface VideoMetadata {
  duration: number
  width: number
  height: number
  fps: number
}

export function probeVideo(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err)

      const videoStream = data.streams.find((s) => s.codec_type === 'video')
      if (!videoStream) return reject(new Error('No video stream found'))

      const duration = data.format.duration ?? 0
      const width = videoStream.width ?? 1920
      const height = videoStream.height ?? 1080

      // Parse fps: "30/1" or "30000/1001"
      let fps = 30
      const rFrameRate = videoStream.r_frame_rate ?? '30/1'
      const parts = rFrameRate.split('/')
      if (parts.length === 2) {
        fps = Math.round(parseInt(parts[0]) / parseInt(parts[1]))
      }

      resolve({ duration, width, height, fps })
    })
  })
}

export function generateThumbnail(clipId: string, filePath: string): Promise<string> {
  const cacheDir = join(tmpdir(), 'ai-video-editor', clipId)
  mkdirSync(cacheDir, { recursive: true })
  const thumbPath = join(cacheDir, 'thumb.jpg')

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .screenshots({
        timestamps: ['10%'],
        filename: 'thumb.jpg',
        folder: cacheDir,
        size: '320x180',
      })
      .on('end', () => resolve(thumbPath))
      .on('error', reject)
  })
}

export function extractAudioMp3(clipId: string, filePath: string): Promise<string> {
  const cacheDir = join(tmpdir(), 'ai-video-editor', clipId)
  mkdirSync(cacheDir, { recursive: true })
  const mp3Path = join(cacheDir, 'audio.mp3')

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('64k')   // ~0.5 MB/min — fits OpenAI 25 MB limit for ~50 min videos
      .audioChannels(1)
      .on('end', () => resolve(mp3Path))
      .on('error', reject)
      .save(mp3Path)
  })
}

// Extract and concatenate only the kept audio segments (clip-time ranges) into one MP3.
// The resulting audio has timestamps starting from 0, mapping to the edited timeline.
export function extractAudioSegments(
  clipId: string,
  filePath: string,
  keepRanges: { start: number; end: number }[]
): Promise<string> {
  if (keepRanges.length === 0) return extractAudioMp3(clipId, filePath)

  const cacheDir = join(tmpdir(), 'ai-video-editor', clipId)
  mkdirSync(cacheDir, { recursive: true })
  const mp3Path = join(cacheDir, 'timeline-audio.mp3')

  return new Promise((resolve, reject) => {
    const segFilters = keepRanges.map((r, i) =>
      `[0:a]atrim=start=${r.start.toFixed(6)}:end=${r.end.toFixed(6)},asetpts=PTS-STARTPTS[seg${i}]`
    )
    const concatParts = keepRanges.map((_, i) => `[seg${i}]`).join('')
    const concatFilter = `${concatParts}concat=n=${keepRanges.length}:v=0:a=1[out]`
    const filterComplex = [...segFilters, concatFilter].join(';')

    console.log('[ffmpeg] extractAudioSegments keepRanges:', JSON.stringify(keepRanges))
    console.log('[ffmpeg] filter_complex:', filterComplex)

    // Use raw output options to avoid fluent-ffmpeg's complexFilter parsing interfering
    ffmpeg(filePath)
      .outputOptions([
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-ac', '1',
        '-b:a', '64k',
        '-acodec', 'libmp3lame',
      ])
      .on('end', () => {
        console.log('[ffmpeg] extractAudioSegments done:', mp3Path)
        resolve(mp3Path)
      })
      .on('error', (err) => {
        console.error('[ffmpeg] extractAudioSegments error:', err.message)
        reject(err)
      })
      .save(mp3Path)
  })
}

export function extractWaveform(clipId: string, filePath: string): Promise<number[]> {
  const cacheDir = join(tmpdir(), 'ai-video-editor', clipId)
  mkdirSync(cacheDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const passThrough = new PassThrough()

    passThrough
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', () => {
        const buffer = Buffer.concat(chunks)
        const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)

        // Downsample to ~10000 points for rendering
        const targetPoints = 10000
        const step = Math.max(1, Math.floor(floatArray.length / targetPoints))
        const result: number[] = []

        for (let i = 0; i < floatArray.length; i += step) {
          let max = 0
          for (let j = i; j < Math.min(i + step, floatArray.length); j++) {
            max = Math.max(max, Math.abs(floatArray[j]))
          }
          result.push(max)
        }

        resolve(result)
      })
      .on('error', reject)

    ffmpeg(filePath)
      .audioChannels(1)
      .audioFrequency(8000)
      .audioFilters('aformat=sample_fmts=flt')
      .format('f32le')
      .on('error', reject)
      .pipe(passThrough)
  })
}
