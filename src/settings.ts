import './settings.css';

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
      closeSettings: () => void;
    };
  }
}

const form = document.getElementById('settings-form') as HTMLFormElement;
const instrumentInput = document.getElementById('instrument') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const timezoneSelect = document.getElementById('timezone') as HTMLSelectElement;
const refreshIntervalInput = document.getElementById('refreshInterval') as HTMLInputElement;
const apiCallsPerHourDisplay = document.getElementById('apiCallsPerHour') as HTMLSpanElement;
const apiCallsPerDayDisplay = document.getElementById('apiCallsPerDay') as HTMLSpanElement;
const accentColorInput = document.getElementById('accentColor') as HTMLInputElement;
const colorPresets = document.querySelectorAll('.color-preset') as NodeListOf<HTMLButtonElement>;
const opacityInput = document.getElementById('opacity') as HTMLInputElement;
const opacityValueDisplay = document.getElementById('opacityValue') as HTMLSpanElement;
const closeBtn = document.getElementById('close') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel') as HTMLButtonElement;

let currentSettings: Settings | null = null;

function updateApiCallsEstimate() {
  const interval = parseInt(refreshIntervalInput.value) || 60;
  const callsPerHour = Math.floor(3600 / interval);
  const callsPerDay = Math.floor((24 * 60 * 60) / interval);
  apiCallsPerHourDisplay.textContent = `~${callsPerHour.toLocaleString()}/hour`;
  apiCallsPerDayDisplay.textContent = `~${callsPerDay.toLocaleString()}/day`;
}

refreshIntervalInput.addEventListener('input', updateApiCallsEstimate);

// Color preset handling
function selectColor(color: string) {
  accentColorInput.value = color;
  colorPresets.forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.color === color);
  });
}

colorPresets.forEach(btn => {
  // Set background color from data attribute
  btn.style.backgroundColor = btn.dataset.color;
  btn.addEventListener('click', () => selectColor(btn.dataset.color));
});

accentColorInput.addEventListener('input', () => {
  colorPresets.forEach(btn => btn.classList.remove('selected'));
});

opacityInput.addEventListener('input', () => {
  opacityValueDisplay.textContent = `${opacityInput.value}%`;
});

closeBtn.addEventListener('click', () => window.electronAPI.closeSettings());
cancelBtn.addEventListener('click', () => window.electronAPI.closeSettings());

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings: Settings = {
    instrument: instrumentInput.value.trim() || 'XAU/USD',
    apiKey: apiKeyInput.value.trim(),
    timezone: timezoneSelect.value,
    refreshInterval: Math.max(10, parseInt(refreshIntervalInput.value) || 60),
    accentColor: accentColorInput.value,
    miniMode: currentSettings?.miniMode ?? false,
    opacity: parseInt(opacityInput.value) / 100,
  };

  await window.electronAPI.saveSettings(settings);
  window.electronAPI.closeSettings();
});

async function loadSettings() {
  currentSettings = await window.electronAPI.getSettings();
  instrumentInput.value = currentSettings.instrument || '';
  apiKeyInput.value = currentSettings.apiKey || '';
  timezoneSelect.value = currentSettings.timezone || '';
  refreshIntervalInput.value = String(currentSettings.refreshInterval || 60);
  updateApiCallsEstimate();
  selectColor(currentSettings.accentColor || '#E0E8FF');
  const opacityPercent = Math.round((currentSettings.opacity ?? 0.75) * 100);
  opacityInput.value = String(opacityPercent);
  opacityValueDisplay.textContent = `${opacityPercent}%`;
}

loadSettings();
