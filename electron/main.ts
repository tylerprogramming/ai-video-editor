import { app, BrowserWindow, protocol, net } from 'electron'
import { join, extname } from 'path'
import { pathToFileURL } from 'url'
import { stat, open } from 'fs/promises'
import { createReadStream } from 'fs'
import { registerMediaIpc } from './ipc/media.ipc'

// Must be called before app.whenReady().
// secure + stream + supportFetchAPI: required for <video> elements to accept app:// URLs
// standard: intentionally OMITTED — standard:true lowercases the percent-encoded path
// (treats it as a hostname), breaking macOS paths like /Users/Tyler/...
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    secure: true,
    stream: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}])

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // Proper range-request handler — net.fetch with file:// does not honour Range headers,
  // causing video.currentTime seeks to silently fail (browser resets to 0).
  // We read the requested byte range directly from disk and return a real 206 response.
  protocol.handle('app', async (request) => {
    const rawPath = request.url.slice('app://'.length)
    const filePath = decodeURIComponent(rawPath)
    const mimeType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const rangeHeader = request.headers.get('range')

    try {
      const { size: totalSize } = await stat(filePath)

      if (!rangeHeader) {
        // No range — serve the full file as a stream
        const stream = nodeStreamToWeb(createReadStream(filePath))
        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(totalSize),
            'Accept-Ranges': 'bytes',
          },
        })
      }

      // Parse "Range: bytes=start-end"
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (!match) {
        return new Response('Invalid Range', {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        })
      }

      const start = parseInt(match[1])
      const end = match[2] ? Math.min(parseInt(match[2]), totalSize - 1) : totalSize - 1

      if (start > totalSize - 1) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        })
      }

      const chunkSize = end - start + 1
      const stream = nodeStreamToWeb(createReadStream(filePath, { start, end }))

      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': mimeType,
        },
      })
    } catch (err: any) {
      console.error('[app://] Failed to serve:', filePath, err.message)
      return new Response('Not found', { status: 404 })
    }
  })

  const win = createWindow()
  registerMediaIpc(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Convert a Node.js ReadStream to a Web ReadableStream for use in Response body
function nodeStreamToWeb(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer | string) => {
        controller.enqueue(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new TextEncoder().encode(chunk as string))
      })
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err) => controller.error(err))
    },
    cancel() {
      (nodeStream as any).destroy?.()
    },
  })
}
