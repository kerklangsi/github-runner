const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');
const db = require('../db/database');
const logService = require('./logService');

const BASE_RUNNERS_DIR = process.env.RUNNER_DIR || process.env.RUNNERS_DIR || (fs.existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners');
const SHARED_DATA_DIR = process.env.SHARED_DATA_DIR || '/opt/shared_data';

// Ensures base runners and shared data working directories exist on disk.
function ensureBaseDir() {
  if (!fs.existsSync(BASE_RUNNERS_DIR)) {
    fs.mkdirSync(BASE_RUNNERS_DIR, { recursive: true });
  }
  if (!fs.existsSync(SHARED_DATA_DIR)) {
    fs.mkdirSync(SHARED_DATA_DIR, { recursive: true });
  }
}

// Resolves and returns absolute path of runner directory.
function getRunnerDir(runner) {
  if (!runner) return BASE_RUNNERS_DIR;
  return runner.dir || runner.runner_dir || runner.runnerDir || path.join(BASE_RUNNERS_DIR, runner.name || 'runner');
}

// Retrieves all tracked runner records with live process status updates.
function getAllRunners() {
  const runners = db.getRunners();
  return runners.map(runner => {
    const updated = checkRunnerProcessState(runner);
    return updated;
  });
}

// Checks runner process state and updates status based on live binary process detection.
function checkRunnerProcessState(runner) {
  if (runner.status === 'PROVISIONING') {
    return runner;
  }

  const runnerDir = getRunnerDir(runner);
  const actionsRunnerDir = path.join(runnerDir, 'actions-runner');

  let isAlive = false;
  let listenerPid = null;

  // Verify if runner.pid is genuinely active and belongs to Runner.Listener or run.sh
  if (runner.pid && fs.existsSync(`/proc/${runner.pid}/cmdline`)) {
    try {
      const cmdline = fs.readFileSync(`/proc/${runner.pid}/cmdline`, 'utf-8');
      if (cmdline.includes('Runner.Listener') || cmdline.includes('run.sh')) {
        isAlive = true;
        listenerPid = runner.pid;
      }
    } catch (e) {}
  }

  // Secondary check: search specifically for active Runner.Listener daemon process for this runner directory
  // Note: Use [R]unner bracket trick so pgrep does not match its own command line!
  if (!isAlive && fs.existsSync(actionsRunnerDir)) {
    try {
      const pgrep = execSync(`pgrep -f "${actionsRunnerDir}/bin/[R]unner.Listener" 2>/dev/null`, { encoding: 'utf-8' });
      if (pgrep && pgrep.trim().length > 0) {
        isAlive = true;
        const pids = pgrep.trim().split('\n');
        listenerPid = parseInt(pids[0], 10);
      }
    } catch (e) {}
  }

  let status = "OFFLINE";
  if (isAlive) {
    runner.pid = listenerPid;
    // Check if an active worker process is executing a job (using [R]unner bracket trick)
    let isWorkerRunning = false;
    try {
      const workerPgrep = execSync(`pgrep -f "${actionsRunnerDir}/bin/[R]unner.Worker" 2>/dev/null`, { encoding: 'utf-8' });
      if (workerPgrep && workerPgrep.trim().length > 0) {
        isWorkerRunning = true;
      }
    } catch (e) {}

    status = isWorkerRunning ? "BUSY" : "IDLE";
    if (isWorkerRunning || (runner.lastState === "BUSY" && status === "IDLE")) {
      setImmediate(() => {
        try {
          const logService = require('./logService');
          logService.harvestLogs();
        } catch (e) {}
      });
    }
  } else {
    runner.pid = null;
    status = "OFFLINE";
  }

  runner.status = status;
  runner.lastState = status;
  return runner;
}

// Retrieves a single runner record by unique ID.
function getRunnerById(id) {
  const runners = getAllRunners();
  return runners.find(r => r.id === id) || null;
}

// Parses organization/owner and repository names from target GitHub URL.
function extractRepoInfo(githubUrl) {
  if (!githubUrl) return { org: '', repo: '', fullKey: 'default' };
  const clean = githubUrl.trim().replace(/\/$/, '');
  const orgMatch = clean.match(/github\.com\/orgs\/([^/]+)/i);
  if (orgMatch) {
    return { org: orgMatch[1], repo: '', fullKey: orgMatch[1] };
  }
  const repoMatch = clean.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (repoMatch) {
    return { org: repoMatch[1], repo: repoMatch[2], fullKey: `${repoMatch[1]}/${repoMatch[2]}` };
  }
  return { org: '', repo: '', fullKey: 'default' };
}

// Provisions directory structure and registers a new GitHub Actions runner container in background.
function createRunner(options) {
  ensureBaseDir();
  const id = `runner-${Date.now()}`;
  const rawName = (options.name || '').trim();
  const sanitizedName = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || `runner-${Date.now().toString().slice(-4)}`;
  const runnerDir = path.join(BASE_RUNNERS_DIR, sanitizedName);

  logService.addSystemLog('INFO', `Provisioning runner container '${sanitizedName}' targeting ${options.githubUrl}...`);

  const activeRunners = db.getRunners();
  const isAlreadyTracked = activeRunners.some(r => r.name === sanitizedName || r.dir === runnerDir);

  if (isAlreadyTracked) {
    logService.addSystemLog('ERROR', `Runner registration failed: A runner named '${sanitizedName}' is already registered.`);
    return { error: `A runner named '${sanitizedName}' is already registered.` };
  }

  // If a stale directory exists on disk but is not tracked in DB, clean it up
  if (fs.existsSync(runnerDir)) {
    execSync(`rm -rf ${runnerDir} || true`);
  }

  const actionsRunnerDir = path.join(runnerDir, 'actions-runner');
  const workDir = path.join(runnerDir, '_work');
  const logsDir = path.join(runnerDir, 'logs');

  fs.mkdirSync(actionsRunnerDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  // Copy base runner binaries
  const baseSource = '/actions-runner';
  if (fs.existsSync(baseSource) && fs.existsSync(path.join(baseSource, 'config.sh'))) {
    execSync(`cp -rn ${baseSource}/* ${actionsRunnerDir}/ || true`);
  }

  // Set up shared persistent repository data directory
  const repoInfo = extractRepoInfo(options.githubUrl);
  const repoName = repoInfo.repo || repoInfo.fullKey;
  const sharedRepoDir = path.join(SHARED_DATA_DIR, repoName);

  // Pre-create auth/ at shared workspace root (shared_data/REPO/auth/)
  try {
    fs.mkdirSync(path.join(sharedRepoDir, 'auth'), { recursive: true });
  } catch (e) {}

  // Symlink _work/REPO/REPO → shared_data/REPO so all runners share one workspace
  // All 3 runners read/write the same shared_data/REPO/ folder (auth, streams, playlists, etc.)
  if (repoInfo.repo) {
    try {
      const repoOuterDir = path.join(workDir, repoInfo.repo);
      fs.mkdirSync(repoOuterDir, { recursive: true });
      const workspaceLink = path.join(repoOuterDir, repoInfo.repo);
      if (!fs.existsSync(workspaceLink)) {
        const relPath = path.relative(repoOuterDir, sharedRepoDir);
        fs.symlinkSync(relPath, workspaceLink, 'dir');
      }
    } catch (e) {}
  }

  // Ensure runner environment variables (.env) so workflows recognize tool cache and shared repo storage
  try {
    const envFile = path.join(actionsRunnerDir, '.env');
    const envContent = [
      'RUNNER_TOOL_CACHE=/opt/hostedtoolcache',
      `SHARED_REPO_DATA=${sharedRepoDir}`
    ].join('\n') + '\n';
    fs.writeFileSync(envFile, envContent);
  } catch (e) {}

  const runnerRecord = {
    id,
    name: sanitizedName,
    githubUrl: options.githubUrl,
    registrationToken: options.registrationToken || options.token || '',
    labels: options.labels || 'self-hosted,linux,x64',
    runnerGroup: options.runnerGroup || 'Default',
    dir: runnerDir,
    workDir,
    pid: null,
    watchdog: !!options.watchdog,
    status: 'PROVISIONING',
    lastState: 'PROVISIONING',
    createdDate: new Date().toISOString(),
    version: '2.337.0'
  };

  const runners = db.getRunners();
  runners.push(runnerRecord);
  db.saveRunners(runners);

  logService.addSystemLog('INFO', `Runner container slot '${sanitizedName}' created in background. Starting GitHub registration...`);

  // Asynchronous background registration
  setImmediate(() => {
    try {
      let regToken = options.registrationToken || options.token;
      if (regToken && (regToken.startsWith('ghp_') || regToken.startsWith('github_pat_') || options.tokenType === 'pat')) {
        const targetUrlClean = (options.githubUrl || '').replace(/\/$/, '');
        let apiUrl = '';
        const orgMatch = targetUrlClean.match(/https:\/\/github\.com\/orgs\/([^/]+)/);
        const repoMatch = targetUrlClean.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)/);
        if (orgMatch) {
          apiUrl = `https://api.github.com/orgs/${orgMatch[1]}/actions/runners/registration-token`;
        } else if (repoMatch) {
          apiUrl = `https://api.github.com/repos/${repoMatch[1]}/${repoMatch[2]}/actions/runners/registration-token`;
        }
        if (apiUrl) {
          try {
            const authHeader = (regToken.startsWith('github_pat_') || regToken.startsWith('ghp_')) ? `Bearer ${regToken}` : `token ${regToken}`;
            const curlCmd = `curl -s -X POST -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${apiUrl}"`;
            const tokenRes = execSync(curlCmd, { encoding: 'utf-8' });
            const parsed = JSON.parse(tokenRes || '{}');
            if (parsed.token) {
              regToken = parsed.token;
              logService.addSystemLog('INFO', `Successfully exchanged GitHub PAT for fresh runner registration token for '${sanitizedName}'.`);
            } else {
              const errMsg = parsed.message || 'GitHub API did not return registration token';
              logService.addSystemLog('WARN', `GitHub PAT exchange failed: ${errMsg}`);
            }
          } catch (e) {
            logService.addSystemLog('WARN', `Failed to exchange GitHub PAT for registration token: ${e.message}`);
          }
        }
      }

      const cleanLabels = (options.labels || 'self-hosted,linux,x64')
        .split(',')
        .map(l => l.trim())
        .filter(Boolean)
        .join(',');

      const configArgs = [
        '--url', options.githubUrl,
        '--token', regToken,
        '--name', sanitizedName,
        '--labels', cleanLabels,
        '--work', workDir,
        '--unattended',
        '--replace'
      ];
      if (options.runnerGroup) {
        configArgs.push('--runnergroup', options.runnerGroup);
      }

      const child = spawn('./config.sh', configArgs, { cwd: actionsRunnerDir });
      let output = '';
      child.stdout.on('data', d => { output += d.toString(); });
      child.stderr.on('data', d => { output += d.toString(); });

      child.on('close', code => {
        const currentRunners = db.getRunners();
        const rIndex = currentRunners.findIndex(r => r.id === id);
        if (rIndex === -1) return;

        if (code === 0) {
          logService.addSystemLog('INFO', `Successfully registered runner container '${sanitizedName}' targeting ${options.githubUrl}`);
          currentRunners[rIndex].status = 'OFFLINE';
          currentRunners[rIndex].lastState = 'OFFLINE';
          delete currentRunners[rIndex].lastError;
          db.saveRunners(currentRunners);
          startRunner(id);
        } else {
          let userMsg = 'Runner registration failed on GitHub.';
          if (output.includes('404')) {
            userMsg = 'GitHub returned 404 Not Found. Ephemeral registration tokens (BNX...) expire after 1 hour — use a GitHub Personal Access Token (ghp_...) or generate a new registration token in GitHub repo Settings.';
          } else if (output.includes('401') || output.includes('Unauthorized')) {
            userMsg = 'GitHub authentication failed. Your Token is invalid or expired.';
          }
          logService.addSystemLog('ERROR', `Failed to register runner '${sanitizedName}': ${userMsg}`);
          currentRunners[rIndex].status = 'OFFLINE';
          currentRunners[rIndex].lastError = userMsg;
          db.saveRunners(currentRunners);

          try {
            const logDir = path.join(runnerDir, 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            fs.appendFileSync(path.join(logDir, 'runner.log'), `\n[ERROR] Configuration / Runtime Error: ${userMsg}\n`);
          } catch (e) {}
        }
      });
    } catch (err) {
      logService.addSystemLog('ERROR', `Exception during background provisioning for '${sanitizedName}': ${err.message}`);
      const currentRunners = db.getRunners();
      const rIndex = currentRunners.findIndex(r => r.id === id);
      if (rIndex !== -1) {
        currentRunners[rIndex].status = 'OFFLINE';
        currentRunners[rIndex].lastError = err.message;
        db.saveRunners(currentRunners);
      }
    }
  });

  return { success: true, runner: runnerRecord };
}

// Ensures repository workspace symlink points directly to persistent shared data.
function ensureSharedRepoLink(runner) {
  try {
    const repoInfo = extractRepoInfo(runner.githubUrl);
    const repoName = repoInfo.repo || repoInfo.fullKey;
    if (!repoName) return;
    const sharedRepoDir = path.join(SHARED_DATA_DIR, repoName);
    if (!fs.existsSync(sharedRepoDir)) fs.mkdirSync(sharedRepoDir, { recursive: true });
    const workDir = runner.workDir || path.join(getRunnerDir(runner), '_work');
    const repoOuterDir = path.join(workDir, repoName);
    if (!fs.existsSync(repoOuterDir)) fs.mkdirSync(repoOuterDir, { recursive: true });
    const workspaceLink = path.join(repoOuterDir, repoName);
    if (!fs.existsSync(workspaceLink)) {
      const relPath = path.relative(repoOuterDir, sharedRepoDir);
      fs.symlinkSync(relPath, workspaceLink, 'dir');
    }
  } catch (e) {}
}

// Cancels active GitHub Actions workflow runs for target repository via GitHub API.
function cancelRun(runner) {
  if (!runner || !runner.githubUrl) return { canceled: 0 };
  const repoInfo = extractRepoInfo(runner.githubUrl);
  if (!repoInfo.org || !repoInfo.repo) return { canceled: 0 };

  const settings = db.getSettings();
  const pat = (runner.registrationToken && (runner.registrationToken.startsWith('ghp_') || runner.registrationToken.startsWith('github_pat_')) ? runner.registrationToken : null)
    || (settings.accessToken && settings.accessToken.trim())
    || process.env.GITHUB_PAT || process.env.PAT || process.env.GITHUB_TOKEN || null;

  if (!pat) {
    return { canceled: 0, reason: 'no_pat' };
  }

  try {
    const authHeader = (pat.startsWith('github_pat_') || pat.startsWith('ghp_')) ? `Bearer ${pat}` : `token ${pat}`;
    const listUrl = `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runs?status=in_progress`;
    const listCmd = `curl -s -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${listUrl}"`;
    const res = execSync(listCmd, { encoding: 'utf-8', timeout: 8000 });
    const parsed = JSON.parse(res || '{}');
    const runs = parsed.workflow_runs || [];

    let count = 0;
    for (const run of runs) {
      logService.addSystemLog('INFO', `Cancelling active GitHub workflow run #${run.id} ('${run.name || 'workflow'}') on ${repoInfo.fullKey}...`);
      const cancelUrl = `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runs/${run.id}/cancel`;
      const cancelCmd = `curl -s -X POST -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${cancelUrl}"`;
      execSync(cancelCmd, { encoding: 'utf-8', timeout: 8000 });
      count++;
    }

    if (count > 0) {
      logService.addSystemLog('INFO', `Sent cancellation request for ${count} active workflow run(s) on ${repoInfo.fullKey}.`);
    }
    return { canceled: count };
  } catch (err) {
    logService.addSystemLog('WARN', `Failed to cancel active workflow runs on ${repoInfo.fullKey}: ${err.message}`);
    return { canceled: 0, error: err.message };
  }
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

  // Cancel any lingering active workflow runs on GitHub before starting fresh session
  cancelRun(runner);

  // Check if runner process is already running to prevent duplicate sessions
  if (runner.pid) {
    try {
      process.kill(runner.pid, 0);
      return { success: true, message: `Runner '${runner.name}' is already running.`, pid: runner.pid };
    } catch (e) {
      runner.pid = null;
    }
  }

  if (!fs.existsSync(runnerConfigFile)) {
    const errorMsg = runner.lastError || 'Runner is not configured with GitHub. Please provide a valid registration token.';
    logService.addSystemLog('WARN', `Cannot start runner '${runner.name}': ${errorMsg}`);
    runner.status = 'CRASHED';
    runner.lastError = errorMsg;
    runners[runnerIndex] = runner;
    db.saveRunners(runners);

    try {
      const logDir = path.join(runnerDir, 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, 'runner.log'), `\n[ERROR] Configuration / Runtime Error: ${errorMsg}\n`);
    } catch (e) {}

    return { error: errorMsg };
  }

  const logsDir = path.join(runnerDir, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const logFilePath = path.join(logsDir, 'runner.log');

  // Archive existing log file if not empty before starting fresh session
  try {
    if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > 0) {
      const archiveDir = path.join(logsDir, 'archive');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(logFilePath, path.join(archiveDir, `runner_${stamp}.log`));
    }
  } catch (e) {}

  ensureSharedRepoLink(runner);

  // Truncate the log file on each fresh start so previous session logs don't bleed in
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

  logService.addSystemLog('INFO', `Sent START command to runner container '${runner.name}' (PID: ${child.pid}).`);

  return { success: true, pid: child.pid };
}

// Stops a runner container process group and cleans up any orphaned runner sub-processes.
function stopRunner(id) {
  const runners = db.getRunners();
  const runnerIndex = runners.findIndex(r => r.id === id);
  if (runnerIndex === -1) return { error: 'Runner not found' };

  const runner = runners[runnerIndex];
  const runnerDir = getRunnerDir(runner);
  const actionsRunnerDir = path.join(runnerDir, 'actions-runner');

  // Cancel any active GitHub workflow runs via GitHub API (if PAT is available)
  cancelRun(runner);

  // Send graceful SIGINT (kill -2) so Runner.Listener notifies GitHub of run cancellation
  if (runner.pid) {
    try {
      execSync(`kill -2 -${runner.pid} 2>/dev/null || kill -2 ${runner.pid} 2>/dev/null || true`);
      logService.addSystemLog('INFO', `Sent graceful cancel signal (SIGINT) to runner container '${runner.name}' (PID: ${runner.pid}).`);
    } catch (e) {}

    // Allow Runner.Listener up to 2 seconds to report job cancellation to GitHub and exit
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

  logService.addSystemLog('INFO', `Sent STOP command to runner container '${runner.name}'.`);

  return { success: true };
}

// Restarts a runner container by invoking stopRunner followed by startRunner.
function restartRunner(id) {
  logService.addSystemLog('INFO', `Sent RESTART command to runner container ID '${id}'.`);
  stopRunner(id);
  return startRunner(id);
}

// Removes runner registration, unregisters from GitHub, archives log files, and cleans up directory.
function removeRunner(id, removeWorkDir = false, token = null) {
  stopRunner(id);
  const runners = db.getRunners();
  const runnerIndex = runners.findIndex(r => r.id === id);
  if (runnerIndex === -1) {
    logService.addSystemLog('WARN', `Attempted to delete runner ID '${id}' but runner was not registered or already removed.`);
    return { error: 'Runner not found' };
  }

  const runner = runners[runnerIndex];

  // 1. Attempt automatic GitHub API unregistration if a PAT is available
  const patToken = token || 
    (runner.registrationToken && (runner.registrationToken.startsWith('ghp_') || runner.registrationToken.startsWith('github_pat_')) ? runner.registrationToken : null) || 
    (db.getSettings().accessToken && db.getSettings().accessToken.trim());

  if (patToken && runner.githubUrl) {
    try {
      const repoInfo = extractRepoInfo(runner.githubUrl);
      const authHeader = (patToken.startsWith('github_pat_') || patToken.startsWith('ghp_')) ? `Bearer ${patToken}` : `token ${patToken}`;
      const listUrl = repoInfo.repo 
        ? `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runners`
        : `https://api.github.com/orgs/${repoInfo.org}/actions/runners`;

      const curlList = `curl -s -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${listUrl}"`;
      const listRes = execSync(curlList, { encoding: 'utf-8' });
      const parsed = JSON.parse(listRes || '{}');

      if (Array.isArray(parsed.runners)) {
        const match = parsed.runners.find(r => r.name === runner.name);
        if (match && match.id) {
          const deleteUrl = repoInfo.repo 
            ? `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runners/${match.id}`
            : `https://api.github.com/orgs/${repoInfo.org}/actions/runners/${match.id}`;
          const curlDel = `curl -s -X DELETE -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${deleteUrl}"`;
          execSync(curlDel);
          logService.addSystemLog('INFO', `Successfully unregistered and removed runner '${runner.name}' (GitHub ID: ${match.id}) from GitHub.`);
        }
      }
    } catch (e) {
      logService.addSystemLog('WARN', `Could not automatically unregister runner '${runner.name}' from GitHub API: ${e.message}`);
    }
  } else {
    logService.addSystemLog('INFO', `Runner '${runner.name}' removed locally. (To remove offline runner on GitHub.com: Repo Settings -> Actions -> Runners -> '...' -> Remove runner).`);
  }

  // 2. Archive runner logs to persistent data directory before deletion
  try {
    const archiveBase = path.join(process.env.DATA_DIR || '/app/data', 'archived-logs', runner.name || id);
    if (!fs.existsSync(archiveBase)) {
      fs.mkdirSync(archiveBase, { recursive: true });
    }
    const runnerLog = path.join(runner.dir, 'logs', 'runner.log');
    if (fs.existsSync(runnerLog)) {
      fs.copyFileSync(runnerLog, path.join(archiveBase, 'runner.log'));
    }
    const diagDir = path.join(runner.dir, 'actions-runner', '_diag');
    if (fs.existsSync(diagDir)) {
      const archiveDiag = path.join(archiveBase, '_diag');
      if (!fs.existsSync(archiveDiag)) fs.mkdirSync(archiveDiag, { recursive: true });
      const files = fs.readdirSync(diagDir).filter(f => f.startsWith('Runner_') || f.startsWith('Worker_'));
      files.forEach(f => {
        try {
          fs.copyFileSync(path.join(diagDir, f), path.join(archiveDiag, f));
        } catch (e) {}
      });
    }
    logService.addSystemLog('INFO', `Archived logs for runner '${runner.name || id}' to /app/data/archived-logs/${runner.name || id}/`);
  } catch (err) {
    // ignore archive errors
  }

  if (fs.existsSync(runner.dir)) {
    if (removeWorkDir) {
      execSync(`rm -rf ${runner.dir} || true`);
    } else {
      const actionsRunnerDir = path.join(runner.dir, 'actions-runner');
      execSync(`rm -rf ${actionsRunnerDir} || true`);
    }
  }

  runners.splice(runnerIndex, 1);
  db.saveRunners(runners);

  logService.addSystemLog('INFO', `Deleted runner container '${runner.name}' (ID: ${id}).`);

  return { success: true };
}

// Updates configuration metadata parameters for an existing runner instance.
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

  logService.addSystemLog('INFO', `Updated configuration settings for runner container '${runner.name}'.`);
  return { success: true, runner };
}

// Sends start command to all registered runner containers.
function startAllRunners() {
  const runners = db.getRunners();
  const results = runners.map(r => startRunner(r.id));
  logService.addSystemLog('INFO', `Sent START ALL command to all (${results.length}) runner containers.`);
  return { success: true, count: results.length };
}

// Sends stop command to all active runner containers.
function stopAllRunners() {
  const runners = db.getRunners();
  const results = runners.map(r => stopRunner(r.id));
  logService.addSystemLog('INFO', `Sent STOP ALL command to all (${results.length}) runner containers.`);
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
  cancelRun
};
