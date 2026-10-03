import React from 'react';
import { 
  Server, RefreshCw, X, Settings, Save, Eye, EyeOff, Lock, Unlock, 
  Play, Square, FileText, Download, Trash2 
} from 'lucide-react';

export default function RunnerCard({
  runner,
  settings,
  editModeRunners,
  setEditModeRunners,
  runnerEdits,
  setRunnerEdits,
  showRunnerTokens,
  setShowRunnerTokens,
  unlockedRunnerTokens,
  setUnlockedRunnerTokens,
  handleUpdateRunnerInlineConfig,
  handleStart,
  handleStop,
  handleRestart,
  openLogs,
  handleExportRunnerConfig,
  openDeleteConfirmModal,
  fetchRunners,
  triggerToast
}) {
  const isEditing = !!editModeRunners[runner.id];
  const editData = runnerEdits[runner.id] || {
    githubUrl: runner.githubUrl || '',
    registrationToken: runner.registrationToken || '',
    labels: runner.labels || 'self-hosted, linux, x64',
    runnerGroup: runner.runnerGroup || 'Default'
  };

  const isRunning = runner.status === 'ONLINE' || runner.status === 'BUSY' || runner.status === 'IDLE';

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-3 shadow-sm">
      {/* Card Header: name + status + edit button */}
      <div className="flex justify-between items-start pb-1">
        <div>
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[#58a6ff]" />
            <h3 className="font-bold text-white text-base">{runner.name}</h3>
          </div>
          {settings.showHeadlines && (
            <p className="text-xs text-[#8b949e] mt-0.5 font-normal">Self-hosted GitHub Actions runner container</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
            runner.status === 'PROVISIONING' ? 'bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40 flex items-center gap-1.5 animate-pulse' :
            runner.status === 'BUSY' ? 'bg-[#d29922] text-black' :
            runner.status === 'ONLINE' ? 'bg-[#1f6feb] text-white' :
            runner.status === 'IDLE' ? 'bg-[#238636] text-white' :
            runner.status === 'OFFLINE' ? 'bg-[#da3633] text-white' : 'bg-[#30363d] text-[#8b949e]'
          }`}>
            {runner.status === 'PROVISIONING' && <RefreshCw className="w-3 h-3 animate-spin" />}
            {runner.status}
          </span>

          {/* Edit Config toggle */}
          <button
            type="button"
            onClick={() => {
              if (isEditing) {
                // Cancel: revert edits
                setRunnerEdits(prev => {
                  const n = { ...prev };
                  delete n[runner.id];
                  return n;
                });
                setEditModeRunners(prev => ({ ...prev, [runner.id]: false }));
              } else {
                // Enter edit mode: seed current values
                setRunnerEdits(prev => ({
                  ...prev,
                  [runner.id]: {
                    githubUrl: runner.githubUrl || '',
                    registrationToken: runner.registrationToken || '',
                    labels: runner.labels || 'self-hosted, linux, x64',
                    runnerGroup: runner.runnerGroup || 'Default'
                  }
                }));
                setEditModeRunners(prev => ({ ...prev, [runner.id]: true }));
              }
            }}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition ${
              isEditing
                ? 'bg-[#da3633]/20 text-[#f85149] border-[#da3633]/40 hover:bg-[#da3633]/30'
                : 'bg-[#21262d] text-[#8b949e] border-[#30363d] hover:text-white hover:bg-[#30363d]'
            }`}
            title={isEditing ? 'Cancel editing' : 'Edit runner configuration'}
          >
            {isEditing ? <><X className="w-3 h-3" /> Cancel</> : <><Settings className="w-3 h-3" /> Edit Config</>}
          </button>
        </div>
      </div>

      {/* Configuration Fields */}
      <div>
        <label className="block text-[#8b949e] font-medium mb-1 text-xs">Target Repository / Org URL</label>
        <input 
          type="text" 
          value={editData.githubUrl} 
          disabled={!isEditing}
          onChange={e => setRunnerEdits({ ...runnerEdits, [runner.id]: { ...editData, githubUrl: e.target.value } })}
          className={`w-full bg-[#0d1117] border rounded-lg px-2.5 py-1.5 text-white focus:outline-none text-xs ${isEditing ? 'border-[#58a6ff]' : 'border-[#30363d] opacity-60 cursor-not-allowed'}`}
        />
      </div>

      <div>
        <label className="block text-[#8b949e] font-medium mb-1 text-xs">GitHub PAT / Registration Token</label>
        <div className="relative">
          <input 
            type={showRunnerTokens[runner.id] ? 'text' : 'password'} 
            disabled={!isEditing || !unlockedRunnerTokens[runner.id]}
            placeholder={unlockedRunnerTokens[runner.id] && isEditing ? 'ghp_... or registration token' : '••••••••••••••••••••'}
            value={editData.registrationToken} 
            onChange={e => setRunnerEdits({ ...runnerEdits, [runner.id]: { ...editData, registrationToken: e.target.value } })}
            className={`w-full bg-[#0d1117] border rounded-lg pl-2.5 pr-16 py-1.5 text-white focus:outline-none text-xs font-mono ${
              isEditing && unlockedRunnerTokens[runner.id] ? 'border-[#58a6ff] focus:border-[#58a6ff]' : 'border-[#30363d] opacity-60 cursor-not-allowed'
            }`}
          />
          {/* Eye toggle */}
          <button 
            type="button"
            onClick={() => setShowRunnerTokens({ ...showRunnerTokens, [runner.id]: !showRunnerTokens[runner.id] })}
            className="absolute right-8 top-1/2 -translate-y-1/2 text-[#8b949e] hover:text-white"
            title={showRunnerTokens[runner.id] ? 'Hide Token' : 'Show Token'}
          >
            {showRunnerTokens[runner.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          {/* Lock / Unlock — only active in edit mode */}
          <button 
            type="button"
            disabled={!isEditing}
            onClick={() => isEditing && setUnlockedRunnerTokens({ ...unlockedRunnerTokens, [runner.id]: !unlockedRunnerTokens[runner.id] })}
            className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition ${
              !isEditing ? 'text-[#30363d] cursor-not-allowed' :
              unlockedRunnerTokens[runner.id] ? 'text-[#f85149] hover:text-[#ff6b6b]' : 'text-[#58a6ff] hover:text-white'
            }`}
            title={isEditing ? (unlockedRunnerTokens[runner.id] ? 'Lock Token' : 'Change Token') : 'Enter edit mode to change token'}
          >
            {unlockedRunnerTokens[runner.id] && isEditing ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[#8b949e] font-medium mb-1 text-xs">Runner Labels</label>
          <input 
            type="text" 
            value={editData.labels} 
            disabled={!isEditing}
            onChange={e => setRunnerEdits({ ...runnerEdits, [runner.id]: { ...editData, labels: e.target.value } })}
            className={`w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-2.5 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-[#58a6ff] ${!isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>

        <div>
          <label className="block text-[#8b949e] font-medium mb-1 text-xs">Runner Group</label>
          <input 
            type="text" 
            value={editData.runnerGroup} 
            disabled={!isEditing}
            onChange={e => setRunnerEdits({ ...runnerEdits, [runner.id]: { ...editData, runnerGroup: e.target.value } })}
            className={`w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-2.5 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-[#58a6ff] ${!isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>
      </div>

      {/* Apply button — only visible in edit mode */}
      {isEditing && (
        <div className="flex justify-end pt-0.5">
          <button 
            type="button"
            onClick={() => handleUpdateRunnerInlineConfig(runner.id, runner.name)} 
            className="flex items-center gap-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition shadow-sm"
          >
            <Save className="w-3.5 h-3.5" /> Apply Config
          </button>
        </div>
      )}

      {/* Watchdog toggle — matching Runner Labels & Runner Group header style */}
      <div>
        <label className="block text-[#8b949e] font-medium mb-1 text-xs">Runner Watchdog</label>
        <div className="flex items-center justify-between bg-[#0d1117] rounded-lg px-3 py-2 border border-[#30363d]">
          <div className="flex items-center gap-1.5 text-xs text-white font-medium">
            <RefreshCw className="w-3 h-3 text-[#3fb950]" />
            Auto-Restart Watchdog
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox"
              checked={!!runner.watchdog}
              onChange={e => {
                const enabled = e.target.checked;
                fetch(`/api/runners/${runner.id}/config`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ watchdog: enabled })
                }).then(() => {
                  fetchRunners();
                  triggerToast(`Watchdog ${enabled ? 'enabled' : 'disabled'} for '${runner.name}'`, 'info');
                });
              }}
              className="sr-only peer" />
            <div className="w-9 h-5 bg-[#30363d] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#238636]"></div>
          </label>
        </div>
      </div>

      {/* 2-Tier Action Controls */}
      <div className="space-y-2 pt-0.5">
        {/* Top Tier: Start, Stop, Restart */}
        <div className="grid grid-cols-3 gap-2">
          <button 
            onClick={() => !isRunning && handleStart(runner.id)} 
            disabled={isRunning}
            className={`${
              isRunning
                ? 'bg-[#238636]/20 text-white/40 border border-[#238636]/20 cursor-not-allowed'
                : 'bg-[#238636] hover:bg-[#2ea043] text-white shadow-sm cursor-pointer'
            } text-xs font-semibold py-2 px-2 rounded-lg text-center transition flex items-center justify-center gap-1`}
            title={isRunning ? 'Runner is currently running (Start disabled)' : 'Start runner'}
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Start
          </button>

          <button 
            onClick={() => isRunning && handleStop(runner.id)} 
            disabled={!isRunning}
            className={`${
              !isRunning
                ? 'bg-[#21262d] text-[#8b949e]/40 border border-[#30363d]/50 cursor-not-allowed'
                : 'bg-[#da3633]/20 hover:bg-[#da3633] text-[#f85149] hover:text-white border border-[#da3633]/40 cursor-pointer'
            } text-xs font-semibold py-2 px-2 rounded-lg text-center transition flex items-center justify-center gap-1`}
            title={isRunning ? 'Stop runner' : 'Runner is not running (Stop disabled)'}
          >
            <Square className="w-3.5 h-3.5 fill-current" /> Stop
          </button>

          <button 
            onClick={() => isRunning && handleRestart(runner.id)} 
            disabled={!isRunning}
            className={`${
              !isRunning
                ? 'bg-[#21262d] text-[#8b949e]/40 border border-[#30363d]/50 cursor-not-allowed'
                : 'bg-[#1f6feb]/20 hover:bg-[#1f6feb] text-[#58a6ff] hover:text-white border border-[#1f6feb]/40 cursor-pointer'
            } text-xs font-semibold py-2 px-2 rounded-lg text-center transition flex items-center justify-center gap-1`}
            title={isRunning ? 'Restart runner' : 'Runner is not running (Restart disabled)'}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Restart
          </button>
        </div>

        {/* Bottom Tier: Log View, Export, Delete */}
        <div className="grid grid-cols-3 gap-2">
          <button 
            onClick={() => openLogs(runner)} 
            className="bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white border border-[#30363d] text-xs font-medium py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1"
            title="View runner logs"
          >
            <FileText className="w-3.5 h-3.5 text-[#58a6ff]" /> Log View
          </button>

          <button 
            onClick={() => handleExportRunnerConfig(runner)} 
            className="bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white border border-[#30363d] text-xs font-medium py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1"
            title="Export runner config as JSON"
          >
            <Download className="w-3.5 h-3.5 text-[#3fb950]" /> Export
          </button>

          <button 
            onClick={() => openDeleteConfirmModal(runner)} 
            className="bg-[#21262d] hover:bg-[#da3633]/20 text-[#8b949e] hover:text-[#f85149] border border-[#30363d] hover:border-[#da3633]/40 text-xs font-medium py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1"
            title="Delete runner"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#da3633]" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
