import React, { useState } from 'react';
import { Terminal, Trash2, Copy, Play, RefreshCw, Check } from 'lucide-react';

export default function TerminalTab({
  terminalOutput,
  setTerminalOutput,
  terminalCommand,
  setTerminalCommand,
  terminalHistory,
  historyIndex,
  setHistoryIndex,
  isTerminalRunning,
  terminalConsoleRef,
  executeTerminalCommand,
  handleCopyLogs,
  settings
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#161b22] border border-[#30363d] p-4 rounded-xl shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-[#3fb950]" />
            Container Shell Terminal
          </h2>
          {settings.showHeadlines && (
            <p className="text-xs text-[#8b949e] mt-1">Direct bash command execution inside the Docker container environment.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTerminalOutput([{ type: 'output', text: 'Terminal buffer cleared.' }])}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#21262d] hover:bg-[#da3633]/20 hover:text-[#f85149] text-[#8b949e] hover:border-[#da3633]/40 rounded-lg border border-[#30363d] text-xs font-medium transition"
            title="Clear Terminal Output"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#da3633]" /> Clear
          </button>
          <button
            onClick={() => {
              const res = handleCopyLogs(terminalOutput.map(o => o.text));
              if (res !== false) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${copied ? 'bg-[#238636] border-[#2ea043]' : 'bg-[#21262d] hover:bg-[#30363d] border-[#30363d]'} text-white text-xs font-medium rounded-lg border transition-all duration-200`}
            title="Copy Output"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5 text-[#58a6ff]" />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Quick Diagnostics Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#8b949e] font-medium mr-1">Quick Diagnostics:</span>
        {[
          { label: 'Disk Free', cmd: 'df -h' },
          { label: 'Memory Free', cmd: 'free -m' },
          { label: 'Process List', cmd: 'ps aux' },
          { label: 'OS Version', cmd: 'cat /etc/os-release' },
          { label: 'GitHub Ping', cmd: 'curl -I https://github.com' },
          { label: 'Runner Binaries', cmd: 'ls -la /actions-runner' }
        ].map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => executeTerminalCommand(item.cmd)}
            disabled={isTerminalRunning}
            className="bg-[#161b22] hover:bg-[#21262d] text-[#c9d1d9] hover:text-white border border-[#30363d] text-xs px-2.5 py-1 rounded-lg transition font-mono flex items-center gap-1.5 disabled:opacity-50"
          >
            <Play className="w-2.5 h-2.5 text-[#3fb950]" />
            {item.label}
          </button>
        ))}
      </div>

      {/* Interactive Terminal Window */}
      <div className="bg-[#011627] border border-[#30363d] rounded-xl flex flex-col h-[calc(100vh-290px)] shadow-2xl overflow-hidden font-mono text-xs">
        <div ref={terminalConsoleRef} className="flex-1 p-4 overflow-y-auto space-y-2.5 leading-relaxed text-[#d6deeb]">
          {terminalOutput.map((entry, idx) => (
            <div key={idx} className="space-y-1">
              {entry.type === 'input' && (
                <div className="flex items-center gap-2 text-[#3fb950] font-semibold">
                  <span className="text-[#58a6ff]">root@github-runner:/app#</span>
                  <span className="text-white">{entry.text}</span>
                  {entry.timestamp && <span className="text-[10px] text-[#8b949e] ml-auto font-normal">{entry.timestamp}</span>}
                </div>
              )}
              {entry.type === 'output' && (
                <div className="text-[#c9d1d9] whitespace-pre-wrap pl-2 border-l-2 border-[#30363d]">
                  {entry.text}
                </div>
              )}
              {entry.type === 'error' && (
                <div className="text-[#f85149] whitespace-pre-wrap pl-2 border-l-2 border-[#da3633]">
                  {entry.text}
                </div>
              )}
            </div>
          ))}
          {isTerminalRunning && (
            <div className="flex items-center gap-2 text-[#d29922] animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Executing command inside container...</span>
            </div>
          )}
        </div>

        {/* Command Input Prompt */}
        <form
          onSubmit={e => { e.preventDefault(); executeTerminalCommand(); }}
          className="bg-[#0d1117] border-t border-[#30363d] p-3 flex items-center gap-2"
        >
          <span className="text-[#58a6ff] font-bold text-xs select-none shrink-0 pl-1">
            root@github-runner:/app#
          </span>
          <input
            type="text"
            value={terminalCommand}
            onChange={e => setTerminalCommand(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (terminalHistory.length > 0) {
                  const nextIdx = historyIndex === -1 ? terminalHistory.length - 1 : Math.max(0, historyIndex - 1);
                  setHistoryIndex(nextIdx);
                  setTerminalCommand(terminalHistory[nextIdx]);
                }
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex !== -1) {
                  const nextIdx = historyIndex + 1;
                  if (nextIdx >= terminalHistory.length) {
                    setHistoryIndex(-1);
                    setTerminalCommand('');
                  } else {
                    setHistoryIndex(nextIdx);
                    setTerminalCommand(terminalHistory[nextIdx]);
                  }
                }
              }
            }}
            placeholder="Type bash command (e.g. ps aux, df -h, ls -la /opt/github-runner)..."
            disabled={isTerminalRunning}
            className="flex-1 bg-transparent border-none text-white text-xs font-mono focus:outline-none placeholder:text-[#8b949e]"
          />
          <button
            type="submit"
            disabled={isTerminalRunning || !terminalCommand.trim()}
            className="bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
          >
            Run <Play className="w-3 h-3" />
          </button>
        </form>
      </div>
    </div>
  );
}
