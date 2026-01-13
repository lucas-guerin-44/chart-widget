import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

interface Settings {
  instrument: string;
  apiKey: string;
  timezone: string;
  refreshInterval: number; // in seconds
  accentColor: string;
  miniMode: boolean;
  opacity: number; // 0.1 to 1.0
}

const defaultSettings: Settings = {
  instrument: 'XAU/USD',
  apiKey: '',
  timezone: '',
  refreshInterval: 60,
  accentColor: '#E0E8FF',
  miniMode: false,
  opacity: 0.75,
};

// Store normal bounds when switching to mini mode
let normalBounds: { width: number; height: number } | null = null;
const MINI_WIDTH = 140;
const MINI_HEIGHT = 54;

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): Settings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return defaultSettings;
}

function saveSettings(settings: Settings): void {
  try {
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 300,
    minWidth: 320,
    minHeight: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    icon: path.join(__dirname, '..', '..', 'icons', 'icons', 'win', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const createSettingsWindow = () => {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 350,
    height: 540,
    frame: false,
    transparent: true,
    resizable: false,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/settings.html`);
  } else {
    settingsWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/settings.html`),
    );
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
};

// IPC Handlers
ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (_event, settings: Settings) => {
  saveSettings(settings);
  if (mainWindow) {
    mainWindow.webContents.send('settings-updated', settings);
  }
  return true;
});

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

ipcMain.on('close-settings', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.on('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('toggle-mini-mode', (_event, enableMini: boolean) => {
  if (!mainWindow) return;

  const bounds = mainWindow.getBounds();

  if (enableMini) {
    // Save current bounds before going mini
    normalBounds = { width: bounds.width, height: bounds.height };
    mainWindow.setResizable(false);
    mainWindow.setMinimumSize(MINI_WIDTH, MINI_HEIGHT);
    mainWindow.setMaximumSize(MINI_WIDTH, MINI_HEIGHT);
    mainWindow.setSize(MINI_WIDTH, MINI_HEIGHT);
  } else {
    // Restore to normal size
    const width = normalBounds?.width || 500;
    const height = normalBounds?.height || 300;
    mainWindow.setMaximumSize(0, 0);
    mainWindow.setMinimumSize(300, 200);
    mainWindow.setSize(width, height);
    mainWindow.setResizable(true);
  }
});

ipcMain.handle('get-window-bounds', () => mainWindow?.getBounds());

ipcMain.on('resize-window', (_event, dx: number, dy: number, direction: string) => {
  if (!mainWindow) return;

  const bounds = mainWindow.getBounds();
  const minWidth = 320;
  const minHeight = 200;

  let { x, y, width, height } = bounds;

  if (direction.includes('e')) {
    width = Math.max(minWidth, width + dx);
  }
  if (direction.includes('w')) {
    const newWidth = Math.max(minWidth, width - dx);
    x = x + (width - newWidth);
    width = newWidth;
  }
  if (direction.includes('s')) {
    height = Math.max(minHeight, height + dy);
  }
  if (direction.includes('n')) {
    const newHeight = Math.max(minHeight, height - dy);
    y = y + (height - newHeight);
    height = newHeight;
  }

  mainWindow.setBounds({ x, y, width, height });
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
