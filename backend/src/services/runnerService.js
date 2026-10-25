const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const db = require('../db/database');
const sharedStorage = require('./sharedStorage');
const runnerRegister = require('./runnerRegister');

// Resolves and returns absolute path of runner directory.
function getRunnerDir(runner) {
  if (!runner) return sharedStorage.BASE_RUNNERS_DIR;
  return runner.dir || runner.runner_dir || runner.runnerDir || path.join(sharedStorage.BASE_RUNNERS_DIR, runner.name || 'runner');
}

// Checks runner process state and updates status based on live binary process detection.
function checkState(runner) {
  if (runner.status === 'PROVISIONING') return runner;

  const runnerDir = getRunnerDir(runner);
  const actionsRunnerDir = path.join(runnerDir, 'actions-runner');

  let isAlive = false;
  let listenerPid = null;

  if (runner.pid && fs.existsSync(`/proc/${runner.pid}/cmdline`)) {
    try {
      const cmdline = fs.readFileSync(`/proc/${runner.pid}/cmdline`, 'utf-8');
      if (cmdline.includes('Runner.Listener') || cmdline.includes('run.sh')) {
        isAlive = true;
        listenerPid = runner.pid;
      }
    } catch (e) {}
  }

  if (!isAlive && fs.existsSync(actionsRunnerDir)) {
    try {
      const pgrep = execSync(`pgrep -f "${actionsRunnerDir}/bin/[R]unner.Listener" 2>/dev/null`, { encoding: 'utf-8' });
      if (pgrep && pgrep.trim().length > 0) {
        isAlive = true;
        listenerPid = parseInt(pgrep.trim().split('\n')[0], 10);
      }
    } catch (e) {}
  }

  let status = 'OFFLINE';
  if (isAlive) {
    runner.pid = listenerPid;
    let isWorkerRunning = false;
    try {
      const workerPgrep = execSync(`pgrep -f "${actionsRunnerDir}/bin/[R]unner.Worker" 2>/dev/null`, { encoding: 'utf-8' });
      if (workerPgrep && workerPgrep.trim().length > 0) isWorkerRunning = true;
    } catch (e) {}

    status = isWorkerRunning ? 'BUSY' : 'IDLE';
    if (isWorkerRunning || (runner.lastState === 'BUSY' && status === 'IDLE')) {
      setImmediate(() => {
        try {
          const jobService = require('./jobService');
          jobService.harvestLogs();
        } catch (e) {}
      });
    }
  } else {
    runner.pid = null;
    status = 'OFFLINE';
  }

  runner.status = status;
  runner.lastState = status;
  return runner;
}

// Retrieves all tracked runner records with live process status updates.
function getAllRunners() {
  const runners = db.getRunners();
  return runners.map(r => checkState(r));
}

// Retrieves a single runner record by unique ID.
function getRunnerById(id) {
  const runners = getAllRunners();
  return runners.find(r => r.id === id) || null;
}

// Provisions a new runner slot and registers it against GitHub.
function createRunner(options) {
  return runnerRegister.registerRunner(options, id => startRunner(id));
}

// Cancels in-progress workflow runs for runner repository.
function cancelRun(runner) {
  return runnerRegister.cancelRuns(runner);
}

// Spawns runner daemon process and logs output to disk.
function startRunner(id) {
  const runners = db.getRunners();
  const runnerIndex = runners.findIndex(r => r.id === id);
  if (runnerIndex === -1) return { error: 'Runner not found' };

  const runner = runners[runnerIndex];
  const runnerDir = getRunnerDir(runner);
  const actionsRunnerDir = path.join(runnerDir, 'actions-runner');
  const runnerConfigFile = path.join(actionsRunnerDir, '.runner');

  cancelRun(runner);

  if (runner.pid) {
    try {
      process.kill(runner.pid, 0);
      return { success: true, message: `Runner '${runner.name}' is already running.`, pid: runner.pid };
    } catch (e) {
      runner.pid = null;
    }
  }

  if (!fs.existsSync(runnerConfigFile)) {
    const errorMsg = runner.lastError || 'Runner is not configured with GitHub.';
    runner.status = 'CRASHED';
    runner.lastError = errorMsg;
    runners[runnerIndex] = runner;
    db.saveRunners(runners);
    return { error: errorMsg };
  }

  const logsDir = path.join(runnerDir, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const logFilePath = path.join(logsDir, 'runner.log');

  if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > 0) {
    const archiveDir = path.join(logsDir, 'archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(logFilePath, path.join(archiveDir, `runner_${stamp}.log`));
  }

  sharedStorage.ensureLinks(runner);

  try {
    const envFile = path.join(actionsRunnerDir, '.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      if (!content.includes('ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT')) {
        fs.appendFileSync(envFile, '\nACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=true\n');
      }
    } else {
      fs.writeFileSync(envFile, 'ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=true\n');
    }
  } catch (e) {}

  fs.writeFileSync(logFilePath, '');
  const outStream = fs.openSync(logFilePath, 'a');

  const child = spawn('./run.sh', [], {
    cwd: actionsRunnerDir,
    detached: true,
    stdio: ['ignore', outStream, outStream]
  });

  child.unref();

  runner.pid = child.pid;
  runner.status = 'ONLINE';
  runner.lastState = 'ONLINE';
  delete runner.lastError;
  runners[runnerIndex] = runner;
  db.saveRunners(runners);

  try {
    const globalLog = require('./globalLog');
    globalLog.writeLog('INFO', `Sent START command to runner container '${runner.name}'.`);
  } catch (e) {}

  return { success: true, pid: child.pid };
}

// Stops a runner container process group and cleans up lingering processes.
function stopRunner(id) {
  const runners = db.getRunners();
  const runnerIndex = runners.findIndex(r => r.id === id);
  if (runnerIndex === -1) return { error: 'Runner not found' };

  const runner = runners[runnerIndex];
  const runnerDir = getRunnerDir(runner);
  const actionsRunnerDir = path.join(runnerDir, 'actions-runner');

  cancelRun(runner);

  if (runner.pid) {
    try {
      execSync(`kill -2 -${runner.pid} 2>/dev/null || kill -2 ${runner.pid} 2>/dev/null || true`);
    } catch (e) {}
    try {
      for (let i = 0; i < 4; i++) {
        execSync('sleep 0.5');
        const pgrep = execSync(`pgrep -f "${actionsRunnerDir}/bin/[R]unner" 2>/dev/null || true`, { encoding: 'utf-8' });
        if (!pgrep || !pgrep.trim()) break;
      }
    } catch (e) {}
  }

  if (runner.pid) {
    try {
      execSync(`kill -15 -${runner.pid} 2>/dev/null || kill -9 -${runner.pid} 2>/dev/null || kill -15 ${runner.pid} 2>/dev/null || kill -9 ${runner.pid} 2>/dev/null || true`);
    } catch (e) {}
  }

  try {
    execSync(`pkill -9 -f "${actionsRunnerDir}" 2>/dev/null || true`);
  } catch (e) {}

  runner.pid = null;
  runner.status = 'OFFLINE';
  runner.lastState = 'OFFLINE';
  runners[runnerIndex] = runner;
  db.saveRunners(runners);

  try {
    const globalLog = require('./globalLog');
    globalLog.writeLog('INFO', `Sent STOP command to runner container '${runner.name}'.`);
  } catch (e) {}

  return { success: true };
}

// Restarts runner container process by stopping and starting sequentially.
function restartRunner(id) {
  stopRunner(id);
  return startRunner(id);
}

// Removes runner registration, unregisters from GitHub, and archives logs.
function removeRunner(id, removeWorkDir = false, token = null) {
  stopRunner(id);
  const runners = db.getRunners();
  const runnerIndex = runners.findIndex(r => r.id === id);
  if (runnerIndex === -1) return { error: 'Runner not found' };

  const runner = runners[runnerIndex];
  runnerRegister.unregisterRunner(runner, token);

  try {
    const archiveBase = path.join(process.env.DATA_DIR || '/app/data', 'archived-logs', runner.name || id);
    if (!fs.existsSync(archiveBase)) fs.mkdirSync(archiveBase, { recursive: true });
    const runnerLog = path.join(runner.dir, 'logs', 'runner.log');
    if (fs.existsSync(runnerLog)) fs.copyFileSync(runnerLog, path.join(archiveBase, 'runner.log'));
  } catch (err) {}

  if (fs.existsSync(runner.dir)) {
    if (removeWorkDir) execSync(`rm -rf ${runner.dir} || true`);
    else execSync(`rm -rf ${path.join(runner.dir, 'actions-runner')} || true`);
  }

  runners.splice(runnerIndex, 1);
  db.saveRunners(runners);

  try {
    const globalLog = require('./globalLog');
    globalLog.writeLog('INFO', `Deleted runner container '${runner.name}' (ID: ${id}).`);
  } catch (e) {}

  return { success: true };
}

// Updates configuration settings for an existing runner record.
function updateRunnerConfig(id, config) {
  const runners = db.getRunners();
  const index = runners.findIndex(r => r.id === id);
  if (index === -1) return { error: 'Runner not found' };

  const runner = runners[index];
  if (config.name) runner.name = config.name;
  if (config.githubUrl) runner.githubUrl = config.githubUrl;
  if (config.token || config.registrationToken) runner.registrationToken = config.token || config.registrationToken;
  if (config.labels) runner.labels = config.labels;
  if (config.runnerGroup) runner.runnerGroup = config.runnerGroup;
  if (config.watchdog !== undefined) runner.watchdog = !!config.watchdog;

  runners[index] = runner;
  db.saveRunners(runners);
  return { success: true, runner };
}

// Sends start command to all registered runner containers.
function startAllRunners() {
  const runners = db.getRunners();
  const results = runners.map(r => startRunner(r.id));
  return { success: true, count: results.length };
}

// Sends stop command to all active runner containers.
function stopAllRunners() {
  const runners = db.getRunners();
  const results = runners.map(r => stopRunner(r.id));
  return { success: true, count: results.length };
}

module.exports = {
  getAllRunners,
  getRunnerById,
  createRunner,
  updateRunnerConfig,
  startRunner,
  stopRunner,
  restartRunner,
  removeRunner,
  startAllRunners,
  stopAllRunners,
  cancelRun,
  checkRunnerProcessState: checkState
};
