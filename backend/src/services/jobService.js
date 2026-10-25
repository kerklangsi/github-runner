const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const DEFAULT_RUNNER_DIR = process.env.RUNNER_DIR || process.env.RUNNERS_DIR || (fs.existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners');
const trackedOffsets = {};
const activeTimelines = {};
const activeWatchers = {};
let isHarvesting = false;
let harvesterTimer = null;

// Harvests live step chunk pages and blocks into persistent job-logs.txt.
function harvestLogs() {
  if (isHarvesting) return;
  isHarvesting = true;
  try {
    const runners = db.getRunners();
    runners.forEach(runner => {
      const runnerDir = runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runner.id);
      const baseDiag = path.join(runnerDir, 'actions-runner', '_diag');
      const fallbackDiag = path.join(runnerDir, '_diag');
      const diagDir = fs.existsSync(baseDiag) ? baseDiag : fallbackDiag;
      if (!fs.existsSync(diagDir)) return;

      const sourceDirs = [path.join(diagDir, 'blocks'), path.join(diagDir, 'pages')].filter(d => fs.existsSync(d));
      const filesToProcess = [];

      sourceDirs.forEach(dir => {
        try {
          const entries = fs.readdirSync(dir).filter(f => !f.startsWith('.') && !f.endsWith('.tmp'));
          entries.forEach(f => {
            const fullPath = path.join(dir, f);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) filesToProcess.push({ fullPath, file: f, mtime: stat.mtimeMs });
            } catch (e) {}
          });
        } catch (e) {}
      });

      if (filesToProcess.length === 0) return;
      filesToProcess.sort((a, b) => a.mtime - b.mtime);

      const logsDir = path.join(runnerDir, 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      const jobLogPath = path.join(logsDir, 'job-logs.txt');
      const workflowsDir = path.join(logsDir, 'workflows');
      if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });

      filesToProcess.forEach(({ fullPath, file }) => {
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
            if (currentOffset === 0 && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            if (text.length > 0) fs.appendFileSync(jobLogPath, text);
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
      const baseDiag = path.join(runnerDir, 'actions-runner', '_diag');
      const fallbackDiag = path.join(runnerDir, '_diag');
      const diagDir = fs.existsSync(baseDiag) ? baseDiag : fallbackDiag;
      if (!fs.existsSync(diagDir)) return;

      const sourceDirs = [path.join(diagDir, 'blocks'), path.join(diagDir, 'pages')].filter(d => fs.existsSync(d));
      sourceDirs.forEach(dir => {
        try {
          const entries = fs.readdirSync(dir).filter(f => !f.startsWith('.') && !f.endsWith('.tmp'));
          entries.forEach(file => {
            const fullPath = path.join(dir, file);
            try {
              const stat = fs.statSync(fullPath);
              trackedOffsets[fullPath] = stat.size;
              const parts = file.split('_');
              activeTimelines[runner.id] = parts[0];
            } catch (e) {}
          });
        } catch (e) {}
      });
    });
  } catch (e) {}
}

// Checks whether any registered runner is currently executing a job or has pending block files.
function checkBusy() {
  try {
    const runnerService = require('./runnerService');
    const runners = runnerService.getAllRunners();
    if (runners.some(r => r.status === 'BUSY')) return true;

    const allRunners = db.getRunners();
    return allRunners.some(runner => {
      const runnerDir = runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runner.id);
      const dirs = [
        path.join(runnerDir, 'actions-runner', '_diag', 'blocks'),
        path.join(runnerDir, 'actions-runner', '_diag', 'pages')
      ];
      return dirs.some(d => {
        try {
          return fs.existsSync(d) && fs.readdirSync(d).some(f => !f.startsWith('.'));
        } catch (e) {
          return false;
        }
      });
    });
  } catch (e) {
    return false;
  }
}

// Attaches real-time filesystem watchers to runner diagnostic directories.
function attachWatchers() {
  try {
    const runners = db.getRunners();
    runners.forEach(runner => {
      const runnerDir = runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runner.id);
      const baseDiag = path.join(runnerDir, 'actions-runner', '_diag');
      const fallbackDiag = path.join(runnerDir, '_diag');
      const diagDir = fs.existsSync(baseDiag) ? baseDiag : fallbackDiag;
      if (!fs.existsSync(diagDir)) return;

      const targetDirs = [diagDir, path.join(diagDir, 'blocks'), path.join(diagDir, 'pages')];
      targetDirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
          try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
        }
        if (fs.existsSync(dir) && !activeWatchers[dir]) {
          try {
            const watcher = fs.watch(dir, (eventType, filename) => {
              if (filename && (filename.endsWith('.1') || filename.includes('_') || filename.startsWith('Worker_'))) {
                setImmediate(() => harvestLogs());
              }
            });
            activeWatchers[dir] = watcher;
          } catch (e) {}
        }
      });
    });
  } catch (e) {}
}

// Starts adaptive background log harvester triggered on busy mode.
function startHarvester() {
  initOffsets();
  attachWatchers();
  if (harvesterTimer) clearInterval(harvesterTimer);
  harvesterTimer = setInterval(() => {
    attachWatchers();
    if (checkBusy()) harvestLogs();
  }, 500);
}

// Parses raw lines from runner worker diagnostic log.
function parseWorker(content) {
  if (!content) return [];
  return content.split('\n').map(l => l.replace(/\r$/, '').trim()).filter(Boolean);
}

// Reads all job execution log lines from disk without filtering.
function readWorkflow(runnerDir) {
  const jobLogPath = path.join(runnerDir, 'logs', 'job-logs.txt');
  if (fs.existsSync(jobLogPath)) {
    const raw = fs.readFileSync(jobLogPath, 'utf-8');
    const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
    if (lines.length > 0) return lines;
  }

  const runnerLog = path.join(runnerDir, 'logs', 'runner.log');
  if (fs.existsSync(runnerLog)) {
    try {
      const raw = fs.readFileSync(runnerLog, 'utf-8');
      const allLines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
      const startIdx = allLines.findLastIndex(l => l.includes('Running job:'));
      if (startIdx !== -1) return allLines.slice(startIdx);
      return allLines;
    } catch (e) {}
  }

  const diagDirs = [path.join(runnerDir, 'actions-runner', '_diag'), path.join(runnerDir, '_diag')];
  for (const d of diagDirs) {
    if (fs.existsSync(d)) {
      try {
        const workers = fs.readdirSync(d).filter(f => f.startsWith('Worker_') && f.endsWith('.log')).sort().reverse();
        if (workers.length > 0) {
          const content = fs.readFileSync(path.join(d, workers[0]), 'utf-8');
          const lines = parseWorker(content);
          if (lines.length > 0) return lines;
        }
      } catch (e) {}
    }
  }

  return [];
}

// Retrieves formatted workflow execution logs for a runner.
function getJobLogs(runnerId, options = {}) {
  const runnerService = require('./runnerService');
  const runner = runnerService.getRunnerById(runnerId);

  let runnerDir = runner ? (runner.dir || runner.runner_dir || runner.runnerDir || path.join(DEFAULT_RUNNER_DIR, runner.name || runnerId)) : null;
  if (!runnerDir || !fs.existsSync(runnerDir)) {
    const archivePath = path.join(process.env.DATA_DIR || '/app/data', 'archived-logs', runnerId);
    if (fs.existsSync(archivePath)) runnerDir = archivePath;
    else return { lines: ['Runner workflow logs not found.'], source: 'workflow', hasWorkflowLogs: false };
  }

  harvestLogs();
  let resultLines = readWorkflow(runnerDir);

  if (options.search) {
    const query = options.search.toLowerCase();
    resultLines = resultLines.filter(l => l.toLowerCase().includes(query));
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 500;
  return {
    lines: resultLines.slice(-limit),
    source: 'workflow',
    hasWorkflowLogs: resultLines.length > 0
  };
}

// Clears workflow logs and archived runs for a runner directory.
function clearJob(runnerDir) {
  if (!runnerDir || !fs.existsSync(runnerDir)) return;
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
}

module.exports = {
  harvestLogs,
  initOffsets,
  checkBusy,
  startHarvester,
  readWorkflow,
  getJobLogs,
  clearJob,
  filterSteps: lines => lines
};
