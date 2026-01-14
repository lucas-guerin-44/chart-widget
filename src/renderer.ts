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
  alerts?: Record<string, number[]>; // instrument -> price alerts
  timeframe?: string; // 1min, 5min, 15min, 30min, 1h, 4h, 1day
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

// Crosshair state
let crosshairX: number | null = null;
let crosshairY: number | null = null;
let ctrlPressed = false;

// Alert lines (stored as price values)
let alertLines: number[] = [];
let lastPrice: number | null = null;
let draggingAlertIndex: number | null = null;

function saveAlerts() {
  if (!settings.alerts) settings.alerts = {};
  settings.alerts[settings.instrument] = alertLines;
  window.electronAPI.saveSettings(settings);
}

function loadAlerts() {
  alertLines = settings.alerts?.[settings.instrument] ?? [];
}

// Audio context for alert sounds
let audioCtx: AudioContext | null = null;

function playAlertSound() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.frequency.value = 880;
  oscillator.type = 'sine';

  gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

  oscillator.start(audioCtx.currentTime);
  oscillator.stop(audioCtx.currentTime + 0.3);
}

function showAlertNotification(alertPrice: number, direction: 'up' | 'down') {
  const arrow = direction === 'up' ? '↑' : '↓';
  const action = direction === 'up' ? 'crossed above' : 'crossed below';
  new Notification(`${settings.instrument} ${arrow}`, {
    body: `Price ${action} $${alertPrice.toFixed(2)}`,
    silent: true, // We play our own sound
  });
}

function checkPriceAlerts(currentPrice: number) {
  if (lastPrice === null) {
    lastPrice = currentPrice;
    return;
  }

  for (const alertPrice of alertLines) {
    const crossedFromBelow = lastPrice < alertPrice && currentPrice >= alertPrice;
    const crossedFromAbove = lastPrice > alertPrice && currentPrice <= alertPrice;

    if (crossedFromBelow) {
      playAlertSound();
      showAlertNotification(alertPrice, 'up');
    } else if (crossedFromAbove) {
      playAlertSound();
      showAlertNotification(alertPrice, 'down');
    }
  }

  lastPrice = currentPrice;
}

// Crosshair and alert lines plugin
const crosshairPlugin = {
  id: 'crosshair',
  afterDraw(chartInstance: Chart) {
    const { ctx, chartArea, scales } = chartInstance;
    const { left, right, top, bottom } = chartArea;
    const yScale = scales.y;

    // Draw alert lines (always visible)
    for (const alertPrice of alertLines) {
      const y = yScale.getPixelForValue(alertPrice);
      if (y >= top && y <= bottom) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw crosshair (only when Ctrl is pressed)
    if (!ctrlPressed || crosshairX === null || crosshairY === null) return;

    // Check if mouse is within chart area
    if (crosshairX < left || crosshairX > right || crosshairY < top || crosshairY > bottom) return;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(crosshairX, top);
    ctx.lineTo(crosshairX, bottom);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(left, crosshairY);
    ctx.lineTo(right, crosshairY);
    ctx.stroke();

    ctx.restore();
  },
};

Chart.register(crosshairPlugin);

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
const timeframeEl = document.querySelector('.timeframe') as HTMLSpanElement;
const timeframeDropdown = document.querySelector('.timeframe-dropdown') as HTMLDivElement;
const timeframeOptions = document.querySelectorAll('.timeframe-option') as NodeListOf<HTMLDivElement>;

closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
settingsBtn.addEventListener('click', () => window.electronAPI.openSettings());

// Timeframe dropdown toggle
timeframeEl.addEventListener('click', (e) => {
  e.stopPropagation();
  timeframeDropdown.classList.toggle('open');
  updateTimeframeActiveState();
});

// Close dropdown when clicking outside
document.addEventListener('click', () => {
  timeframeDropdown.classList.remove('open');
});

// Prevent dropdown clicks from closing it
timeframeDropdown.addEventListener('click', (e) => {
  e.stopPropagation();
});

function updateTimeframeActiveState() {
  const current = getTimeframe();
  timeframeOptions.forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.value === current);
  });
}

function selectTimeframe(value: string) {
  settings.timeframe = value;
  timeframeEl.textContent = value;
  timeframeDropdown.classList.remove('open');
  window.electronAPI.saveSettings(settings);

  // Clear cached data and refetch with new timeframe
  lastSuccessfulData = null;
  alertLines = [];
  lastPrice = null;
  saveAlerts();
  if (chart) {
    chart.destroy();
    chart = null;
  }
  refreshData();
}

// Timeframe option click handlers
timeframeOptions.forEach((opt) => {
  opt.addEventListener('click', () => {
    const value = opt.dataset.value;
    if (value) {
      selectTimeframe(value);
    }
  });
});

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

const TIMEFRAMES = ['1min', '5min', '15min', '30min', '1h', '4h', '1day'] as const;

function getTimeframe(): string {
  return settings.timeframe && TIMEFRAMES.includes(settings.timeframe as any)
    ? settings.timeframe
    : '5min';
}

async function fetchPriceData(): Promise<TimeSeriesValue[] | null> {
  const timezone = getTimezone();
  const symbol = encodeURIComponent(settings.instrument);
  const interval = getTimeframe();
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=50&timezone=${encodeURIComponent(timezone)}&apikey=${settings.apiKey}`;

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

  const currentPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const change = ((currentPrice - firstPrice) / firstPrice) * 100;

  // Check if price crossed any alert lines
  checkPriceAlerts(currentPrice);

  // Remove alerts that are outside the current price range
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = (maxPrice - minPrice) * 0.1; // Chart.js adds ~10% padding
  const prevLength = alertLines.length;
  alertLines = alertLines.filter(
    (price) => price >= minPrice - padding && price <= maxPrice + padding
  );
  if (alertLines.length !== prevLength) {
    saveAlerts();
  }

  priceEl.textContent = currentPrice.toFixed(2);
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
              callback: (value) => `$${Number(value).toFixed(2)}`,
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

function updateTimeframeDisplay() {
  timeframeEl.textContent = getTimeframe();
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
  updateTimeframeDisplay();
  updateOpacity();
  loadAlerts();

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

// Helper to find alert near a y position
function findAlertIndexAtY(y: number): number {
  if (!chart) return -1;
  const { scales } = chart;
  const priceRange = scales.y.max - scales.y.min;
  const tolerance = priceRange * 0.02;
  const price = scales.y.getValueForPixel(y);
  if (price === undefined) return -1;
  return alertLines.findIndex((p) => Math.abs(p - price) < tolerance);
}

// Crosshair event listeners
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  crosshairX = e.clientX - rect.left;
  crosshairY = e.clientY - rect.top;

  // Handle dragging alert lines (no Ctrl needed once dragging)
  if (draggingAlertIndex !== null && chart) {
    const { chartArea, scales } = chart;
    const clampedY = Math.max(chartArea.top, Math.min(chartArea.bottom, crosshairY));
    const newPrice = scales.y.getValueForPixel(clampedY);
    if (newPrice !== undefined) {
      alertLines[draggingAlertIndex] = newPrice;
      chart.draw();
    }
    return;
  }

  // Update cursor when hovering over alert lines
  if (chart) {
    const alertIdx = findAlertIndexAtY(crosshairY);
    if (alertIdx !== -1) {
      canvas.style.cursor = 'ns-resize';
    } else if (ctrlPressed) {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = 'default';
    }
  }

  if (ctrlPressed && chart) {
    chart.draw();
  }
});

// Mouse down to start dragging (no Ctrl needed)
canvas.addEventListener('mousedown', (e) => {
  if (!chart) return;

  const rect = canvas.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const { chartArea } = chart;

  if (y < chartArea.top || y > chartArea.bottom) return;

  const alertIdx = findAlertIndexAtY(y);
  if (alertIdx !== -1 && !ctrlPressed) {
    // Start dragging existing alert (only if NOT Ctrl, to allow Ctrl+Click delete)
    draggingAlertIndex = alertIdx;
    e.preventDefault();
  }
});

// Mouse up to finish dragging or handle Ctrl+Click actions
canvas.addEventListener('mouseup', (e) => {
  if (!chart) return;

  const rect = canvas.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const { chartArea, scales } = chart;

  // Finish dragging (save the new position)
  if (draggingAlertIndex !== null) {
    draggingAlertIndex = null;
    saveAlerts();
    chart.draw();
    return;
  }

  // Ctrl+Click actions
  if (!ctrlPressed) return;

  // Check if click is within chart area
  if (y < chartArea.top || y > chartArea.bottom) return;

  const clickedPrice = scales.y.getValueForPixel(y);
  if (clickedPrice === undefined) return;

  // Check if clicking near an existing alert line
  const alertIdx = findAlertIndexAtY(y);

  if (alertIdx !== -1) {
    // Ctrl+Click on existing alert = delete
    alertLines.splice(alertIdx, 1);
  } else {
    // Ctrl+Click on empty space = add new alert
    alertLines.push(clickedPrice);
  }

  saveAlerts();
  chart.draw();
});

canvas.addEventListener('mouseleave', () => {
  crosshairX = null;
  crosshairY = null;
  draggingAlertIndex = null;
  canvas.style.cursor = 'default';
  if (chart) {
    chart.draw();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Control' && !ctrlPressed) {
    ctrlPressed = true;
    if (chart) {
      chart.draw();
    }
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') {
    ctrlPressed = false;
    draggingAlertIndex = null;
    canvas.style.cursor = 'default';
    if (chart) {
      chart.draw();
    }
  }
});

// Listen for settings updates
window.electronAPI.onSettingsUpdated((newSettings: Settings) => {
  const instrumentChanged = settings.instrument !== newSettings.instrument;
  const intervalChanged = settings.refreshInterval !== newSettings.refreshInterval;
  settings = newSettings;
  updateTitle();
  updateOpacity();

  if (instrumentChanged) {
    lastSuccessfulData = null;
    lastPrice = null;
    loadAlerts(); // Load alerts for the new instrument
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
