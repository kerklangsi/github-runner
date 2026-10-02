import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export default function DeleteRunnerModal({
  deleteConfirmModal,
  setDeleteConfirmModal,
  handleDelete
}) {
  if (!deleteConfirmModal.isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#161b22] border border-[#da3633]/40 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#da3633]/20 border border-[#da3633]/40 rounded-xl text-[#f85149]">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Delete Runner Container?</h3>
              <p className="text-xs text-[#8b949e]">Instance: <strong className="text-white font-mono">{deleteConfirmModal.runnerName}</strong></p>
            </div>
          </div>
          <button 
            onClick={() => setDeleteConfirmModal({ ...deleteConfirmModal, isOpen: false })}
            className="text-[#8b949e] hover:text-white p-1 rounded-lg hover:bg-[#21262d] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-[#c9d1d9] space-y-2 leading-relaxed bg-[#0d1117] p-3.5 rounded-xl border border-[#30363d]">
          <p>This stops the runner process and deletes local instance files.</p>
          <p className="text-[#8b949e]">
            <strong className="text-[#58a6ff]">GitHub.com Unregistration:</strong> If a PAT is configured in Settings, the runner is automatically deleted from GitHub. If you registered with an ephemeral token (BNX...), you can also remove the offline runner on GitHub anytime: <strong className="text-white">Settings → Actions → Runners → "..." → Remove runner</strong>.
          </p>
        </div>

        {/* Checkbox: Remove work directory */}
        <label className="flex items-center gap-2 text-xs text-[#c9d1d9] bg-[#0d1117] border border-[#30363d] p-3 rounded-xl cursor-pointer select-none">
          <input 
            type="checkbox" 
            checked={!!deleteConfirmModal.removeWorkDir}
            onChange={e => setDeleteConfirmModal({ ...deleteConfirmModal, removeWorkDir: e.target.checked })}
            className="accent-[#da3633] rounded"
          />
          <span>Also delete local runner workspace files (<code>_work/</code>)</span>
        </label>

        <div className="pt-2 flex justify-end gap-2">
          <button 
            onClick={() => setDeleteConfirmModal({ ...deleteConfirmModal, isOpen: false })}
            className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-white rounded-lg transition text-xs font-medium"
          >
            Cancel
          </button>
          <button 
            onClick={() => {
              const { runnerId, removeWorkDir } = deleteConfirmModal;
              setDeleteConfirmModal({ ...deleteConfirmModal, isOpen: false });
              handleDelete(runnerId, removeWorkDir);
            }}
            className="px-4 py-2 bg-[#da3633] hover:bg-[#b82a28] text-white rounded-lg transition text-xs font-semibold flex items-center gap-1.5 shadow-sm"
          >
            <Trash2 className="w-3.5 h-3.5" /> Confirm Delete
          </button>
        </div>
      </div>
    </div>
  );
}
