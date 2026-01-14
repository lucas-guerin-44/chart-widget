# Chart Widget

A transparent, always-on-top desktop widget that displays live ticker price charts.

## Features

- **Transparent & frameless** - Blends into your desktop
- **Always on top** - Never lose sight of your charts
- **Live data** - Real-time price updates via Twelve Data API
- **Mini mode** - Compact view showing just the price
- **Customizable** - Accent color, opacity, refresh interval, timezone
- **Timeframe selector** - Click the timeframe label to cycle through 1min, 5min, 15min, 30min, 1h, 4h, 1day
- **Crosshair** - Hold Ctrl to show a subtle crosshair on the chart
- **Price alerts** - Ctrl+Click to set alert lines; plays a sound and shows a desktop notification when price crosses them
  - Drag existing alerts to reposition them
  - Ctrl+Click on an alert to delete it
  - Alerts are persisted per instrument

## Requirements

- [Twelve Data API key](https://twelvedata.com/) (free tier available)

## Setup

1. Clone and install dependencies:
   ```bash
   npm install
   ```

2. Run the app:
   ```bash
   npm start
   ```

3. Click the settings icon and enter your Twelve Data API key

## Build

```bash
npm run make
```

## License

[Unlicense](LICENSE) - Do whatever you want with it.
