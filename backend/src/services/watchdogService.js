'use strict';
const globalLog = require('./globalLog');

let watchdogTimer = null;
let watchdogSettings = { enabled: false, intervalSec: 30 };

// Updates watchdog settings and restarts background timer.
function updateSettings(settings) {
  watchdogSettings = {
    enabled: !!settings.watchdogEnabled,
    intervalSec: parseInt(settings.watchdogIntervalSec, 10) || 30
  };
  restartWatchdog();
}

// Restarts background watchdog monitoring timer according to configured interval.
function restartWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (watchdogSettings.enabled) {
    watchdogTimer = setInterval(runWatchdog, watchdogSettings.intervalSec * 1000);
    globalLog.writeLog('INFO', `Auto-Restart Watchdog started (interval: ${watchdogSettings.intervalSec}s)`);
  }
}

// Checks offline or crashed runners and triggers automatic restart.
async function runWatchdog() {
  try {
    const runnerService = require('./runnerService');
    const runners = runnerService.getAllRunners();
    for (const runner of runners) {
      if (!runner.watchdog) continue;
      const status = runner.status;
      if (status === 'OFFLINE' || status === 'CRASHED' || status === 'ERROR') {
        globalLog.writeLog('WARN', `[Watchdog] Runner '${runner.name}' is ${status} - auto-restarting...`);
        try {
          await runnerService.startRunner(runner.id);
          globalLog.writeLog('INFO', `[Watchdog] Runner '${runner.name}' restart triggered.`);
        } catch (e) {
          globalLog.writeLog('ERROR', `[Watchdog] Failed to restart '${runner.name}': ${e.message}`);
        }
      }
    }
  } catch (e) {
    globalLog.writeLog('ERROR', `[Watchdog] Error during watchdog cycle: ${e.message}`);
  }
}

module.exports = { updateSettings, restartWatchdog };
