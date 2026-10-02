import React, { useState } from 'react';
import { FileText, Trash2, Copy, Download, Check } from 'lucide-react';

export default function GlobalLogsTab({
  globalLogs,
  globalLogSearch,
  setGlobalLogSearch,
  handleClearGlobalLogs,
  globalLogConsoleRef,
  renderLogLines,
  handleCopyLogs,
  handleSaveLogFile,
  settings
}) {
  const [copied, setCopied] = useState(false);
  const filteredLogs = globalLogs.filter(line => !globalLogSearch || line.toLowerCase().includes(globalLogSearch.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#161b22] border border-[#30363d] p-4 rounded-xl">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#58a6ff]" />
            Global Logs Stream
          </h2>
          {settings.showHeadlines && (
            <p className="text-xs text-[#8b949e] mt-1">Unified live logs across all runners: <code className="text-[#58a6ff]">[runner-1] [timestamp INFO] message</code></p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input 
            type="text"
            placeholder="Search global logs..."
            value={globalLogSearch}
            onChange={e => setGlobalLogSearch(e.target.value)}
            className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#58a6ff]"
          />
          {/* Clear Logs Button */}
          <button
            onClick={handleClearGlobalLogs}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#21262d] hover:bg-[#da3633]/20 hover:text-[#f85149] text-[#8b949e] hover:border-[#da3633]/40 rounded-lg border border-[#30363d] text-xs font-medium transition"
            title="Clear Global Logs Buffer"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#da3633]" />
            Clear Logs
          </button>
        </div>
      </div>

      <div className="relative">
        <div ref={globalLogConsoleRef} className="bg-[#011627] border border-[#30363d] rounded-xl p-5 font-mono text-xs text-[#d6deeb] h-[calc(100vh-270px)] overflow-y-auto whitespace-pre-wrap leading-relaxed pb-16">
          {renderLogLines(filteredLogs, 'global').join('\n') || 'No global runner logs recorded.'}
        </div>

        {/* Save & Copy Buttons Positioned at Bottom Right */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2 z-10">
          <button 
            onClick={() => {
              const text = renderLogLines(filteredLogs.length > 0 ? filteredLogs : globalLogs, 'global');
              const res = handleCopyLogs(text);
              if (res !== false) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${copied ? 'bg-[#238636] border-[#2ea043]' : 'bg-[#21262d] hover:bg-[#30363d] border-[#30363d]'} text-white text-xs font-semibold rounded-lg border shadow-lg transition-all duration-200`}
            title="Copy Full Log"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5 text-[#58a6ff]" />}
            <span>{copied ? 'Logs Copied!' : 'Copy Log'}</span>
          </button>

          <button 
            onClick={() => {
              const ts = new Date().toISOString().slice(0,16).replace('T','_').replace(':','-');
              handleSaveLogFile(`global_logs_${ts}.txt`, renderLogLines(globalLogs, 'global'));
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold rounded-lg shadow-lg transition"
            title="Save Log to File (.txt)"
          >
            <Download className="w-3.5 h-3.5" /> Save Log
          </button>
        </div>
      </div>
    </div>
  );
}
