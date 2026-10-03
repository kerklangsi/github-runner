import React, { useState } from 'react';
import { Trash2, Copy, Download, X, Check, Terminal, FileCode2 } from 'lucide-react';

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
  handleSaveLogFile,
  logSource = 'workflow',
  switchSource,
  handleLogSourceChange
}) {
  const [copied, setCopied] = useState(false);
  if (!isLogModalOpen || !selectedRunner) return null;

  const isWorkflow = logSource === 'workflow';
  const triggerSource = switchSource || handleLogSourceChange;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-4xl p-6 flex flex-col gap-4 shadow-2xl h-[80vh]">
        <div className="flex justify-between items-center border-b border-[#30363d] pb-3">
          <div>
            <h3 className="text-white font-semibold text-base flex items-center gap-2">
              Log View: {selectedRunner.name}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isWorkflow ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40' : 'bg-[#1f6feb]/20 text-[#58a6ff] border-[#1f6feb]/40'}`}>
                {isWorkflow ? 'job-logs.txt' : 'runner.log'}
              </span>
            </h3>
            <span className="text-xs text-[#8b949e]">{selectedRunner.dir}</span>
          </div>
          <button onClick={() => setIsLogModalOpen(false)} className="text-[#8b949e] hover:text-white p-1 rounded-lg hover:bg-[#21262d]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source Selector Tab Bar */}
        <div className="flex items-center justify-between gap-3 bg-[#0d1117] p-2 rounded-lg border border-[#30363d]">
          <div className="flex items-center gap-1.5 bg-[#161b22] p-1 rounded-lg border border-[#30363d]">
            <button
              onClick={() => triggerSource && triggerSource('workflow')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${isWorkflow ? 'bg-[#238636] text-white shadow-sm' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'}`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              Workflow Output (job-logs.txt)
            </button>
            <button
              onClick={() => triggerSource && triggerSource('daemon')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${!isWorkflow ? 'bg-[#1f6feb] text-white shadow-sm' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'}`}
            >
              <Terminal className="w-3.5 h-3.5" />
              Runner Daemon (runner.log)
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <input 
              type="text" 
              placeholder={`Search ${isWorkflow ? 'job-logs.txt' : 'daemon logs'}...`} 
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
              className="bg-[#161b22] text-xs text-white px-2.5 py-1.5 rounded-lg border border-[#30363d] focus:outline-none focus:border-[#58a6ff] w-full"
            />
            <button 
              onClick={() => handleClearRunnerLogs(selectedRunner.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-[#21262d] border-[#30363d] text-[#8b949e] hover:text-[#f85149] hover:border-[#da3633]/40 hover:bg-[#da3633]/20 transition shrink-0"
              title="Clear current log view"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#da3633]" />
              Clear
            </button>
          </div>
        </div>

        <div className="flex-1 relative flex flex-col min-h-0">
          <div ref={logConsoleRef} className="flex-1 bg-[#011627] border border-[#30363d] rounded-lg p-4 font-mono text-xs text-[#d6deeb] overflow-y-auto whitespace-pre-wrap pb-14">
            {runnerLogs.filter(line => !logSearch || line.toLowerCase().includes(logSearch.toLowerCase())).join('\n') || (
              isWorkflow 
                ? 'No workflow execution logs captured yet. Live step output (job-logs.txt) will stream here when a job runs on this runner.' 
                : 'No daemon listener entries recorded.'
            )}
          </div>

          <div className="absolute bottom-3 right-3 flex items-center gap-2 z-10">
            <button 
              onClick={() => {
                const text = runnerLogs.join('\n');
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
              <span>{copied ? 'Logs Copied!' : `Copy ${isWorkflow ? 'job-logs.txt' : 'Log'}`}</span>
            </button>

            <button 
              onClick={() => handleSaveLogFile(`${selectedRunner.name || 'runner'}_${isWorkflow ? 'job-logs' : 'daemon'}.txt`, runnerLogs.join('\r\n'))}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold rounded-lg shadow-md transition"
              title="Save Log to File (.txt)"
            >
              <Download className="w-3.5 h-3.5" /> Save {isWorkflow ? 'job-logs.txt' : 'Log'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
