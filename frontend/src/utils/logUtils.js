/**
 * Format uptime seconds into human-readable string (e.g., 2d 04h 15m 30s)
 */
export function formatUptime(seconds) {
  const s = Math.floor(seconds || 0);
  const days = Math.floor(s / 86400);
  const hrs  = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mins = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const secs = String(s % 60).padStart(2, '0');
  return days > 0 ? `${days}d ${hrs}h ${mins}m ${secs}s` : `${hrs}h ${mins}m ${secs}s`;
}

/**
 * Copy logs array to clipboard (supports both HTTPS and non-secure HTTP contexts)
 */
export function handleCopyLogs(logsArray, triggerToast) {
  const text = Array.isArray(logsArray) ? logsArray.join('\n') : String(logsArray || '');
  if (!text || !text.trim()) {
    if (triggerToast) triggerToast('No logs available to copy', 'info');
    return false;
  }

  // If on non-secure origin (e.g. http://192.168.0.100:3000), execute synchronous fallback immediately
  // to stay within the browser's active user gesture activation window.
  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    return copyFallback(text, triggerToast);
  }

  // Secure context (HTTPS or localhost)
  navigator.clipboard.writeText(text)
    .then(() => {
      if (triggerToast) triggerToast('Logs copied to clipboard!', 'success');
    })
    .catch(() => {
      copyFallback(text, triggerToast);
    });
  return true;
}

function copyFallback(text, triggerToast) {
  let success = false;
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    success = document.execCommand('copy');
    document.body.removeChild(textArea);
  } catch (err) {
    success = false;
  }

  if (triggerToast) {
    if (success) {
      triggerToast('Logs copied to clipboard!', 'success');
    } else {
      triggerToast('Unable to copy logs to clipboard', 'error');
    }
  }
  return success;
}

/**
 * Download logs array as a .txt file
 */
export function handleSaveLogFile(filename, logsArray, triggerToast) {
  const cleanName = filename.replace(/\.(log|txt)$/, '') + '.txt';
  const text = Array.isArray(logsArray) ? logsArray.join('\r\n') : String(logsArray);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = cleanName;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (link.parentNode) link.parentNode.removeChild(link);
  }, 2500);
  if (triggerToast) triggerToast(`Downloaded ${cleanName}`, 'success');
}

/**
 * Normalize raw log line into [timestamp] [source] [level] message
 */
export function normalizeLogLine(line, sourceHint = 'global', lastTs = '', showSource = true, settings = {}) {
  if (!line || !line.trim()) return { text: '', ts: lastTs };

  let source = sourceHint;
  let level = 'INFO';
  let timestamp = '';
  let msg = line.trim();

  const globalPfx = msg.match(/^global\s*-\s*(.*)/s);
  if (globalPfx) { source = 'global'; msg = globalPfx[1].trim(); }

  if (!globalPfx) {
    const dockerPfx = msg.match(/^docker\s*-\s*(.*)/s);
    if (dockerPfx) {
      source = 'docker';
      msg = dockerPfx[1].trim();
      const innerName = msg.match(/^\[([^\d\]]{1}[^\]]*)\]\s*(.*)/s);
      if (innerName) { source = innerName[1].trim(); msg = innerName[2].trim(); }
    }
  }

  if (source === sourceHint) {
    const runnerPfx = msg.match(/^\[([^\d\]][^\]]*)\]\s*(.*)/s);
    if (runnerPfx && !/^\d{4}-\d{2}-\d{2}/.test(runnerPfx[1])) {
      source = runnerPfx[1].trim();
      msg = runnerPfx[2].trim();
    }
  }

  const tsBracketed = msg.match(/^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]\s*(.*)/s);
  if (tsBracketed) {
    timestamp = tsBracketed[1].replace('T', ' ').slice(0, 19);
    msg = tsBracketed[2].trim();
  } else {
    const tsBare = msg.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)[: ]\s*(.*)/s);
    if (tsBare) {
      timestamp = tsBare[1].replace('T', ' ').slice(0, 19);
      msg = tsBare[2].trim();
    }
  }

  const ts = timestamp || lastTs;
  const lvlMatch = msg.match(/^\[([A-Z]{3,5})(?:\s+[^\]]*)?\]\s*(.*)/s);
  if (lvlMatch) {
    level = lvlMatch[1];
    msg = lvlMatch[2].trim();
  } else {
    if (/\[ERROR\]|\[ERR\]/i.test(msg)) level = 'ERROR';
    else if (/\[WARN\]|\[WARNING\]/i.test(msg)) level = 'WARN';
    else if (/\[DEBUG\]|\[TRACE\]/i.test(msg)) level = 'DEBUG';
  }

  let text;
  if (settings.showTimestamps === false) {
    text = showSource ? `[${source}] [${level}] ${msg}` : `[${level}] ${msg}`;
  } else if (ts) {
    text = showSource ? `[${ts}] [${source}] [${level}] ${msg}` : `[${ts}] [${level}] ${msg}`;
  } else {
    text = showSource ? `[${source}] [${level}] ${msg}` : `[${level}] ${msg}`;
  }

  return { text, ts: timestamp || lastTs };
}

/**
 * Render log lines array with timestamps filled forward/backward
 */
export function renderLogLines(lines, sourceHint, showSource = true, settings = {}) {
  const tsList = lines.map(line => {
    const m = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
    return m ? m[1].replace('T', ' ') : null;
  });
  let fwd = '';
  const fwdFill = tsList.map(ts => { if (ts) fwd = ts; return fwd; });
  let bwd = '';
  const bwdFill = [...tsList].reverse().map(ts => { if (ts) bwd = ts; return bwd; }).reverse();
  const resolvedTs = fwdFill.map((f, i) => f || bwdFill[i] || '');

  return lines.map((line, i) => {
    const result = normalizeLogLine(line, sourceHint, resolvedTs[i], showSource, settings);
    return result.text;
  }).filter(Boolean);
}
