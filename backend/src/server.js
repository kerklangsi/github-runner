const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const runnerService = require('./services/runnerService');
const systemService = require('./services/systemService');
const logService = require('./services/logService');
const watchdogService = require('./services/watchdogService');
const webhookService = require('./services/webhookService');
const versionService = require('./services/versionService');
const fileService = require('./services/fileService');
const db = require('./db/database');

const app = express();
app.use(cors());
app.use(express.json());

// API Routes

// 0. Authentication Routes
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const currentAuth = db.getAuth();

  if (username === currentAuth.username && password === currentAuth.password) {
    const updatedAuth = { ...currentAuth, lastLogin: new Date().toISOString() };
    db.saveAuth(updatedAuth);
    return res.json({ success: true, username: currentAuth.username, token: 'admin-session-token' });
  }

  return res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/api/auth/me', (req, res) => {
  const currentAuth = db.getAuth();
  res.json({ username: currentAuth.username, lastLogin: currentAuth.lastLogin, avatarUrl: currentAuth.avatarUrl || '/api/user/avatar.png' });
});

app.post('/api/auth/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const currentAuth = db.getAuth();

  if (currentPassword !== currentAuth.password) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
  }

  currentAuth.password = newPassword;
  db.saveAuth(currentAuth);
  res.json({ success: true, message: 'Password updated successfully' });
});

app.post('/api/auth/change-username', (req, res) => {
  const { newUsername } = req.body || {};
  if (!newUsername || !newUsername.trim()) {
    return res.status(400).json({ error: 'Username cannot be empty.' });
  }
  const cleanUsername = newUsername.trim();
  if (cleanUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
  }

  const currentAuth = db.getAuth();
  const oldUsername = currentAuth.username;
  currentAuth.username = cleanUsername;
  db.saveAuth(currentAuth);

  logService.addSystemLog('INFO', `Administrator username changed from '${oldUsername}' to '${cleanUsername}'.`);
  res.json({ success: true, username: cleanUsername, message: 'Username updated successfully' });
});

// Version Check Endpoint
app.get('/api/version/check', async (req, res) => {
  try {
    const info = await versionService.checkVersion();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: 'Failed to check application version' });
  }
});

// Avatar Endpoints
const AVATAR_PATH = path.join(process.env.DATA_DIR || '/app/data', 'avatar.png');

app.get('/api/user/avatar.png', (req, res) => {
  if (fs.existsSync(AVATAR_PATH)) {
    return res.sendFile(AVATAR_PATH);
  }
  // Default SVG avatar fallback
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="#161b22"/><circle cx="64" cy="45" r="24" fill="#58a6ff"/><path d="M20 110 C20 80, 40 75, 64 75 C88 75, 108 80, 108 110 Z" fill="#58a6ff"/></svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

app.post('/api/user/avatar', (req, res) => {
  const { avatarUrl, base64Image } = req.body || {};
  const currentAuth = db.getAuth();

  if (base64Image) {
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    fs.mkdirSync(path.dirname(AVATAR_PATH), { recursive: true });
    fs.writeFileSync(AVATAR_PATH, Buffer.from(base64Data, 'base64'));
    currentAuth.avatarUrl = '/api/user/avatar.png?' + Date.now();
  } else if (avatarUrl) {
    currentAuth.avatarUrl = avatarUrl;
  }

  db.saveAuth(currentAuth);
  logService.addSystemLog('INFO', 'Updated user profile avatar picture.');
  res.json({ success: true, avatarUrl: currentAuth.avatarUrl });
});

// 1. Get all runners
app.get('/api/runners', (req, res) => {
  const runners = runnerService.getAllRunners();
  res.json(runners);
});

// 2. Add a new runner
app.post('/api/runners', (req, res) => {
  const { name, githubUrl, registrationToken, token, accessToken, tokenType, labels, runnerGroup } = req.body;
  const tokenVal = registrationToken || token || accessToken;
  if (!githubUrl || !tokenVal) {
    return res.status(400).json({ error: 'GitHub URL and Token (Registration or Personal Access Token) are required.' });
  }

  const result = runnerService.createRunner({
    name: name || `runner-${Date.now().toString().slice(-4)}`,
    githubUrl,
    registrationToken: tokenVal,
    tokenType,
    labels,
    runnerGroup
  });

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json(result.runner);
});

// 2b. Update individual runner configuration
app.put('/api/runners/:id/config', (req, res) => {
  const result = runnerService.updateRunnerConfig(req.params.id, req.body || {});
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  res.json(result);
});

// 3. Get single runner details
app.get('/api/runners/:id', (req, res) => {
  const runner = runnerService.getRunnerById(req.params.id);
  if (!runner) {
    return res.status(404).json({ error: 'Runner not found' });
  }
  res.json(runner);
});

// 4. Runner controls: Start, Stop, Restart, Start-All, Stop-All
app.post('/api/runners/start-all', (req, res) => {
  const result = runnerService.startAllRunners();
  res.json(result);
});

app.post('/api/runners/stop-all', (req, res) => {
  const result = runnerService.stopAllRunners();
  res.json(result);
});

app.post('/api/runners/:id/start', (req, res) => {
  const result = runnerService.startRunner(req.params.id);
  res.json(result);
});

app.post('/api/runners/:id/stop', (req, res) => {
  const result = runnerService.stopRunner(req.params.id);
  res.json(result);
});

app.post('/api/runners/:id/restart', (req, res) => {
  const result = runnerService.restartRunner(req.params.id);
  res.json(result);
});

// 5. Remove runner
app.delete('/api/runners/:id', (req, res) => {
  const removeWorkDir = req.query.removeWorkDir === 'true';
  const token = req.query.token || req.headers['x-github-token'];
  const result = runnerService.removeRunner(req.params.id, removeWorkDir, token);
  res.json(result);
});

// 6. Get runner logs & Global logs
app.get('/api/logs/global', (req, res) => {
  const limit = req.query.limit || 300;
  const search = req.query.search || '';
  const level = req.query.level || '';
  const result = logService.getGlobalLogs({ limit, search, level });
  res.json(result);
});

app.get('/api/logs/global/download', (req, res) => {
  const result = logService.getGlobalLogs({ limit: 10000 });
  const text = (result.lines || []).join('\r\n');
  const now = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="global_logs_${now}.txt"`);
  res.send(text);
});

app.get('/api/runners/:id/logs', (req, res) => {
  const search = req.query.search || '';
  const level = req.query.level || '';
  const limit = req.query.limit || 200;
  const result = logService.getRunnerLogs(req.params.id, { search, level, limit });
  res.json(result);
});

app.get('/api/runners/:id/logs/download', (req, res) => {
  const runner = runnerService.getRunnerById(req.params.id);
  const runnerName = runner ? (runner.name || req.params.id) : req.params.id;
  const result = logService.getRunnerLogs(req.params.id, { limit: 10000 });
  const header = `=============================================================\r\nGitHub Actions Runner: ${runnerName}\r\nExported: ${new Date().toISOString()}\r\n=============================================================\r\n\r\n`;
  const text = header + (result.lines || []).join('\r\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${runnerName}_logs.txt"`);
  res.send(text);
});

app.post('/api/runners/:id/logs/clear', (req, res) => {
  logService.clearRunnerLogs(req.params.id);
  res.json({ success: true, message: 'Runner logs cleared successfully' });
});

// 7. Live SSE Log Stream
app.get('/api/runners/:id/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const runnerId = req.params.id;
  const interval = setInterval(() => {
    const logs = logService.getRunnerLogs(runnerId, { limit: 50 });
    res.write(`data: ${JSON.stringify(logs)}\n\n`);
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// 8. System metrics
app.get('/api/system', (req, res) => {
  systemService.getSystemMetrics((err, metrics) => {
    res.json(metrics);
  });
});

// 9. Job history
app.get('/api/jobs', (req, res) => {
  const jobs = db.getJobs();
  res.json(jobs);
});

// 10. Settings
app.get('/api/settings', (req, res) => {
  const settings = db.getSettings();
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  db.saveSettings(req.body);
  // Apply watchdog and webhook settings immediately
  watchdogService.updateSettings(req.body);
  webhookService.updateSettings(req.body);
  logService.addSystemLog('INFO', 'Saved global system and log settings.');
  res.json({ success: true, settings: req.body });
});

// 11. Clear Global Logs
app.post('/api/logs/global/clear', (req, res) => {
  logService.clearGlobalLogs();
  res.json({ success: true, message: 'Global logs buffer cleared successfully' });
});

// 13. Workflow History (log-parsed per runner)
function parseWorkflowHistory(runnerId) {
  try {
    const runner = runnerService.getRunnerById(runnerId);
    if (!runner) return [];
    const defaultBase = (process.env.RUNNER_DIR || (require('fs').existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners'));
    const runnerDir = runner.dir || runner.runner_dir || runner.runnerDir || `${defaultBase}/${runner.name || runnerId}`;
    const logFile = require('path').join(runnerDir, 'logs', 'runner.log');
    if (!require('fs').existsSync(logFile)) return [];
    const lines = require('fs').readFileSync(logFile, 'utf-8').split('\n');
    const jobs = [];
    let current = null;
    for (const line of lines) {
      const startMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}).*Running job:\s*(.+)/i);
      const doneMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}).*Job .* (completed|failed|succeed)/i);
      const queueMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}).*Listening for Jobs/);
      if (startMatch) {
        current = { name: startMatch[2].trim(), startTime: startMatch[1].replace('T', ' ').slice(0, 19), endTime: null, duration: null, status: 'running' };
      } else if (doneMatch && current) {
        current.endTime = doneMatch[1].replace('T', ' ').slice(0, 19);
        const start = new Date(current.startTime).getTime();
        const end = new Date(current.endTime).getTime();
        current.duration = Math.round((end - start) / 1000);
        current.status = doneMatch[2].toLowerCase().includes('fail') ? 'failed' : 'success';
        jobs.push(current);
        current = null;
      }
    }
    return jobs.slice(-50).reverse();
  } catch (e) { return []; }
}

app.get('/api/runners/:id/workflows', (req, res) => {
  res.json(parseWorkflowHistory(req.params.id));
});

app.get('/api/workflows', (req, res) => {
  const runners = runnerService.getAllRunners();
  const all = runners.flatMap(r => parseWorkflowHistory(r.id).map(j => ({ ...j, runner: r.name })));
  all.sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''));
  res.json(all.slice(0, 100));
});

// 14. File Explorer Endpoints
app.get('/api/files', (req, res) => {
  try {
    const dir = req.query.dir || fileService.ALLOWED_ROOTS[0];
    const data = fileService.listFiles(dir);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/files/content', (req, res) => {
  try {
    const file = req.query.file;
    if (!file) return res.status(400).json({ error: 'File path required' });
    const data = fileService.readFile(file);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/files/download', (req, res) => {
  try {
    const file = req.query.file;
    const safePath = fileService.checkPath(file);
    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }
    res.download(safePath, path.basename(safePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Backup & Restore (supported on both /api/backup and /api/settings/backup)
const handleBackupReq = (req, res) => {
  const runners = runnerService.getAllRunners().map(r => ({
    name: r.name, githubUrl: r.githubUrl, registrationToken: r.registrationToken,
    labels: r.labels, runnerGroup: r.runnerGroup, watchdog: r.watchdog
  }));
  const settings = db.getSettings();
  const backup = { version: 1, exportedAt: new Date().toISOString(), runners, settings };
  res.setHeader('Content-Disposition', `attachment; filename="runner-manager-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(backup);
};
app.get('/api/backup', handleBackupReq);
app.get('/api/settings/backup', handleBackupReq);

const handleRestoreReq = (req, res) => {
  try {
    const { runners, settings } = req.body || {};
    if (settings) {
      db.saveSettings(settings);
      watchdogService.updateSettings(settings);
      webhookService.updateSettings(settings);
    }
    let restored = 0;
    if (Array.isArray(runners)) {
      const existing = runnerService.getAllRunners();
      for (const cfg of runners) {
        const found = existing.find(r => r.name === cfg.name);
        if (found) {
          runnerService.updateRunnerConfig(found.id, cfg);
          restored++;
        } else if (cfg.name && cfg.githubUrl && (cfg.registrationToken || cfg.token)) {
          runnerService.createRunner(cfg);
          restored++;
        }
      }
    }
    logService.addSystemLog('INFO', `Backup restored: ${restored} runner container config(s) processed.`);
    res.json({ success: true, runnersRestored: restored });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
app.post('/api/restore', handleRestoreReq);
app.post('/api/settings/restore', handleRestoreReq);

// 15. Webhook test
app.post('/api/webhook/test', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL required' });
  const result = await webhookService.test(url);
  res.json(result);
});

// 12. Interactive Terminal Execution
app.post('/api/terminal/exec', (req, res) => {
  const { command, cwd } = req.body || {};
  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ error: 'Command cannot be empty' });
  }

  const workDir = (cwd && fs.existsSync(cwd)) ? cwd : '/app';
  const execCmd = command.trim();

  exec(execCmd, { cwd: workDir, shell: '/bin/bash', timeout: 30000, maxBuffer: 1024 * 1024 * 2 }, (error, stdout, stderr) => {
    const exitCode = error ? (error.code !== undefined ? error.code : 1) : 0;
    res.json({
      command: execCmd,
      stdout: stdout || '',
      stderr: stderr || (error && error.message && !stdout ? error.message : ''),
      exitCode,
      cwd: workDir
    });
  });
});

// Serve frontend static assets if built
const frontendDist = require('path').join(__dirname, '../../frontend/dist');
if (require('fs').existsSync(frontendDist)) {
  app.use(require('express').static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(require('path').join(frontendDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`GitHub Runner Manager Backend running on port ${PORT}`);
  // Initialize watchdog and webhook with persisted settings
  const savedSettings = db.getSettings();
  watchdogService.updateSettings(savedSettings);
  webhookService.updateSettings(savedSettings);
});
