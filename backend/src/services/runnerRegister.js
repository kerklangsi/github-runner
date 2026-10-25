const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const db = require('../db/database');
const sharedStorage = require('./sharedStorage');

// Exchanges GitHub Personal Access Token for fresh runner registration token.
function fetchToken(token, githubUrl, runnerName = '') {
  if (!token || (!token.startsWith('ghp_') && !token.startsWith('github_pat_'))) return token;
  const cleanUrl = (githubUrl || '').replace(/\/$/, '');
  const orgMatch = cleanUrl.match(/https:\/\/github\.com\/orgs\/([^/]+)/);
  const repoMatch = cleanUrl.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)/);
  let apiUrl = '';
  if (orgMatch) apiUrl = `https://api.github.com/orgs/${orgMatch[1]}/actions/runners/registration-token`;
  else if (repoMatch) apiUrl = `https://api.github.com/repos/${repoMatch[1]}/${repoMatch[2]}/actions/runners/registration-token`;
  if (!apiUrl) return token;

  try {
    const authHeader = (token.startsWith('github_pat_') || token.startsWith('ghp_')) ? `Bearer ${token}` : `token ${token}`;
    const curlCmd = `curl -s -X POST -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${apiUrl}"`;
    const res = execSync(curlCmd, { encoding: 'utf-8', timeout: 10000 });
    const parsed = JSON.parse(res || '{}');
    if (parsed.token) return parsed.token;
  } catch (e) {}
  return token;
}

// Cancels active GitHub Actions workflow runs for target repository via GitHub API.
function cancelRuns(runner) {
  if (!runner || !runner.githubUrl) return { canceled: 0 };
  const repoInfo = sharedStorage.getRepo(runner.githubUrl);
  if (!repoInfo.org || !repoInfo.repo) return { canceled: 0 };

  const settings = db.getSettings();
  const pat = (runner.registrationToken && (runner.registrationToken.startsWith('ghp_') || runner.registrationToken.startsWith('github_pat_')) ? runner.registrationToken : null)
    || (settings.accessToken && settings.accessToken.trim())
    || process.env.GITHUB_PAT || process.env.PAT || process.env.GITHUB_TOKEN || null;

  if (!pat) return { canceled: 0, reason: 'no_pat' };

  try {
    const authHeader = (pat.startsWith('github_pat_') || pat.startsWith('ghp_')) ? `Bearer ${pat}` : `token ${pat}`;
    const listUrl = `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runs?status=in_progress`;
    const listCmd = `curl -s -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${listUrl}"`;
    const res = execSync(listCmd, { encoding: 'utf-8', timeout: 8000 });
    const parsed = JSON.parse(res || '{}');
    const runs = parsed.workflow_runs || [];

    let count = 0;
    for (const run of runs) {
      const cancelUrl = `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runs/${run.id}/cancel`;
      const cancelCmd = `curl -s -X POST -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${cancelUrl}"`;
      try {
        execSync(cancelCmd, { encoding: 'utf-8', timeout: 8000 });
        count++;
      } catch (e) {}
    }
    return { canceled: count };
  } catch (err) {
    return { canceled: 0, error: err.message };
  }
}

// Unregisters a runner from GitHub repository or organization via GitHub REST API.
function unregisterRunner(runner, token = null) {
  const patToken = token ||
    (runner.registrationToken && (runner.registrationToken.startsWith('ghp_') || runner.registrationToken.startsWith('github_pat_')) ? runner.registrationToken : null) ||
    (db.getSettings().accessToken && db.getSettings().accessToken.trim());

  if (!patToken || !runner.githubUrl) return false;

  try {
    const repoInfo = sharedStorage.getRepo(runner.githubUrl);
    const authHeader = (patToken.startsWith('github_pat_') || patToken.startsWith('ghp_')) ? `Bearer ${patToken}` : `token ${patToken}`;
    const listUrl = repoInfo.repo
      ? `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runners`
      : `https://api.github.com/orgs/${repoInfo.org}/actions/runners`;

    const curlList = `curl -s -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${listUrl}"`;
    const listRes = execSync(curlList, { encoding: 'utf-8', timeout: 10000 });
    const parsed = JSON.parse(listRes || '{}');

    if (Array.isArray(parsed.runners)) {
      const match = parsed.runners.find(r => r.name === runner.name);
      if (match && match.id) {
        const deleteUrl = repoInfo.repo
          ? `https://api.github.com/repos/${repoInfo.org}/${repoInfo.repo}/actions/runners/${match.id}`
          : `https://api.github.com/orgs/${repoInfo.org}/actions/runners/${match.id}`;
        const curlDel = `curl -s -X DELETE -H "Authorization: ${authHeader}" -H "User-Agent: GitHubRunnerManager/3.0" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${deleteUrl}"`;
        execSync(curlDel, { timeout: 10000 });
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// Provisions directories and registers runner container slot against GitHub.
function registerRunner(options, onRegistered = null) {
  sharedStorage.ensureDirs();
  const id = `runner-${Date.now()}`;
  const rawName = (options.name || '').trim();
  const sanitizedName = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || `runner-${Date.now().toString().slice(-4)}`;
  const runnerDir = path.join(sharedStorage.BASE_RUNNERS_DIR, sanitizedName);

  const activeRunners = db.getRunners();
  if (activeRunners.some(r => r.name === sanitizedName || r.dir === runnerDir)) {
    return { error: `A runner named '${sanitizedName}' is already registered.` };
  }

  if (fs.existsSync(runnerDir)) execSync(`rm -rf ${runnerDir} || true`);

  const actionsRunnerDir = path.join(runnerDir, 'actions-runner');
  const workDir = path.join(runnerDir, '_work');
  const logsDir = path.join(runnerDir, 'logs');

  fs.mkdirSync(actionsRunnerDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const baseSource = '/actions-runner';
  if (fs.existsSync(baseSource) && fs.existsSync(path.join(baseSource, 'config.sh'))) {
    execSync(`cp -rn ${baseSource}/* ${actionsRunnerDir}/ || true`);
  }

  const { sharedRepoDir, sharedAuthDir } = sharedStorage.setupStorage(options.githubUrl, workDir);

  try {
    const envFile = path.join(actionsRunnerDir, '.env');
    const envContent = [
      'RUNNER_TOOL_CACHE=/opt/hostedtoolcache',
      `SHARED_REPO_DATA=${sharedRepoDir}`,
      `SHARED_AUTH_DIR=${sharedAuthDir}`,
      'ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=true'
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

  setImmediate(() => {
    try {
      const rawToken = options.registrationToken || options.token;
      const regToken = fetchToken(rawToken, options.githubUrl, sanitizedName);
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
      if (options.runnerGroup) configArgs.push('--runnergroup', options.runnerGroup);

      const child = spawn('./config.sh', configArgs, { cwd: actionsRunnerDir });
      let output = '';
      child.stdout.on('data', d => { output += d.toString(); });
      child.stderr.on('data', d => { output += d.toString(); });

      child.on('close', code => {
        const currentRunners = db.getRunners();
        const rIndex = currentRunners.findIndex(r => r.id === id);
        if (rIndex === -1) return;

        if (code === 0) {
          currentRunners[rIndex].status = 'OFFLINE';
          currentRunners[rIndex].lastState = 'OFFLINE';
          delete currentRunners[rIndex].lastError;
          db.saveRunners(currentRunners);
          if (typeof onRegistered === 'function') onRegistered(id);
        } else {
          let userMsg = 'Runner registration failed on GitHub.';
          if (output.includes('404')) userMsg = 'GitHub returned 404 Not Found. Ephemeral registration token expired. Use a GitHub PAT or fresh token.';
          else if (output.includes('401') || output.includes('Unauthorized')) userMsg = 'GitHub authentication failed. Token is invalid or expired.';
          currentRunners[rIndex].status = 'OFFLINE';
          currentRunners[rIndex].lastError = userMsg;
          db.saveRunners(currentRunners);

          try {
            const logDir = path.join(runnerDir, 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            fs.appendFileSync(path.join(logDir, 'runner.log'), `\n[ERROR] Configuration Error: ${userMsg}\n`);
          } catch (e) {}
        }
      });
    } catch (err) {
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

module.exports = {
  fetchToken,
  cancelRuns,
  unregisterRunner,
  registerRunner,
  createRunner: registerRunner,
  cancelRun: cancelRuns
};
