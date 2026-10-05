import React, { useState } from 'react';
import { Settings, Archive, Trash2, Loader2 } from 'lucide-react';

export default function LogLevelCard({
  settings,
  handleLogLevelChange,
  autoSaveSettings,
  triggerToast
}) {
  const [cleaning, setCleaning] = useState(false);

  // Updates archive retention policy and persists settings
  function handleRetention(val) {
    if (autoSaveSettings) {
      autoSaveSettings({ ...settings, archiveRetention: val }, `Archive retention set to ${val}`);
    }
  }

  // Updates custom retention days and persists settings
  function handleDays(val) {
    const days = Math.max(1, parseInt(val, 10) || 1);
    if (autoSaveSettings) {
      autoSaveSettings({ ...settings, archiveRetentionDays: days }, `Retention threshold set to ${days} days`);
    }
  }

  // Triggers immediate archive cleanup via backend API
  function triggerClean() {
    setCleaning(true);
    fetch('/api/logs/archives/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        retention: settings.archiveRetention || 'never',
        customDays: settings.archiveRetentionDays || 30
      })
    })
      .then(res => res.json())
      .then(data => {
        setCleaning(false);
        if (triggerToast) {
          if (data.deleted > 0) {
            triggerToast(`Deleted ${data.deleted} old archive file(s)`, 'success');
          } else {
            triggerToast('No archives matched deletion policy', 'info');
          }
        }
      })
      .catch(() => {
        setCleaning(false);
        if (triggerToast) triggerToast('Failed to clean archives', 'error');
      });
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-4">
      <div className="border-b border-[#30363d] pb-3">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Settings className="w-4 h-4 text-[#a371f7]" /> Log &amp; Archive Management
        </h2>
        {settings.showHeadlines && (
          <p className="text-xs text-[#8b949e] mt-1">Configure logger verbosity, unfiltered debug stream, and automatic archive retention.</p>
        )}
      </div>

      {/* Log Verbosity Selection */}
      <div className="bg-[#0d1117] border border-[#30363d] p-4 rounded-xl space-y-2">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-[#a371f7]" />
          <h4 className="text-sm font-semibold text-white">Verbosity Level</h4>
        </div>
        <p className="text-xs text-[#8b949e]">Filter which log messages are shown in live views and downloads</p>
        <select
          value={settings.logLevel || 'INFO'}
          onChange={e => handleLogLevelChange(e.target.value)}
          className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#58a6ff] mt-1"
        >
          <option value="ERROR">1. ERROR — Critical errors only</option>
          <option value="WARN">2. WARN — Warnings &amp; errors</option>
          <option value="INFO">3. INFO — Standard (Default)</option>
          <option value="DEBUG">4. DEBUG — Full diagnostics (Unfiltered action logs)</option>
        </select>
        {settings.logLevel === 'DEBUG' && (
          <p className="text-[11px] text-[#58a6ff] bg-[#1f6feb]/10 border border-[#1f6feb]/20 p-2 rounded-lg mt-1">
            DEBUG mode active: Runner workflow action logs will be displayed without filtering step boundaries.
          </p>
        )}
      </div>

      {/* Archive Retention Policy */}
      <div className="bg-[#0d1117] border border-[#30363d] p-4 rounded-xl space-y-3">
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 text-[#58a6ff]" />
          <h4 className="text-sm font-semibold text-white">Archive Retention</h4>
        </div>
        <p className="text-xs text-[#8b949e]">Automatically prune archived system, docker, and runner logs</p>
        
        <div className="space-y-2">
          <select
            value={settings.archiveRetention || 'never'}
            onChange={e => handleRetention(e.target.value)}
            className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#58a6ff]"
          >
            <option value="never">Never (Keep all log archives)</option>
            <option value="daily">Daily (Delete archives older than 1 day)</option>
            <option value="weekly">Weekly (Delete archives older than 7 days)</option>
            <option value="monthly">Monthly (Delete archives older than 30 days)</option>
            <option value="custom">Custom (Specify threshold in days)</option>
          </select>

          {settings.archiveRetention === 'custom' && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-[#8b949e] whitespace-nowrap">Keep archives for:</span>
              <input
                type="number"
                min="1"
                max="365"
                value={settings.archiveRetentionDays || 30}
                onChange={e => handleDays(e.target.value)}
                className="w-20 bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1 text-white text-xs focus:outline-none focus:border-[#58a6ff]"
              />
              <span className="text-xs text-[#8b949e]">days</span>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-[#30363d]/60 flex items-center justify-between">
          <span className="text-[11px] text-[#8b949e]">Hourly background prune: Active</span>
          <button
            type="button"
            onClick={triggerClean}
            disabled={cleaning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#21262d] border border-[#30363d] text-white hover:bg-[#30363d] hover:text-[#58a6ff] transition disabled:opacity-50"
          >
            {cleaning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#58a6ff]" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 text-[#58a6ff]" />
            )}
            Clean Archives Now
          </button>
        </div>
      </div>
    </div>
  );
}
