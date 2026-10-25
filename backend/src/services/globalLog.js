const fs = require('fs');
const path = require('path');
const runnerDaemon = require('./runnerDaemon');
const jobService = require('./jobService');

const DOCKER_LOG_PATH = path.join(process.env.DATA_DIR || '/app/data', 'docker.log');
const DEFAULT_RUNNER_DIR = process.env.RUNNER_DIR || process.env.RUNNERS_DIR || (fs.existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners');

let isLogsInitialized = false;

// Initializes and rotates docker logs and runner archives on container startup.
function initLogs() {
  if (isLogsInitialized) return;
  isLogsInitialized = true;

  const archiveDir = path.join(path.dirname(DOCKER_LOG_PATH), 'archive');
  if (!fs.existsSync(archiveDir)) {
    try { fs.mkdirSync(archiveDir, { recursive: true }); } catch (e) {}
  }

  if (fs.existsSync(DOCKER_LOG_PATH)) {
    try {
      const stat = fs.statSync(DOCKER_LOG_PATH);
      if (stat.size > 0) {
        const ts = stat.mtime.toISOString().replace(/[:.]/g, '-');
        fs.renameSync(DOCKER_LOG_PATH, path.join(archiveDir, `docker_${ts}.log`));
      }
    } catch (e) {}
  }

  const dir = path.dirname(DOCKER_LOG_PATH);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  fs.writeFileSync(DOCKER_LOG_PATH, '');

  try {
    if (fs.existsSync(DEFAULT_RUNNER_DIR)) {
      const runnerDirs = fs.readdirSync(DEFAULT_RUNNER_DIR);
      runnerDirs.forEach(entry => {
        const rDir = path.join(DEFAULT_RUNNER_DIR, entry);
        try {
          if (!fs.statSync(rDir).isDirectory()) return;
          const logsDir = path.join(rDir, 'logs');
          if (!fs.existsSync(logsDir)) return;

          const runnerLog = path.join(logsDir, 'runner.log');
          if (fs.existsSync(runnerLog) && fs.statSync(runnerLog).size > 0) {
            const runnerArchiveDir = path.join(logsDir, 'archive');
            if (!fs.existsSync(runnerArchiveDir)) fs.mkdirSync(runnerArchiveDir, { recursive: true });
            const ts = fs.statSync(runnerLog).mtime.toISOString().replace(/[:.]/g, '-');
            fs.copyFileSync(runnerLog, path.join(runnerArchiveDir, `runner_${ts}.log`));
            fs.writeFileSync(runnerLog, '');
          }

          const jobLog = path.join(logsDir, 'job-logs.txt');
          if (fs.existsSync(jobLog) && fs.statSync(jobLog).size > 0) {
            const wfDir = path.join(logsDir, 'workflows');
            if (!fs.existsSync(wfDir)) fs.mkdirSync(wfDir, { recursive: true });
            const ts = fs.statSync(jobLog).mtime.toISOString().replace(/[:.]/g, '-');
            fs.copyFileSync(jobLog, path.join(wfDir, `workflow_${ts}.log`));
            fs.writeFileSync(jobLog, '');
          }

          const diagDir = path.join(rDir, 'actions-runner', '_diag');
          if (fs.existsSync(diagDir)) {
            const diagArchive = path.join(diagDir, 'archive');
            const diagFiles = fs.readdirSync(diagDir).filter(f => (f.startsWith('Runner_') || f.startsWith('Worker_')) && f.endsWith('.log'));
            if (diagFiles.length > 0) {
              if (!fs.existsSync(diagArchive)) fs.mkdirSync(diagArchive, { recursive: true });
              diagFiles.forEach(f => {
                try { fs.renameSync(path.join(diagDir, f), path.join(diagArchive, f)); } catch (e) {}
              });
            }
          }
        } catch (e) {}
      });
    }
  } catch (e) {}
}

initLogs();

// Writes system and backend events directly to unified docker.log.
function writeLog(level = 'INFO', message = '') {
  initLogs();
  const dir = path.dirname(DOCKER_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const cleanMsg = message.replace(/\s*\(PID:\s*\d+\)/g, '');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${now}] [global] [${level.toUpperCase()}] ${cleanMsg}\n`;
  fs.appendFileSync(DOCKER_LOG_PATH, line);
}

// Appends raw docker container line to docker.log.
function appendDocker(message) {
  initLogs();
  const dir = path.dirname(DOCKER_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.appendFileSync(DOCKER_LOG_PATH, `[${now}] ${message}\n`);
}

// Hooks console.log and console.error to write output to docker.log.
function hookConsole() {
  const origLog = console.log;
  const origErr = console.error;
  console.log = function (...args) {
    origLog.apply(console, args);
    appendDocker(`[INFO] ${args.join(' ')}`);
  };
  console.error = function (...args) {
    origErr.apply(console, args);
    appendDocker(`[ERROR] ${args.join(' ')}`);
  };
}

hookConsole();

// Formats log lines into canonical timestamp, source, level, and message structure.
function formatEntry(line, defaultSource = 'global', defaultLvl = 'INFO') {
  if (!line || !line.trim()) return '';
  let str = line.trim();
  str = str.replace(/^(?:global|docker)\s*-\s*/i, '');

  let ts = '';
  let source = defaultSource;
  let lvl = defaultLvl;

  const netMatch = str.match(/^\[(?:(?:RUNNER|WORKER)\s+)?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+([A-Z]{3,5})\s+([^\]]+)\]\s*(.*)/s);
  if (netMatch) {
    ts = netMatch[1].replace('T', ' ').slice(0, 19);
    const rawLvl = netMatch[2].toUpperCase();
    lvl = rawLvl === 'ERR' ? 'ERROR' : (rawLvl === 'DBG' || rawLvl === 'TRC' || rawLvl === 'TRACE') ? 'DEBUG' : rawLvl === 'WARNING' ? 'WARN' : rawLvl;
    str = `[${netMatch[3].trim()}] ${netMatch[4].trim()}`;
  } else {
    const tsBracket = str.match(/^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]\s*(.*)/s);
    if (tsBracket) {
      ts = tsBracket[1].replace('T', ' ').slice(0, 19);
      str = tsBracket[2].trim();
    } else {
      const tsBare = str.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)[: ]\s*(.*)/s);
      if (tsBare) {
        ts = tsBare[1].replace('T', ' ').slice(0, 19);
        str = tsBare[2].trim();
      }
    }

    const srcMatch = str.match(/^\[([^\d\]][^\]]*)\]\s*(.*)/s);
    if (
      srcMatch &&
      !/^\d{4}-\d{2}-\d{2}/.test(srcMatch[1]) &&
      !/^(?:RUNNER|WORKER)\s+\d{4}/i.test(srcMatch[1]) &&
      !/^(INFO|WARN|WARNING|ERROR|ERR|DEBUG|DBG|TRACE|TRC)$/i.test(srcMatch[1])
    ) {
      source = srcMatch[1].trim();
      str = srcMatch[2].trim();
    }

    const lvlMatch = str.match(/^\[(INFO|WARN|WARNING|ERROR|ERR|DEBUG|DBG|TRACE|TRC)\]\s*(.*)/is);
    if (lvlMatch) {
      const rawLvl = lvlMatch[1].toUpperCase();
      lvl = rawLvl === 'ERR' ? 'ERROR' : (rawLvl === 'DBG' || rawLvl === 'TRC' || rawLvl === 'TRACE') ? 'DEBUG' : rawLvl === 'WARNING' ? 'WARN' : rawLvl;
      str = lvlMatch[2].trim();
    } else {
      lvl = runnerDaemon.parseLevel(str);
    }
  }

  str = str.replace(/^(?:\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\]|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?[: ]?)\s*/s, '');
  const timestamp = ts || new Date().toISOString().replace('T', ' ').slice(0, 19);
  return `[${timestamp}] [${source}] [${lvl}] ${str}`;
}

// Extracts numeric timestamp from log string for sorting.
function extractTime(line) {
  const match = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/);
  if (match) {
    const iso = match[1].replace(' ', 'T');
    const ts = Date.parse(iso.endsWith('Z') ? iso : iso + 'Z');
    if (!isNaN(ts)) return ts;
  }
  return 0;
}

// Retrieves aggregated global system, docker, and runner logs.
function getGlobalLogs(options = {}) {
  let allLines = [];

  if (fs.existsSync(DOCKER_LOG_PATH)) {
    const raw = fs.readFileSync(DOCKER_LOG_PATH, 'utf-8');
    const docLines = raw.split('\n').filter(l => l.trim().length > 0);
    docLines.forEach(l => {
      const entry = formatEntry(l, 'global', 'INFO');
      if (entry) allLines.push(entry);
    });
  }

  const runnerService = require('./runnerService');
  const runners = runnerService.getAllRunners ? runnerService.getAllRunners() : [];
  if (runners && runners.length > 0) {
    runners.forEach(runner => {
      const runnerIdDisplay = runner.name || runner.id.replace('runner-', '');
      const daemonRes = runnerDaemon.getDaemonLogs(runner.id, { limit: 150, level: 'ALL' });
      if (daemonRes.lines && daemonRes.lines.length > 0) {
        daemonRes.lines.forEach(l => {
          const entry = formatEntry(l, runnerIdDisplay, 'INFO');
          if (entry) allLines.push(entry);
        });
      }

      const wfRes = jobService.getJobLogs(runner.id, { limit: 150 });
      if (wfRes.lines && wfRes.lines.length > 0) {
        wfRes.lines.forEach(l => {
          const entry = formatEntry(l, runnerIdDisplay, 'INFO');
          if (entry) allLines.push(entry);
        });
      }
    });
  }

  if (options.search) {
    const query = options.search.toLowerCase();
    allLines = allLines.filter(l => l.toLowerCase().includes(query));
  }

  if (options.level && options.level !== 'ALL') {
    allLines = runnerDaemon.filterLevel(allLines, options.level);
  }

  allLines.sort((a, b) => {
    const tsA = extractTime(a);
    const tsB = extractTime(b);
    if (tsA && tsB) return tsA - tsB;
    if (tsA && !tsB) return -1;
    if (!tsA && tsB) return 1;
    return 0;
  });

  const limit = options.limit ? parseInt(options.limit, 10) : 500;
  return { lines: allLines.slice(-limit) };
}

// Dispatches runner log queries to workflow or daemon log readers.
function getRunnerLogs(runnerId, options = {}) {
  const source = (options.source || '').toLowerCase();
  if (source === 'workflow') {
    return jobService.getJobLogs(runnerId, options);
  }
  return runnerDaemon.getDaemonLogs(runnerId, options);
}

// Clears global docker logs and all runner logs.
function clearGlobalLogs() {
  const dir = path.dirname(DOCKER_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DOCKER_LOG_PATH, '');

  try {
    const runnerService = require('./runnerService');
    const runners = runnerService.getAllRunners ? runnerService.getAllRunners() : [];
    runners.forEach(r => {
      const rDir = r.dir || path.join(DEFAULT_RUNNER_DIR, r.name || r.id);
      runnerDaemon.clearDaemon(rDir);
      jobService.clearJob(rDir);
    });
  } catch (e) {}
}

// Clears daemon and workflow logs for a specific runner.
function clearRunnerLogs(runnerId) {
  const runnerService = require('./runnerService');
  const runner = runnerService.getRunnerById(runnerId);
  const runnerDir = runner ? (runner.dir || path.join(DEFAULT_RUNNER_DIR, runner.name || runnerId)) : null;
  if (runnerDir) {
    runnerDaemon.clearDaemon(runnerDir);
    jobService.clearJob(runnerDir);
  }
}

// Purges log archives older than specified retention setting.
function cleanArchives(retentionSetting = 'never', customDays = 0) {
  let maxAgeMs = 0;
  if (retentionSetting === 'daily') maxAgeMs = 24 * 60 * 60 * 1000;
  else if (retentionSetting === 'weekly') maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  else if (retentionSetting === 'monthly') maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  else if (retentionSetting === 'custom') {
    const days = parseInt(customDays, 10);
    if (!isNaN(days) && days > 0) maxAgeMs = days * 24 * 60 * 60 * 1000;
  }
  if (!maxAgeMs) return { deleted: 0 };

  const now = Date.now();
  let deletedCount = 0;
  const targetDirs = [path.join(process.env.DATA_DIR || '/app/data', 'archive')];

  try {
    const runnerService = require('./runnerService');
    const runners = runnerService.getAllRunners ? runnerService.getAllRunners() : [];
    runners.forEach(r => {
      const dir = r.dir || path.join(DEFAULT_RUNNER_DIR, r.name || r.id);
      targetDirs.push(path.join(dir, 'logs', 'archive'));
      targetDirs.push(path.join(dir, 'logs', 'workflows'));
      targetDirs.push(path.join(dir, 'actions-runner', '_diag', 'archive'));
    });
  } catch (e) {}

  targetDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const filePath = path.join(dir, file);
          try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxAgeMs) {
              if (stat.isDirectory()) fs.rmSync(filePath, { recursive: true, force: true });
              else fs.unlinkSync(filePath);
              deletedCount++;
            }
          } catch (e) {}
        });
      } catch (e) {}
    }
  });

  return { deleted: deletedCount };
}

module.exports = {
  initLogs,
  writeLog,
  addSystemLog: writeLog,
  getGlobalLogs,
  getRunnerLogs,
  clearGlobalLogs,
  clearRunnerLogs,
  cleanArchives,
  startHarvester: jobService.startHarvester,
  harvestLogs: jobService.harvestLogs,
  filterSteps: jobService.filterSteps
};
