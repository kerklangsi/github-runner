const fs = require('fs');
const path = require('path');

const LOG_LEVEL_PRIORITY = { ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 };

// Parses standard log level tag from log string.
function parseLevel(line) {
  if (/\[ERROR\]|\[ERR\]/i.test(line)) return 'ERROR';
  if (/\[WARN\]|\[WARNING\]/i.test(line)) return 'WARN';
  if (/\[DEBUG\]|\[DBG\]|\[TRACE\]|\[TRC\]/i.test(line)) return 'DEBUG';
  return 'INFO';
}

// Filters lines by minimum priority threshold.
function filterLevel(lines, minLevel = 'INFO') {
  const maxPriority = LOG_LEVEL_PRIORITY[minLevel.toUpperCase()] || 3;
  return lines.filter(line => {
    const lineLevel = parseLevel(line);
    const linePriority = LOG_LEVEL_PRIORITY[lineLevel] || 3;
    return linePriority <= maxPriority;
  });
}

// Splits raw text into clean non-empty lines.
function collapseLines(rawContent) {
  if (!rawContent) return [];
  return rawContent.split('\n').map(l => l.replace(/\r$/, '').trim()).filter(l => l.length > 0);
}

// Fills missing timestamps in runner log lines using adjacent events.
function fillTimes(lines, fallbackTime) {
  if (!lines || lines.length === 0) return [];
  const entries = lines.map(line => {
    const netMatch = line.match(/^\[(?:(?:RUNNER|WORKER)\s+)?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+([A-Z]{3,5})\s+([^\]]+)\]\s*(.*)/s);
    if (netMatch) {
      const lvl = netMatch[2].toUpperCase() === 'ERR' ? 'ERROR' : netMatch[2].toUpperCase();
      return {
        raw: line,
        ts: netMatch[1].replace(' ', 'T'),
        content: `[${lvl}] [${netMatch[3].trim()}] ${netMatch[4].trim()}`
      };
    }
    const match = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)[: ]\s*(.*)/);
    return {
      raw: line,
      ts: match ? match[1].replace(' ', 'T') : null,
      content: match ? match[2] : line
    };
  });

  let nextTs = null;
  let nextIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].ts) {
      nextTs = entries[i].ts;
      nextIdx = i;
    } else if (nextTs) {
      const baseMs = Date.parse(nextTs.endsWith('Z') ? nextTs : nextTs + 'Z');
      const offsetMs = Math.max(0, (nextIdx - i)) * 1000;
      const targetDate = new Date(baseMs - offsetMs);
      entries[i].ts = targetDate.toISOString().replace('.000Z', 'Z');
    }
  }

  let prevTs = null;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].ts) prevTs = entries[i].ts;
    else if (prevTs) entries[i].ts = prevTs;
    else entries[i].ts = fallbackTime || new Date().toISOString();
  }

  return entries.map(e => `${e.ts.replace('T', ' ')}: ${e.content}`);
}

// Retrieves normalized runner daemon logs from disk.
function getDaemonLogs(runnerId, options = {}) {
  const runnerService = require('./runnerService');
  const runner = runnerService.getRunnerById(id => id === runnerId ? runnerId : null) || runnerService.getRunnerById(runnerId);

  const defaultBase = process.env.RUNNER_DIR || process.env.RUNNERS_DIR || (fs.existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners');
  let runnerDir = runner ? (runner.dir || runner.runner_dir || runner.runnerDir || path.join(defaultBase, runner.name || runnerId)) : null;

  if (!runnerDir || !fs.existsSync(runnerDir)) {
    const archivePath = path.join(process.env.DATA_DIR || '/app/data', 'archived-logs', runnerId);
    if (fs.existsSync(archivePath)) runnerDir = archivePath;
    else return { lines: ['Runner daemon logs not found.'], source: 'daemon', hasWorkflowLogs: false };
  }

  const logFile = path.join(runnerDir, 'logs', 'runner.log');
  let lines = [];

  if (fs.existsSync(logFile)) {
    const raw = fs.readFileSync(logFile, 'utf-8');
    lines = collapseLines(raw);
    const mtime = fs.statSync(logFile).mtime.toISOString();
    const fallbackTime = (runner && runner.createdDate) ? runner.createdDate : mtime;
    lines = fillTimes(lines, fallbackTime);
  }

  let diagDir = path.join(runnerDir, 'actions-runner', '_diag');
  if (!fs.existsSync(diagDir) && fs.existsSync(path.join(runnerDir, '_diag'))) {
    diagDir = path.join(runnerDir, '_diag');
  }

  if (fs.existsSync(diagDir)) {
    const files = fs.readdirSync(diagDir).filter(f => f.startsWith('Runner_') || f.startsWith('Worker_'));
    if (files.length > 0) {
      files.sort((a, b) => fs.statSync(path.join(diagDir, b)).mtimeMs - fs.statSync(path.join(diagDir, a)).mtimeMs);
      const requestedLevel = (options.level || 'INFO').toUpperCase();

      if (requestedLevel === 'DEBUG' || requestedLevel === 'ALL') {
        for (const file of files.slice(0, 3)) {
          const diagRaw = fs.readFileSync(path.join(diagDir, file), 'utf-8');
          const diagLines = collapseLines(diagRaw);
          lines = lines.concat(diagLines.slice(-100));
        }
      }
    }
  }

  if (options.search) {
    const query = options.search.toLowerCase();
    lines = lines.filter(l => l.toLowerCase().includes(query));
  }

  if (options.level && options.level !== 'DEBUG' && options.level !== 'ALL') {
    lines = filterLevel(lines, options.level);
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 300;
  return {
    lines: lines.slice(-limit),
    source: 'daemon',
    hasWorkflowLogs: fs.existsSync(path.join(runnerDir, 'logs', 'job-logs.txt')) && fs.statSync(path.join(runnerDir, 'logs', 'job-logs.txt')).size > 0
  };
}

// Clears daemon log file for a specific runner directory.
function clearDaemon(runnerDir) {
  if (!runnerDir || !fs.existsSync(runnerDir)) return;
  const logFile = path.join(runnerDir, 'logs', 'runner.log');
  if (fs.existsSync(logFile)) fs.writeFileSync(logFile, '');
}

module.exports = {
  parseLevel,
  filterLevel,
  collapseLines,
  fillTimes,
  getDaemonLogs,
  clearDaemon,
  getRunnerLogs: getDaemonLogs
};
