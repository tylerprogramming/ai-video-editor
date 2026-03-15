import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  importMedia: () => ipcRenderer.invoke('media:import'),
  getWaveform: (clipId: string, filePath: string) =>
    ipcRenderer.invoke('media:waveform', clipId, filePath),
  transcribeClip: (clipId: string, filePath: string, apiKey: string) =>
    ipcRenderer.invoke('media:transcribe', clipId, filePath, apiKey),
  transcribeTimeline: (clipId: string, filePath: string, keepRanges: { start: number; end: number }[], apiKey: string) =>
    ipcRenderer.invoke('media:transcribeTimeline', clipId, filePath, keepRanges, apiKey),
  saveTranscript: (clipId: string, data: object) =>
    ipcRenderer.invoke('media:saveTranscript', clipId, data),
  loadTranscript: (clipId: string) =>
    ipcRenderer.invoke('media:loadTranscript', clipId),
  saveEditedTranscript: (clipId: string, data: object) =>
    ipcRenderer.invoke('media:saveEditedTranscript', clipId, data),
  onMenuImport: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('menu:import', handler)
    return () => ipcRenderer.removeListener('menu:import', handler)
  },
})
