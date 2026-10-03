import React from 'react';
import { Clock, RefreshCw, FileCode2 } from 'lucide-react';

export default function WorkflowsTab({
  workflowHistory,
  workflowLoading,
  fetchWorkflows,
  settings,
  runners = [],
  openLogs
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#161b22] border border-[#30363d] p-4 rounded-xl">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#a371f7]" /> Workflow History &amp; Duration Tracker
          </h2>
          {settings.showHeadlines && (
            <p className="text-xs text-[#8b949e] mt-1">Log-parsed workflow job history across all runners. Last 100 runs.</p>
          )}
        </div>
        <button
          onClick={fetchWorkflows}
          disabled={workflowLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg border border-[#30363d] text-xs font-semibold transition shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${workflowLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {workflowHistory.length === 0 ? (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-8 text-center space-y-2">
          <Clock className="w-8 h-8 text-[#8b949e] mx-auto opacity-50" />
          <p className="text-sm font-semibold text-white">No workflow runs recorded yet</p>
          <p className="text-xs text-[#8b949e]">Workflow jobs will appear here automatically when GitHub Actions jobs execute on registered runners.</p>
        </div>
      ) : (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#30363d] bg-[#0d1117]">
                <th className="text-left px-4 py-3 text-[#8b949e] font-semibold">Workflow / Job</th>
                <th className="text-left px-4 py-3 text-[#8b949e] font-semibold">Runner</th>
                <th className="text-left px-4 py-3 text-[#8b949e] font-semibold">Started</th>
                <th className="text-left px-4 py-3 text-[#8b949e] font-semibold">Duration</th>
                <th className="text-left px-4 py-3 text-[#8b949e] font-semibold">Status</th>
                <th className="text-right px-4 py-3 text-[#8b949e] font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {workflowHistory.map((job, idx) => (
                <tr key={idx} className="border-b border-[#30363d]/50 hover:bg-[#21262d]/40 transition">
                  <td className="px-4 py-3 font-mono text-white max-w-xs truncate" title={job.name}>{job.name || '—'}</td>
                  <td className="px-4 py-3 text-[#8b949e]">{job.runner || '—'}</td>
                  <td className="px-4 py-3 text-[#8b949e] font-mono whitespace-nowrap">{job.startTime || '—'}</td>
                  <td className="px-4 py-3 font-mono">
                    {job.duration != null ? (
                      <span className="text-[#58a6ff]">
                        {job.duration >= 60
                          ? `${Math.floor(job.duration / 60)}m ${job.duration % 60}s`
                          : `${job.duration}s`}
                      </span>
                    ) : (
                      <span className="text-[#8b949e]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      job.status === 'success' ? 'bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40' :
                      job.status === 'failed' ? 'bg-[#da3633]/20 text-[#f85149] border border-[#da3633]/40' :
                      'bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40'
                    }`}>
                      {job.status || 'running'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {openLogs && (
                      <button
                        onClick={() => {
                          const targetRunner = runners.find(r => r.name === job.runner || r.id === job.runnerId);
                          if (targetRunner) {
                            openLogs(targetRunner, 'workflow');
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#21262d] hover:bg-[#30363d] text-white rounded border border-[#30363d] text-[11px] font-medium transition"
                        title="View workflow job logs (job-logs.txt)"
                      >
                        <FileCode2 className="w-3 h-3 text-[#58a6ff]" />
                        <span>View Log</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
