const fs = require('fs');
const path = require('path');
// runnerService is required lazily inside getGlobalLogs() to avoid circular dependency

const LOG_LEVEL_PRIORITY = {
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4
};

const SYSTEM_LOG_PATH = process.env.SYSTEM_LOG_PATH || path.join(process.env.DATA_DIR || '/app/data', 'system.log');
const DOCKER_LOG_PATH = path.join(process.env.DATA_DIR || '/app/data', 'docker.log');
const DEFAULT_RUNNER_DIR = process.env.RUNNER_DIR || process.env.RUNNERS_DIR || (fs.existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners');

function appendDockerLog(message) {
  const dir = path.dirname(DOCKER_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.appendFileSync(DOCKER_LOG_PATH, `[${now}] ${message}\n`);
}

// Hook console.log and console.error to capture Docker container logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = function (...args) {
  originalConsoleLog.apply(console, args);
  appendDockerLog(`[INFO] ${args.join(' ')}`);
};
console.error = function (...args) {
  originalConsoleError.apply(console, args);
  appendDockerLog(`[ERROR] ${args.join(' ')}`);
};

function addSystemLog(level = 'INFO', message = '') {
  const dir = path.dirname(SYSTEM_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Strip internal (PID: N) annotations before persisting
  const cleanMsg = message.replace(/\s*\(PID:\s*\d+\)/g, '');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${now}] [${level.toUpperCase()}] ${cleanMsg}\n`;
  fs.appendFileSync(SYSTEM_LOG_PATH, line);
}

const trackedOffsets = {};
const activeTimelines = {};
let isHarvesting = false;

// Harvests live step chunk pages from actions-runner into persistent job-logs.txt.
function harvestLogs() {
  if (isHarvesting) return;
  isHarvesting = true;
  try {
    const runners = db.getRunners();
    runners.forEach(runner => {
      const runnerDir = runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runner.id);
      const diagPages = path.join(runnerDir, 'actions-runner', '_diag', 'pages');
      if (!fs.existsSync(diagPages)) return;

      let pageFiles;
      try {
        pageFiles = fs.readdirSync(diagPages).filter(f => f.endsWith('.log'));
      } catch (e) { return; }
      if (!pageFiles || pageFiles.length === 0) return;

      pageFiles.sort((a, b) => {
        try {
          const partsA = a.replace(/\.log$/, '').split('_');
          const partsB = b.replace(/\.log$/, '').split('_');
          if (partsA.length >= 3 && partsB.length >= 3 && partsA[1] === partsB[1]) {
            const pageA = parseInt(partsA[2], 10);
            const pageB = parseInt(partsB[2], 10);
            if (!isNaN(pageA) && !isNaN(pageB)) return pageA - pageB;
          }
          return fs.statSync(path.join(diagPages, a)).mtimeMs - fs.statSync(path.join(diagPages, b)).mtimeMs;
        } catch (e) { return 0; }
      });

      const logsDir = path.join(runnerDir, 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const jobLogPath = path.join(logsDir, 'job-logs.txt');
      const workflowsDir = path.join(logsDir, 'workflows');
      if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });

      pageFiles.forEach(file => {
        const fullPath = path.join(diagPages, file);
        const parts = file.split('_');
        const timelineId = parts[0];

        if (activeTimelines[runner.id] && activeTimelines[runner.id] !== timelineId && fs.existsSync(jobLogPath)) {
          try {
            const stat = fs.statSync(jobLogPath);
            if (stat.size > 0) {
              const stamp = new Date().toISOString().replace(/[:.]/g, '-');
              fs.copyFileSync(jobLogPath, path.join(workflowsDir, `workflow_${stamp}_${activeTimelines[runner.id]}.log`));
              fs.writeFileSync(jobLogPath, '');
            }
          } catch (e) {}
        }
        activeTimelines[runner.id] = timelineId;

        try {
          const stat = fs.statSync(fullPath);
          const currentOffset = trackedOffsets[fullPath] || 0;
          if (stat.size > currentOffset) {
            const fd = fs.openSync(fullPath, 'r');
            const bytesToRead = stat.size - currentOffset;
            const buffer = Buffer.alloc(bytesToRead);
            fs.readSync(fd, buffer, 0, bytesToRead, currentOffset);
            fs.closeSync(fd);

            trackedOffsets[fullPath] = stat.size;
            let text = buffer.toString('utf-8');
            if (currentOffset === 0 && text.charCodeAt(0) === 0xFEFF) {
              text = text.slice(1);
            }
            if (text.length > 0) {
              fs.appendFileSync(jobLogPath, text);
            }
          }
        } catch (e) {}
      });
    });

    Object.keys(trackedOffsets).forEach(fp => {
      if (!fs.existsSync(fp)) delete trackedOffsets[fp];
    });
  } catch (e) {} finally {
    isHarvesting = false;
  }
}

// Pre-populates tracked offsets on startup to prevent re-reading existing page chunks.
function initOffsets() {
  try {
    const runners = db.getRunners();
    runners.forEach(runner => {
      const runnerDir = runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runner.id);
      const diagPages = path.join(runnerDir, 'actions-runner', '_diag', 'pages');
      if (!fs.existsSync(diagPages)) return;

      let pageFiles;
      try {
        pageFiles = fs.readdirSync(diagPages).filter(f => f.endsWith('.log'));
      } catch (e) { return; }

      pageFiles.forEach(file => {
        const fullPath = path.join(diagPages, file);
        try {
          const stat = fs.statSync(fullPath);
          trackedOffsets[fullPath] = stat.size;
          const parts = file.split('_');
          activeTimelines[runner.id] = parts[0];
        } catch (e) {}
      });
    });
  } catch (e) {}
}

// Checks whether any registered runner is currently executing a job.
function checkBusy() {
  try {
    const runnerService = require('./runnerService');
    const runners = runnerService.getAllRunners();
    return runners.some(r => r.status === 'BUSY');
  } catch (e) {
    return false;
  }
}

let harvesterTimer = null;

// Starts the adaptive background log harvester triggered on busy mode.
function startHarvester() {
  initOffsets();
  if (harvesterTimer) clearInterval(harvesterTimer);
  harvesterTimer = setInterval(() => {
    if (checkBusy()) {
      harvestLogs();
    }
  }, 1000);
}

// Suppresses consecutive duplicate lines comparing message body after timestamp.
function dedupeLines(lines) {
  const clean = [];
  let prevBody = null;
  for (const line of lines) {
    const body = line.replace(/^(?:\[[^\]]+\]\s*)?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s*)*/, '').trim();
    if (body && body !== prevBody) {
      clean.push(line);
      prevBody = body;
    }
  }
  return clean;
}

// Filters out standard setup and cleanup steps from workflow logs.
function filterSteps(lines) {
  const IGNORED_GROUPS = [
    /set\s*up\s*job/i,
    /(actions\/)?checkout(@v\d+)?/i,
    /fetching\s*the\s*repository/i,
    /checking\s*out\s*the\s*ref/i,
    /getting\s*git\s*version/i,
    /removing\s*previously\s*created\s*refs/i,
    /disabling\s*automatic\s*garbage/i,
    /setting\s*up\s*auth/i,
    /(actions\/)?setup[\s-]*python(@v\d+)?/i,
    /installed\s*versions/i,
    /install\s*dependencies/i,
    /pip\s*install/i,
    /post\s*set[\s-]*up[\s-]*python/i,
    /post\s*(actions\/)?checkout/i,
    /complete\s*job/i,
    /github_token\s*permissions/i
  ];

  const IGNORED_STANDALONE = [
    /current\s*runner\s*version/i,
    /runner\s*name\s*:/i,
    /runner\s*group\s*name\s*:/i,
    /machine\s*name\s*:/i,
    /prepare\s*(workflow|all\s*required)/i,
    /getting\s*action\s*download/i,
    /download\s*action\s*repository/i,
    /complete\s*job\s*name\s*:/i,
    /secret\s*source\s*:/i,
    /cache\s*mode\s*:/i,
    /syncing\s*repository\s*:/i,
    /working\s*directory\s*is/i,
    /copying\s*'.*\.gitconfig'/i,
    /temporarily\s*overriding\s*HOME/i,
    /adding\s*repository\s*directory/i,
    /removing\s*(ssh\s*command|http\s*extra\s*header|includeif\s*entries)/i,
    /\[command\]\/usr\/bin\/git\s+(version|config|rev-parse|checkout|submodule|sparse-checkout|log)/i,
    /^refs\/heads\//i,
    /^HEAD is now at/i,
    /^https?:\/\/[^\s]+$/i,
    /^[0-9a-f]{40}$/i,
    /\/git-credentials-.*\.config/i,
    /requirement\s*already\s*satisfied/i,
    /installing\s*collected\s*packages/i,
    /successfully\s*installed/i,
    /shell:\s*\/usr\/bin\/bash/i,
    /env:\s*$/i,
    /^\s*(pythonLocation|PKG_CONFIG_PATH|Python\d?_ROOT_DIR|LD_LIBRARY_PATH|PYTHONUNBUFFERED):/i
  ];

  const result = [];
  let skipping = false;
  let inPostCleanup = false;

  for (let line of lines) {
    line = line.replace(/^(?:\[[^\]]+\]\s*)?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s*)+/, (match) => {
      const ts = match.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g);
      return ts ? ts[ts.length - 1] + ' ' : '';
    });
    const body = line.replace(/^(?:\[[^\]]+\]\s*)?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s*)*/, '').trim();

    if (body.includes('Post job cleanup')) {
      inPostCleanup = true;
      continue;
    }
    if (inPostCleanup) {
      if (body.includes('Current runner version') || body.includes('Prepare workflow directory')) {
        inPostCleanup = false;
      } else {
        continue;
      }
    }

    if (line.includes('##[group]')) {
      const stepTitle = line.split('##[group]')[1] || '';
      const isIgnored = IGNORED_GROUPS.some(p => p.test(stepTitle.trim()));
      if (isIgnored) {
        skipping = true;
        continue;
      } else {
        skipping = false;
      }
    } else if (line.includes('##[endgroup]')) {
      if (skipping) {
        skipping = false;
        continue;
      }
    }

    if (skipping) continue;
    if (IGNORED_STANDALONE.some(p => p.test(body))) continue;

    result.push(line);
  }

  return dedupeLines(result);
}

// Reads the latest job execution log lines from disk.
function readWorkflow(runnerDir) {
  const jobLogPath = path.join(runnerDir, 'logs', 'job-logs.txt');
  if (fs.existsSync(jobLogPath)) {
    const raw = fs.readFileSync(jobLogPath, 'utf-8');
    const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
    if (lines.length > 0) return dedupeLines(lines);
    return [];
  }
  const workflowsDir = path.join(runnerDir, 'logs', 'workflows');
  if (fs.existsSync(workflowsDir)) {
    try {
      const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.log'));
      if (files.length > 0) {
        files.sort((a, b) => fs.statSync(path.join(workflowsDir, b)).mtimeMs - fs.statSync(path.join(workflowsDir, a)).mtimeMs);
        const latest = path.join(workflowsDir, files[0]);
        const raw = fs.readFileSync(latest, 'utf-8');
        return dedupeLines(raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0));
      }
    } catch (e) {}
  }
  return [];
}


function initSystemLogs() {
  if (!fs.existsSync(SYSTEM_LOG_PATH)) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const initialLines = [
      `[${now}] [INFO] Docker container system supervisor initialized.`,
      `[${now}] [DEBUG] Memory cgroup v2 monitoring active (/sys/fs/cgroup/memory.current).`,
      `[${now}] [INFO] Express API server listening on 0.0.0.0:${process.env.PORT || 3000}.`
    ].join('\n') + '\n';
    const dir = path.dirname(SYSTEM_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SYSTEM_LOG_PATH, initialLines);
  }
}

function parseLogLevel(line) {
  const upper = line.toUpperCase();
  // Suppress noisy internal .NET entries as DEBUG regardless of level tag
  if (upper.includes('COMMANDSETTINGS') || upper.includes('DISPATCHTASK') || upper.includes('JOBDISPATCHER') || upper.includes('RUNNER LISTENER EXIT WITH TERMINATED ERROR') || upper.includes('NOT CONFIGURED. RUN CONFIG')) {
    return 'DEBUG';
  }
  // Only match explicit bracketed level tags to avoid false-positives from message content
  if (/\[ERROR\]|\[ERR\]/i.test(line)) return 'ERROR';
  if (/\[WARN\]|\[WARNING\]/i.test(line)) return 'WARN';
  if (/\[DEBUG\]|\[DBG\]|\[TRACE\]|\[TRC\]/i.test(line)) return 'DEBUG';
  return 'INFO';
}

function filterByLogLevel(lines, minLevel = 'INFO') {
  const maxPriority = LOG_LEVEL_PRIORITY[minLevel.toUpperCase()] || 3;
  return lines.filter(line => {
    const lineLevel = parseLogLevel(line);
    const linePriority = LOG_LEVEL_PRIORITY[lineLevel] || 3;
    return linePriority <= maxPriority;
  });
}

function isNetInternalTrace(line) {
  const l = line.trim();
  if (!l) return true;
  if (l.startsWith('at System.') || l.startsWith('at GitHub.') || l.startsWith('at Sdk.')) return true;
  if (l.startsWith('--- End of inner exception') || l.startsWith('--- End of stack trace')) return true;
  if (l.includes('#####################################################')) return true;
  if (l.includes('Catch exception during request')) return true;
  if (l.includes('TaskCanceledException') || l.includes('SocketException (125): Operation canceled')) return true;
  if (l.includes('Back off') && l.includes('seconds before next retry')) return true;
  return false;
}

function formatHumanSummary(line) {
  // 0. Filter out internal .NET traces and normal listener cancellations
  if (isNetInternalTrace(line)) {
    return null;
  }

  // 0a. Suppress "Configuration / Runtime Error" lines — visible in runner card status already
  if (line.includes('Configuration / Runtime Error')) {
    return null;
  }

  // 0b. Strip (PID: N) annotations — internal implementation detail
  line = line.replace(/\s*\(PID:\s*\d+\)/g, '');

  // 0c. Normalize "Runner connect error... Retrying" to WARN (recoverable reconnect, not a fatal error)
  if (line.includes('Runner connect error') && (line.includes('Retry') || line.includes('reconnect'))) {
    line = line.replace(/\[(INFO|DEBUG)(\s+[^\]]*)?\]/i, '[WARN$2]');
  }

  // Normalize cancellation warning to clean info event
  if (line.includes('has been cancelled') && line.includes('broker.actions.githubusercontent.com/message')) {
    return line.replace(/\[WARN\s+GitHubActionsService\].*?has been cancelled.*/, '[INFO GitHubActionsService] Long-poll message listener connection refreshed.');
  }

  // 1. Clean Connectivity check JSON
  if (line.includes('Connectivity check result: {')) {
    try {
      const marker = 'Connectivity check result:';
      const markerIdx = line.indexOf(marker);
      const jsonStart = line.indexOf('{');
      const jsonStr = line.slice(jsonStart).replace(/\}\.?$/, '}');
      const data = JSON.parse(jsonStr);
      const prefix = line.slice(0, markerIdx).trim();
      const endpoint = data.endpointUrl ? new URL(data.endpointUrl).hostname : 'endpoint';
      const status = (data.statusCode || 'OK').replace(/^http_/, '');
      const duration = data.httpRequestDurationInMs ? ` (${data.httpRequestDurationInMs}ms)` : '';
      return `${prefix} GitHub Connectivity: ${endpoint} -> ${status}${duration}`.trim();
    } catch (e) {
      return line.replace(/Connectivity check result: \{.*?"endpointUrl":\s*"([^"]+)".*?"statusCode":\s*"([^"]+)".*?\}/,
        (m, url, st) => `GitHub Connectivity: ${url.replace('https://', '')} -> ${st.replace('http_', '')}`);
    }
  }

  // 2. Clean Step Telemetry JSON
  if (line.includes('Publish step telemetry for current step {')) {
    try {
      const marker = 'Publish step telemetry for current step';
      const markerIdx = line.indexOf(marker);
      const jsonStart = line.indexOf('{');
      const jsonStr = line.slice(jsonStart).replace(/\}\.?$/, '}');
      const data = JSON.parse(jsonStr);
      const prefix = line.slice(0, markerIdx).trim();
      const action = data.action || 'step';
      const result = data.result || 'done';
      const time = data.executionTimeInSeconds !== undefined ? ` (${data.executionTimeInSeconds}s)` : '';
      const stage = data.stage ? ` [${data.stage}]` : '';
      return `${prefix} Step Completed: '${action}'${stage} -> ${result}${time}`.trim();
    } catch (e) {
      return line.replace(/Publish step telemetry for current step \{.*?"action":\s*"([^"]+)".*?"result":\s*"([^"]+)".*?\}/,
        (m, act, res) => `Step Completed: '${act}' -> ${res}`);
    }
  }

  // 3. Normalize .NET diagnostic log header [YYYY-MM-DD HH:MM:SSZ LEVEL Component] Message
  const diagMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+([A-Z]{3,5})\s+([^\]]+)\]\s*(.*)/s);
  if (diagMatch) {
    const [, ts, lvl, comp, rest] = diagMatch;
    const cleanLvl = lvl === 'ERR' ? 'ERROR' : lvl;
    return `${ts}: [${cleanLvl}] [${comp.trim()}] ${rest.trim()}`;
  }

  return line;
}


// Pass lines through unchanged if they already have a timestamp.
// Lines without a timestamp are left as-is — the frontend inherits
// the previous line's timestamp so we never inject a fake current-time.
function injectTimestamp(line) {
  return line; // no-op: timestamp inheritance is handled in the frontend
}

function collapseMultiLineLogs(rawContent) {
  const rawLines = rawContent.split('\n');
  const collapsed = [];
  let currentEntry = null;

  for (let line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Filter out internal .NET stack traces
    if (isNetInternalTrace(trimmed)) {
      continue;
    }

    // Check if line begins a new log event with bracket prefix, timestamp, or runner status
    const isNewEvent =
      trimmed.startsWith('[') ||
      /^\d{4}-\d{2}-\d{2}/.test(trimmed) ||
      trimmed.startsWith('√') ||
      trimmed.startsWith('Current runner version') ||
      trimmed.startsWith('An error occurred') ||
      trimmed.startsWith('Runner listener') ||
      trimmed.startsWith('A session for') ||
      trimmed.startsWith('Exiting runner');

    if (isNewEvent) {
      if (currentEntry !== null) {
        const formatted = formatHumanSummary(currentEntry);
        if (formatted) collapsed.push(injectTimestamp(formatted));
      }
      currentEntry = trimmed;
    } else {
      // Continuation line (indented JSON, closing bracket, etc.)
      if (currentEntry !== null) {
        currentEntry += ' ' + trimmed;
      } else {
        currentEntry = trimmed;
      }
    }
  }

  if (currentEntry !== null) {
    const formatted = formatHumanSummary(currentEntry);
    if (formatted) collapsed.push(injectTimestamp(formatted));
  }

  return collapsed;
}

// Retrieves filtered logs for a runner from workflow execution log or runner daemon log.
function getRunnerLogs(runnerId, options = {}) {
  const runnerService = require('./runnerService');
  const runner = runnerService.getRunnerById(runnerId);

  let runnerDir = runner ? (runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runnerId)) : null;
  if (!runnerDir || !fs.existsSync(runnerDir)) {
    const archivePath = path.join(process.env.DATA_DIR || '/app/data', 'archived-logs', runnerId);
    if (fs.existsSync(archivePath)) {
      runnerDir = archivePath;
    } else {
      return { lines: ['Runner logs not found (runner may have been deleted without archive).'], source: 'workflow', hasWorkflowLogs: false };
    }
  }

  harvestLogs();
  const requestedSource = (options.source || '').toLowerCase();
  const rawWorkflowLines = readWorkflow(runnerDir);
  const serveWorkflow = requestedSource === 'workflow' || (!requestedSource && rawWorkflowLines.length > 0) || (requestedSource !== 'daemon' && rawWorkflowLines.length > 0);

  if (serveWorkflow) {
    let resultLines = rawWorkflowLines;
    if (resultLines.length > 0 && options.raw !== 'true' && options.raw !== true) {
      resultLines = filterSteps(resultLines);
    }
    if (options.search) {
      const query = options.search.toLowerCase();
      resultLines = resultLines.filter(l => l.toLowerCase().includes(query));
    }
    const limit = options.limit ? parseInt(options.limit, 10) : 500;
    return {
      lines: resultLines.slice(-limit),
      source: 'workflow',
      hasWorkflowLogs: rawWorkflowLines.length > 0
    };
  }

// Fills missing timestamps in runner log lines using adjacent events.
function fillTimestamps(lines, fallbackTime) {
  if (!lines || lines.length === 0) return [];
  const entries = lines.map(line => {
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
    if (entries[i].ts) {
      prevTs = entries[i].ts;
    } else if (prevTs) {
      entries[i].ts = prevTs;
    } else {
      entries[i].ts = fallbackTime || new Date().toISOString();
    }
  }

  return entries.map(e => `${e.ts.replace('T', ' ')}: ${e.content}`);
}

  const logFile = path.join(runnerDir, 'logs', 'runner.log');
  let lines = [];

  if (fs.existsSync(logFile)) {
    const raw = fs.readFileSync(logFile, 'utf-8');
    lines = collapseMultiLineLogs(raw);
    const mtime = fs.statSync(logFile).mtime.toISOString();
    const fallbackTime = (runner && runner.createdDate) ? runner.createdDate : mtime;
    lines = fillTimestamps(lines, fallbackTime);
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
          const diagLines = collapseMultiLineLogs(diagRaw);
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
    lines = filterByLogLevel(lines, options.level);
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 300;
  return {
    lines: lines.slice(-limit),
    source: 'daemon',
    hasWorkflowLogs: rawWorkflowLines.length > 0
  };
}

let hasDockerCli = null;

function checkDockerCli() {
  if (hasDockerCli !== null) return hasDockerCli;
  try {
    const { execSync } = require('child_process');
    execSync('which docker', { stdio: ['pipe', 'pipe', 'ignore'] });
    hasDockerCli = true;
  } catch (e) {
    hasDockerCli = false;
  }
  return hasDockerCli;
}

function fetchDockerContainerLogs() {
  let lines = [];
  if (checkDockerCli()) {
    const { execSync } = require('child_process');
    try {
      const ids = execSync('docker ps --filter "name=runner-" -q', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
        .split('\n')
        .filter(id => id.trim().length > 0);
      ids.forEach(id => {
        try {
          const name = execSync(`docker inspect --format="{{.Name}}" ${id}`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().replace(/^\//, '');
          const raw = execSync(`docker logs --tail 150 ${id}`,
            { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
          const containerLines = raw.split('\n')
            .filter(l => l.trim().length > 0)
            .map(l => `docker - [${name}] ${l}`);
          lines = lines.concat(containerLines);
        } catch (e) {
          // ignore errors for this container
        }
      });
    } catch (e) {
      // ignore
    }
  }

  // File-based docker logs fallback or primary source
  if (lines.length === 0 && fs.existsSync(DOCKER_LOG_PATH)) {
    const rawLogs = fs.readFileSync(DOCKER_LOG_PATH, 'utf-8');
    const all = rawLogs.split('\n').filter(l => l.trim().length > 0);
    lines = all.slice(-150).map(l => `docker - ${l}`);
  }
  return lines;
}

function extractLogTimestamp(line) {
  const match = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/);
  if (match) {
    const iso = match[1].replace(' ', 'T');
    const ts = Date.parse(iso.endsWith('Z') ? iso : iso + 'Z');
    if (!isNaN(ts)) return ts;
  }
  return 0;
}

function getGlobalLogs(options = {}) {
  initSystemLogs();
  let allLines = [];

  // Read system event logs
  if (fs.existsSync(SYSTEM_LOG_PATH)) {
    const raw = fs.readFileSync(SYSTEM_LOG_PATH, 'utf-8');
    const sysLines = raw.split('\n').filter(l => l.trim().length > 0);
    sysLines.forEach(l => {
      allLines.push(`global - ${l}`);
    });
  }

  // Include Docker container execution logs
  const dockerLines = fetchDockerContainerLogs();
  if (dockerLines && dockerLines.length > 0) {
    allLines = allLines.concat(dockerLines);
  }

  // Read active runner logs (lazy require to avoid circular dependency with runnerService)
  const runnerService = require('./runnerService');
  const runners = runnerService.getAllRunners();
  if (runners && runners.length > 0) {
    runners.forEach(runner => {
      const runnerIdDisplay = runner.name || runner.id.replace('runner-', '');
      const res = getRunnerLogs(runner.id, { limit: 50, level: options.level });
      if (res.lines && res.lines.length > 0) {
        res.lines.forEach(l => {
          // Preserve any embedded timestamp: put [runnerName] after it so normalizeLogLine
          // can still extract the timestamp from the original position
          const tsMatch = l.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?[: ]*)(.*)/);
          if (tsMatch) {
            allLines.push(`${tsMatch[1]}[${runnerIdDisplay}] ${tsMatch[2]}`);
          } else {
            allLines.push(`[${runnerIdDisplay}] ${l}`);
          }
        });
      }
    });
  }

  // Read archived runner logs for deleted runners
  const archiveDir = path.join(process.env.DATA_DIR || '/app/data', 'archived-logs');
  if (fs.existsSync(archiveDir)) {
    try {
      const archivedNames = fs.readdirSync(archiveDir);
      archivedNames.forEach(name => {
        if (!runners || !runners.some(r => r.name === name || r.id === name)) {
          const res = getRunnerLogs(name, { limit: 50, level: options.level });
          if (res.lines && res.lines.length > 0) {
            res.lines.forEach(l => {
              const tsMatch = l.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?[: ]*)(.*)/);
              if (tsMatch) {
                allLines.push(`${tsMatch[1]}[${name}] ${tsMatch[2]}`);
              } else {
                allLines.push(`[${name}] ${l}`);
              }
            });
          }
        }
      });
    } catch (e) { }
  }

  if (options.search) {
    const query = options.search.toLowerCase();
    allLines = allLines.filter(l => l.toLowerCase().includes(query));
  }

  if (options.level && options.level !== 'DEBUG' && options.level !== 'ALL') {
    allLines = filterByLogLevel(allLines, options.level);
  }

  // Sort chronologically by timestamp so newest events across all sources appear at the bottom
  allLines.sort((a, b) => {
    const tsA = extractLogTimestamp(a);
    const tsB = extractLogTimestamp(b);
    if (tsA && tsB) return tsA - tsB;
    if (tsA && !tsB) return -1;
    if (!tsA && tsB) return 1;
    return 0;
  });

  const cleanLines = dedupeLines(allLines);
  const limit = options.limit ? parseInt(options.limit, 10) : 300;
  return { lines: cleanLines.slice(-limit) };
}

// Permanently clears global system logs, docker logs, and all runner logs.
function clearGlobalLogs() {
  const dir = path.dirname(SYSTEM_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SYSTEM_LOG_PATH, '');
  if (fs.existsSync(DOCKER_LOG_PATH)) {
    fs.writeFileSync(DOCKER_LOG_PATH, '');
  }

  // Clear all runner log files, workflow archives, and diagnostic files
  try {
    const runnerService = require('./runnerService');
    const runners = runnerService.getAllRunners();
    runners.forEach(r => {
      const rDir = r.dir || r.runner_dir || r.runnerDir || path.join(DEFAULT_RUNNER_DIR, r.name || r.id);
      if (fs.existsSync(rDir)) {
        const lFile = path.join(rDir, 'logs', 'runner.log');
        if (fs.existsSync(lFile)) fs.writeFileSync(lFile, '');
        const jFile = path.join(rDir, 'logs', 'job-logs.txt');
        if (fs.existsSync(jFile)) fs.writeFileSync(jFile, '');
        const wfDir = path.join(rDir, 'logs', 'workflows');
        if (fs.existsSync(wfDir)) {
          try {
            fs.readdirSync(wfDir).forEach(f => {
              try { fs.unlinkSync(path.join(wfDir, f)); } catch (e) {}
            });
          } catch (e) {}
        }
        const diagDir = path.join(rDir, 'actions-runner', '_diag');
        if (fs.existsSync(diagDir)) {
          try {
            fs.readdirSync(diagDir).forEach(f => {
              try { fs.rmSync(path.join(diagDir, f), { recursive: true, force: true }); } catch (e) {}
            });
          } catch (e) {}
        }
      }
      delete r.lastError;
    });
    const db = require('../db/database');
    db.saveRunners(runners);
  } catch (e) {}

  for (const k in trackedOffsets) delete trackedOffsets[k];
  for (const k in activeTimelines) delete activeTimelines[k];

  // Remove archived logs from deleted runners
  const archiveDir = path.join(process.env.DATA_DIR || '/app/data', 'archived-logs');
  if (fs.existsSync(archiveDir)) {
    try {
      const entries = fs.readdirSync(archiveDir);
      entries.forEach(item => {
        const full = path.join(archiveDir, item);
        try {
          fs.rmSync(full, { recursive: true, force: true });
        } catch (e) {}
      });
    } catch (e) {}
  }
}

// Permanently clears logs, workflow files, and diagnostic chunks for a specific runner.
function clearRunnerLogs(runnerId) {
  const runnerService = require('./runnerService');
  const runner = runnerService.getRunnerById(runnerId);
  const runnerDir = runner ? (runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runnerId)) : null;

  if (runnerDir && fs.existsSync(runnerDir)) {
    const logFile = path.join(runnerDir, 'logs', 'runner.log');
    if (fs.existsSync(logFile)) fs.writeFileSync(logFile, '');
    const jobLog = path.join(runnerDir, 'logs', 'job-logs.txt');
    if (fs.existsSync(jobLog)) fs.writeFileSync(jobLog, '');
    const wfDir = path.join(runnerDir, 'logs', 'workflows');
    if (fs.existsSync(wfDir)) {
      try {
        fs.readdirSync(wfDir).forEach(f => {
          try { fs.unlinkSync(path.join(wfDir, f)); } catch (e) {}
        });
      } catch (e) {}
    }
    const diagDir = path.join(runnerDir, 'actions-runner', '_diag');
    if (fs.existsSync(diagDir)) {
      try {
        fs.readdirSync(diagDir).forEach(f => {
          try { fs.rmSync(path.join(diagDir, f), { recursive: true, force: true }); } catch (e) {}
        });
      } catch (e) {}
    }

    Object.keys(trackedOffsets).forEach(fp => {
      if (fp.startsWith(runnerDir)) delete trackedOffsets[fp];
    });
    delete activeTimelines[runnerId];
    if (runner) delete activeTimelines[runner.id];
  }

  // Clear lastError from runner record so it does not reinject into live logs
  if (runner) {
    delete runner.lastError;
    const db = require('../db/database');
    const runners = db.getRunners();
    const idx = runners.findIndex(r => r.id === runnerId || r.name === runnerId);
    if (idx !== -1) {
      delete runners[idx].lastError;
      db.saveRunners(runners);
    }
  }
}

module.exports = {
  addSystemLog,
  getRunnerLogs,
  getGlobalLogs,
  clearGlobalLogs,
  clearRunnerLogs,
  startHarvester,
  harvestLogs,
  filterSteps
};
