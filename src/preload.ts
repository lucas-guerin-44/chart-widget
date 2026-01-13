import { contextBridge, ipcRenderer } from 'electron';

export interface Settings {
  instrument: string;
  apiKey: string;
  timezone: string;
  refreshInterval: number;
  accentColor: string;
  miniMode: boolean;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings') as Promise<Settings>,
  saveSettings: (settings: Settings) => ipcRenderer.invoke('save-settings', settings),
  openSettings: () => ipcRenderer.send('open-settings'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  onSettingsUpdated: (callback: (settings: Settings) => void) => {
    ipcRenderer.on('settings-updated', (_event, settings) => callback(settings));
  },

  // Window controls
  closeWindow: () => ipcRenderer.send('close-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  resizeWindow: (dx: number, dy: number, direction: string) =>
    ipcRenderer.send('resize-window', dx, dy, direction),
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  toggleMiniMode: (enableMini: boolean) => ipcRenderer.send('toggle-mini-mode', enableMini),
});
