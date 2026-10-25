const fs = require('fs');
const path = require('path');

const BASE_RUNNERS_DIR = process.env.RUNNER_DIR || process.env.RUNNERS_DIR || (fs.existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners');
const SHARED_DATA_DIR = process.env.SHARED_DATA_DIR || '/opt/shared_data';

// Ensures base runners and shared data working directories exist on disk.
function ensureDirs() {
  if (!fs.existsSync(BASE_RUNNERS_DIR)) fs.mkdirSync(BASE_RUNNERS_DIR, { recursive: true });
  if (!fs.existsSync(SHARED_DATA_DIR)) fs.mkdirSync(SHARED_DATA_DIR, { recursive: true });
  const sharedAuth = path.join(SHARED_DATA_DIR, 'auth');
  if (!fs.existsSync(sharedAuth)) {
    try { fs.mkdirSync(sharedAuth, { recursive: true }); } catch (e) {}
  }
}

// Parses organization and repository name from target GitHub repository URL.
function getRepo(githubUrl) {
  if (!githubUrl) return { org: '', repo: '', fullKey: 'default' };
  const clean = githubUrl.trim().replace(/\/$/, '');
  const orgMatch = clean.match(/github\.com\/orgs\/([^/]+)/i);
  if (orgMatch) return { org: orgMatch[1], repo: '', fullKey: orgMatch[1] };
  const repoMatch = clean.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (repoMatch) return { org: repoMatch[1], repo: repoMatch[2], fullKey: `${repoMatch[1]}/${repoMatch[2]}` };
  return { org: '', repo: '', fullKey: 'default' };
}

// Sets up shared persistent storage directories and workspace symlinks.
function setupStorage(githubUrl, workDir) {
  const repoInfo = getRepo(githubUrl);
  const repoName = repoInfo.repo || repoInfo.fullKey;
  const sharedRepoDir = path.join(SHARED_DATA_DIR, repoName);
  const sharedAuthDir = path.join(SHARED_DATA_DIR, 'auth');
  const localAuthDir = path.join(sharedRepoDir, 'auth');

  try {
    fs.mkdirSync(sharedAuthDir, { recursive: true });
    fs.mkdirSync(sharedRepoDir, { recursive: true });
    try {
      const stat = fs.lstatSync(localAuthDir);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(localAuthDir);
        if (target.includes(localAuthDir) || target === 'auth' || !fs.existsSync(localAuthDir)) {
          fs.unlinkSync(localAuthDir);
        }
      } else if (!stat.isDirectory()) {
        fs.unlinkSync(localAuthDir);
      }
    } catch (e) {}

    if (!fs.existsSync(localAuthDir)) {
      try {
        fs.symlinkSync(sharedAuthDir, localAuthDir, 'dir');
      } catch (e) {
        fs.mkdirSync(localAuthDir, { recursive: true });
      }
    }
  } catch (e) {}

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

  return { sharedRepoDir, sharedAuthDir, repoInfo };
}

// Ensures workspace symlink points directly to persistent shared data.
function ensureLinks(runner) {
  try {
    const repoInfo = getRepo(runner.githubUrl);
    const repoName = repoInfo.repo || repoInfo.fullKey;
    if (!repoName) return;
    const sharedRepoDir = path.join(SHARED_DATA_DIR, repoName);
    if (!fs.existsSync(sharedRepoDir)) fs.mkdirSync(sharedRepoDir, { recursive: true });
    const runnerDir = runner.dir || runner.runner_dir || runner.runnerDir || path.join(BASE_RUNNERS_DIR, runner.name || 'runner');
    const workDir = runner.workDir || path.join(runnerDir, '_work');
    const repoOuterDir = path.join(workDir, repoName);
    if (!fs.existsSync(repoOuterDir)) fs.mkdirSync(repoOuterDir, { recursive: true });
    const workspaceLink = path.join(repoOuterDir, repoName);
    if (!fs.existsSync(workspaceLink)) {
      const relPath = path.relative(repoOuterDir, sharedRepoDir);
      fs.symlinkSync(relPath, workspaceLink, 'dir');
    }
    const sharedAuthDir = path.join(SHARED_DATA_DIR, 'auth');
    if (!fs.existsSync(sharedAuthDir)) fs.mkdirSync(sharedAuthDir, { recursive: true });
    const localAuthDir = path.join(sharedRepoDir, 'auth');
    if (!fs.existsSync(localAuthDir)) {
      try { fs.symlinkSync(sharedAuthDir, localAuthDir, 'dir'); } catch (e) {}
    }
  } catch (e) {}
}

module.exports = {
  BASE_RUNNERS_DIR,
  SHARED_DATA_DIR,
  ensureDirs,
  getRepo,
  setupStorage,
  ensureLinks,
  extractRepoInfo: getRepo,
  ensureBaseDir: ensureDirs,
  ensureSharedRepoLink: ensureLinks
};
