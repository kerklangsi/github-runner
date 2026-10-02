const fs = require('fs');
const path = require('path');

const ALLOWED_ROOTS = [
  process.env.SHARED_DATA_DIR || '/opt/shared_data',
  process.env.RUNNER_DIR || process.env.RUNNERS_DIR || (fs.existsSync('/opt/github-runner') ? '/opt/github-runner' : '/opt/github-runners'),
  process.env.DATA_DIR || '/app/data'
];

// Validates whether candidate path is within allowed storage directories.
function checkPath(candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') return null;
  const resolved = path.resolve(candidatePath);
  const isAllowed = ALLOWED_ROOTS.some(root => {
    const resolvedRoot = path.resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });
  return isAllowed ? resolved : null;
}

// Lists files and subdirectories with metadata for a given path.
function listFiles(targetDir) {
  const safeDir = checkPath(targetDir) || ALLOWED_ROOTS[0];
  if (!fs.existsSync(safeDir)) {
    fs.mkdirSync(safeDir, { recursive: true });
  }

  const stat = fs.statSync(safeDir);
  if (!stat.isDirectory()) {
    throw new Error('Target path is not a directory');
  }

  const entries = fs.readdirSync(safeDir, { withFileTypes: true });
  const items = entries.map(entry => {
    const fullPath = path.join(safeDir, entry.name);
    let size = 0;
    let updatedAt = null;
    let isSymlink = entry.isSymbolicLink();

    try {
      const s = fs.statSync(fullPath);
      size = s.size;
      updatedAt = s.mtime.toISOString();
    } catch (e) {
      try {
        const ls = fs.lstatSync(fullPath);
        updatedAt = ls.mtime.toISOString();
      } catch (err) {}
    }

    return {
      name: entry.name,
      path: fullPath,
      isDirectory: entry.isDirectory(),
      size,
      updatedAt,
      isSymlink
    };
  });

  // Sort directories first, then alphabetical by name
  items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    currentDir: safeDir,
    roots: ALLOWED_ROOTS,
    items
  };
}

// Reads text file content safely up to 2MB for in-browser preview.
function readFile(filePath) {
  const safePath = checkPath(filePath);
  if (!safePath) throw new Error('Access denied: path is outside allowed roots');
  if (!fs.existsSync(safePath)) throw new Error('File not found');

  const s = fs.statSync(safePath);
  if (s.isDirectory()) throw new Error('Target path is a directory');
  if (s.size > 2 * 1024 * 1024) throw new Error('File exceeds 2MB preview limit');

  const content = fs.readFileSync(safePath, 'utf-8');
  return {
    name: path.basename(safePath),
    path: safePath,
    content,
    size: s.size
  };
}

module.exports = {
  ALLOWED_ROOTS,
  checkPath,
  listFiles,
  readFile
};
