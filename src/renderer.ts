import './index.css';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface Settings {
  instrument: string;
  apiKey: string;
  timezone: string;
  refreshInterval: number;
  accentColor: string;
  miniMode: boolean;
  opacity: number;
}

declare global {
  interface Window {
    electronAPI: {
      getSettings: () => Promise<Settings>;
      saveSettings: (settings: Settings) => Promise<boolean>;
      openSettings: () => void;
      onSettingsUpdated: (callback: (settings: Settings) => void) => void;
      closeWindow: () => void;
      minimizeWindow: () => void;
      resizeWindow: (dx: number, dy: number, direction: string) => void;
      getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>;
      toggleMiniMode: (enableMini: boolean) => void;
    };
  }
}

interface TimeSeriesValue {
  datetime: string;
  close: string;
}

interface ApiResponse {
  values?: TimeSeriesValue[];
  status?: string;
  message?: string;
}

let chart: Chart | null = null;
let lastSuccessfulData: TimeSeriesValue[] | null = null;
let settings: Settings = { instrument: 'XAU/USD', apiKey: '', timezone: '', refreshInterval: 60, accentColor: '#E0E8FF', miniMode: false, opacity: 0.75 };

const titleEl = document.querySelector('.title') as HTMLSpanElement;
const priceEl = document.getElementById('title-price') as HTMLSpanElement;
const changeEl = document.getElementById('title-change') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const closeBtn = document.getElementById('close') as HTMLButtonElement;
const minimizeBtn = document.getElementById('minimize') as HTMLButtonElement;
const settingsBtn = document.getElementById('settings') as HTMLButtonElement;
const miniToggleBtn = document.getElementById('mini-toggle') as HTMLButtonElement;
const canvas = document.getElementById('chart') as HTMLCanvasElement;
const widgetEl = document.querySelector('.widget') as HTMLDivElement;
const chartContainerEl = document.querySelector('.chart-container') as HTMLDivElement;
const iconCollapse = miniToggleBtn.querySelector('.icon-collapse') as SVGElement;
const iconExpand = miniToggleBtn.querySelector('.icon-expand') as SVGElement;

closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
settingsBtn.addEventListener('click', () => window.electronAPI.openSettings());

function setMiniMode(enabled: boolean, saveState = true) {
  settings.miniMode = enabled;
  window.electronAPI.toggleMiniMode(enabled);

  if (enabled) {
    widgetEl.classList.add('mini-mode');
    chartContainerEl.style.display = 'none';
    iconCollapse.style.display = 'none';
    iconExpand.style.display = 'block';
    settingsBtn.style.display = 'none';
  } else {
    widgetEl.classList.remove('mini-mode');
    chartContainerEl.style.display = 'block';
    iconCollapse.style.display = 'block';
    iconExpand.style.display = 'none';
    settingsBtn.style.display = 'flex';
  }

  if (saveState) {
    window.electronAPI.saveSettings(settings);
  }
}

miniToggleBtn.addEventListener('click', () => {
  setMiniMode(!settings.miniMode);
});

// Resize handles
document.querySelectorAll('.resize-handle').forEach((handle) => {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const classList = (handle as HTMLElement).classList;
    const directions = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
    const direction = directions.find((d) => classList.contains(`resize-${d}`));
    if (!direction) return;

    let lastX = (e as MouseEvent).screenX;
    let lastY = (e as MouseEvent).screenY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.screenX - lastX;
      const dy = moveEvent.screenY - lastY;
      lastX = moveEvent.screenX;
      lastY = moveEvent.screenY;
      window.electronAPI.resizeWindow(dx, dy, direction);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
});

function getTimezone(): string {
  return settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 224, g: 232, b: 255 }; // fallback
}

function getAccentRgba(alpha: number): string {
  const { r, g, b } = hexToRgb(settings.accentColor);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

async function fetchPriceData(): Promise<TimeSeriesValue[] | null> {
  const timezone = getTimezone();
  const symbol = encodeURIComponent(settings.instrument);
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=5min&outputsize=50&timezone=${encodeURIComponent(timezone)}&apikey=${settings.apiKey}`;

  try {
    const response = await fetch(url);
    const data: ApiResponse = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'API error');
    }

    if (data.values && data.values.length > 0) {
      lastSuccessfulData = data.values;
      statusEl.textContent = '';
      return data.values;
    }

    throw new Error('No data received');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    statusEl.textContent = `Error: ${message}`;
    return lastSuccessfulData;
  }
}

function updateChart(values: TimeSeriesValue[]) {
  const reversed = [...values].reverse();
  const labels = reversed.map(v => {
    // Extract HH:MM from datetime string (format: "YYYY-MM-DD HH:MM:SS")
    const timePart = v.datetime.split(' ')[1];
    return timePart ? timePart.slice(0, 5) : '';
  });
  const prices = reversed.map(v => parseFloat(v.close));

  const lastPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const change = ((lastPrice - firstPrice) / firstPrice) * 100;

  priceEl.textContent = lastPrice.toFixed(2);
  changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
  changeEl.className = `title-change ${change >= 0 ? 'positive' : 'negative'}`;

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = prices;
    chart.data.datasets[0].borderColor = settings.accentColor;
    (chart.data.datasets[0] as any).pointHoverBackgroundColor = settings.accentColor;
    chart.options.plugins.tooltip.bodyColor = settings.accentColor;
    // Recreate gradient with new color
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, getAccentRgba(0.15));
    gradient.addColorStop(0.5, getAccentRgba(0.05));
    gradient.addColorStop(1, getAccentRgba(0));
    chart.data.datasets[0].backgroundColor = gradient;
    chart.update('none');
  } else {
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, getAccentRgba(0.15));
    gradient.addColorStop(0.5, getAccentRgba(0.05));
    gradient.addColorStop(1, getAccentRgba(0));

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: prices,
          borderColor: settings.accentColor,
          borderWidth: 2,
          fill: true,
          backgroundColor: gradient,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: settings.accentColor,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(20, 20, 20, 0.9)',
            titleColor: '#fff',
            bodyColor: settings.accentColor,
            displayColors: false,
            callbacks: {
              label: (ctx) => `$${ctx.parsed.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            display: true,
            grid: { display: false },
            ticks: {
              color: 'rgba(255, 255, 255, 0.5)',
              font: { size: 10 },
              maxTicksLimit: 5,
            },
            border: { display: false },
          },
          y: {
            display: true,
            position: 'right',
            grid: { display: false },
            ticks: {
              color: 'rgba(255, 255, 255, 0.5)',
              font: { size: 10 },
              callback: (value) => `$${value}`,
            },
            border: { display: false },
          },
        },
        interaction: {
          intersect: false,
          mode: 'index',
        },
      },
    });
  }
}

async function refreshData() {
  const data = await fetchPriceData();
  if (data) {
    updateChart(data);
  }
}

function updateTitle() {
  titleEl.textContent = settings.instrument.replace('/', '');
}

function updateOpacity() {
  const opacity = settings.opacity ?? 0.6;
  widgetEl.style.background = `rgba(20, 20, 20, ${opacity})`;
}

let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

function startRefreshInterval() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
  }
  const intervalMs = (settings.refreshInterval || 60) * 1000;
  refreshIntervalId = setInterval(refreshData, intervalMs);
}

async function init() {
  settings = await window.electronAPI.getSettings();
  updateTitle();
  updateOpacity();

  // Restore mini mode state if it was enabled (don't re-save)
  if (settings.miniMode) {
    setMiniMode(true, false);
  }

  if (!settings.apiKey) {
    statusEl.textContent = 'Error: API key not configured. Click the gear icon to set it.';
    return;
  }

  await refreshData();
  startRefreshInterval();
}

// Listen for settings updates
window.electronAPI.onSettingsUpdated((newSettings: Settings) => {
  const instrumentChanged = settings.instrument !== newSettings.instrument;
  const intervalChanged = settings.refreshInterval !== newSettings.refreshInterval;
  settings = newSettings;
  updateTitle();
  updateOpacity();

  if (instrumentChanged) {
    lastSuccessfulData = null;
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  if (settings.apiKey) {
    statusEl.textContent = '';
    refreshData();
    if (intervalChanged) {
      startRefreshInterval();
    }
  }
});

init();
