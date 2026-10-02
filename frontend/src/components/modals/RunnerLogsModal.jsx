import React, { useState } from 'react';
import { Trash2, Copy, Download, X, Check } from 'lucide-react';

export default function RunnerLogsModal({
  isLogModalOpen,
  setIsLogModalOpen,
  selectedRunner,
  logSearch,
  setLogSearch,
  handleClearRunnerLogs,
  logConsoleRef,
  renderLogLines,
  runnerLogs,
  handleCopyLogs,
  handleSaveLogFile
}) {
  const [copied, setCopied] = useState(false);
  if (!isLogModalOpen || !selectedRunner) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-4xl p-6 flex flex-col gap-4 shadow-2xl h-[80vh]">
        <div className="flex justify-between items-center border-b border-[#30363d] pb-3">
          <div>
            <h3 className="text-white font-semibold text-base">Log View: {selectedRunner.name}</h3>
            <span className="text-xs text-[#8b949e]">{selectedRunner.dir}</span>
          </div>
          <button onClick={() => setIsLogModalOpen(false)} className="text-[#8b949e] hover:text-white p-1 rounded-lg hover:bg-[#21262d]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 bg-[#0d1117] p-2.5 rounded-lg border border-[#30363d]">
          <input 
            type="text" 
            placeholder="Search log output..." 
            value={logSearch}
            onChange={e => setLogSearch(e.target.value)}
            className="bg-transparent text-xs text-white px-2 py-1 focus:outline-none flex-1"
          />

          <button 
            onClick={() => handleClearRunnerLogs(selectedRunner.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-[#f85149] hover:border-[#da3633]/40 hover:bg-[#da3633]/20 transition"
            title="Clear current log view"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#da3633]" />
            Clear
          </button>
        </div>

        <div className="flex-1 relative flex flex-col min-h-0">
          <div ref={logConsoleRef} className="flex-1 bg-[#011627] border border-[#30363d] rounded-lg p-4 font-mono text-xs text-[#d6deeb] overflow-y-auto whitespace-pre-wrap pb-14">
            {renderLogLines(
              runnerLogs.filter(line => !logSearch || line.toLowerCase().includes(logSearch.toLowerCase())),
              selectedRunner?.name || 'runner',
              false
            ).join('\n') || 'No log entries recorded.'}
          </div>

          <div className="absolute bottom-3 right-3 flex items-center gap-2 z-10">
            <button 
              onClick={() => {
                const text = renderLogLines(runnerLogs, selectedRunner?.name || 'runner', false);
                const res = handleCopyLogs(text);
                if (res !== false) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 ${copied ? 'bg-[#238636] border-[#2ea043]' : 'bg-[#21262d] hover:bg-[#30363d] border-[#30363d]'} text-white text-xs font-semibold rounded-lg border shadow-md transition-all duration-200`}
              title="Copy Full Log"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5 text-[#58a6ff]" />}
              <span>{copied ? 'Logs Copied!' : 'Copy Log'}</span>
            </button>

            <button 
              onClick={() => handleSaveLogFile(`${selectedRunner.name || 'runner'}_logs.txt`, renderLogLines(runnerLogs, selectedRunner?.name || 'runner', false))}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold rounded-lg shadow-md transition"
              title="Save Log to File (.txt)"
            >
              <Download className="w-3.5 h-3.5" /> Save Log
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
