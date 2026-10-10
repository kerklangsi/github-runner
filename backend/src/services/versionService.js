const https = require('https');

const CURRENT_VERSION = 'v4.0.3';
const GITHUB_REPO = 'kerklangsi/github-runner';
const DOCKERHUB_REPO = 'kerklangsi/github-runner';

let cachedVersionInfo = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'github-runner-manager', ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function compareVersions(v1, v2) {
  const clean1 = (v1 || '').replace(/^v/, '').split('.').map(Number);
  const clean2 = (v2 || '').replace(/^v/, '').split('.').map(Number);
  const len = Math.max(clean1.length, clean2.length);
  for (let i = 0; i < len; i++) {
    const num1 = clean1[i] || 0;
    const num2 = clean2[i] || 0;
    if (num2 > num1) return 1;  // v2 is newer
    if (num1 > num2) return -1; // v1 is newer
  }
  return 0;
}

async function checkVersion() {
  const now = Date.now();
  if (cachedVersionInfo && (now - lastCheckTime) < CACHE_TTL_MS) {
    return cachedVersionInfo;
  }

  let latestVersion = CURRENT_VERSION;
  let releaseNotes = '';
  let publishedAt = '';
  let releaseName = '';

  let found = false;

  // 1. Try GitHub Latest Release API
  try {
    const ghData = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (ghData && ghData.tag_name) {
      latestVersion = ghData.tag_name;
      releaseName = ghData.name || ghData.tag_name;
      releaseNotes = ghData.body || '';
      publishedAt = ghData.published_at || '';
      found = true;
    }
  } catch (err) {}

  // 2. Try GitHub Tags API if no official GitHub release object exists yet
  if (!found) {
    try {
      const tagsData = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/tags`);
      if (Array.isArray(tagsData) && tagsData.length > 0) {
        const validTag = tagsData.find(t => /^v?\d+\.\d+/.test(t.name));
        if (validTag) {
          latestVersion = validTag.name;
          releaseName = validTag.name;
          found = true;
        }
      }
    } catch (tagErr) {}
  }

  // 3. Fallback: query Docker Hub tags API
  if (!found) {
    try {
      const dhData = await fetchJson(`https://hub.docker.com/v2/repositories/${DOCKERHUB_REPO}/tags?page_size=10`);
      if (dhData && dhData.results) {
        const validTag = dhData.results.find(t => t.name !== 'latest' && /^v?\d+\.\d+/.test(t.name));
        if (validTag) {
          latestVersion = validTag.name;
          publishedAt = validTag.last_updated || '';
        }
      }
    } catch (dhErr) {}
  }

  const updateAvailable = compareVersions(CURRENT_VERSION, latestVersion) > 0;

  cachedVersionInfo = {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    updateAvailable,
    releaseName: releaseName || latestVersion,
    releaseNotes,
    publishedAt,
    githubUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
    githubRepoUrl: `https://github.com/${GITHUB_REPO}`,
    dockerHubUrl: `https://hub.docker.com/r/${DOCKERHUB_REPO}`
  };

  lastCheckTime = now;
  return cachedVersionInfo;
}

module.exports = {
  CURRENT_VERSION,
  GITHUB_REPO,
  DOCKERHUB_REPO,
  checkVersion
};
