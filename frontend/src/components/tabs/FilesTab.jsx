import React, { useState, useEffect } from 'react';
import { 
  Folder, File, FileText, Download, Eye, ArrowUp, RefreshCw, 
  Search, X, Copy, HardDrive, Check 
} from 'lucide-react';

// Formats byte counts into human-readable strings
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Formats ISO timestamps into human-readable local time
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

// Renders the Files & Storage management tab and file preview modal
export default function FilesTab({ triggerToast, settings }) {
  const [currentDir, setCurrentDir] = useState('/opt/shared_data');
  const [items, setItems] = useState([]);
  const [roots, setRoots] = useState(['/opt/shared_data', '/opt/github-runner', '/app/data']);
  const [loading, setLoading] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Loads files and folders for the given target directory
  const loadDirectory = async (dir) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (res.ok) {
        setCurrentDir(data.currentDir);
        setItems(data.items || []);
        if (data.roots && data.roots.length > 0) setRoots(data.roots);
      } else {
        triggerToast(data.error || 'Failed to list directory', 'error');
      }
    } catch (err) {
      triggerToast('Error loading directory: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory(currentDir);
  }, []);

  // Navigates one level up in the directory tree
  const handleGoUp = () => {
    const parent = currentDir.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parent);
  };

  // Opens and fetches content for in-browser file preview
  const handlePreview = async (item) => {
    setPreviewLoading(true);
    setCopied(false);
    try {
      const res = await fetch(`/api/files/content?file=${encodeURIComponent(item.path)}`);
      const data = await res.json();
      if (res.ok) {
        setPreviewFile(data);
      } else {
        triggerToast(data.error || 'Cannot preview file', 'error');
      }
    } catch (err) {
      triggerToast('Preview error: ' + err.message, 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Copies the previewed file text to clipboard
  const handleCopyPreview = () => {
    if (!previewFile?.content) return;
    navigator.clipboard?.writeText(previewFile.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      triggerToast('File content copied to clipboard!', 'success');
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = previewFile.content;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      triggerToast('File content copied to clipboard!', 'success');
    });
  };

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const breadcrumbs = currentDir.split('/').filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Tab Header & Storage Roots */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#30363d] pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Folder className="w-5 h-5 text-[#58a6ff]" /> Files &amp; Storage Explorer
            </h2>
            <p className="text-xs text-[#8b949e] mt-1">
              Browse shared runner repositories, credentials, workspaces, and persistent storage volumes.
            </p>
          </div>
          
          {/* Quick Root Selectors */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#8b949e] font-semibold flex items-center gap-1">
              <HardDrive className="w-3.5 h-3.5" /> Volumes:
            </span>
            {roots.map(root => (
              <button
                key={root}
                onClick={() => loadDirectory(root)}
                className={`px-2.5 py-1 text-xs rounded-lg border font-mono transition ${
                  currentDir.startsWith(root)
                    ? 'bg-[#21262d] border-[#58a6ff] text-white'
                    : 'bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-white'
                }`}
              >
                {root.replace('/opt/', '').replace('/app/', '')}
              </button>
            ))}
          </div>
        </div>

        {/* Directory Breadcrumbs & Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 overflow-x-auto text-xs font-mono">
            <button
              onClick={() => loadDirectory('/')}
              className="text-[#58a6ff] hover:underline shrink-0"
            >
              /
            </button>
            {breadcrumbs.map((segment, idx) => {
              const segPath = '/' + breadcrumbs.slice(0, idx + 1).join('/');
              return (
                <React.Fragment key={segPath}>
                  <span className="text-[#8b949e]">/</span>
                  <button
                    onClick={() => loadDirectory(segPath)}
                    className={`hover:underline shrink-0 ${
                      idx === breadcrumbs.length - 1 ? 'text-white font-bold' : 'text-[#58a6ff]'
                    }`}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleGoUp}
              disabled={currentDir === '/' || loading}
              className="p-2 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] rounded-lg transition disabled:opacity-50"
              title="Go to Parent Folder"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => loadDirectory(currentDir)}
              disabled={loading}
              className="p-2 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] rounded-lg transition disabled:opacity-50"
              title="Refresh Directory"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#58a6ff]' : ''}`} />
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8b949e] absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Filter files..."
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
                className="w-44 bg-[#0d1117] border border-[#30363d] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#58a6ff]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Directory Contents Table */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-[#8b949e] space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#58a6ff]" />
            <p className="text-xs">Loading directory entries...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-[#8b949e] space-y-2">
            <Folder className="w-8 h-8 mx-auto text-[#30363d]" />
            <p className="text-xs font-medium">Directory is empty or no files matched your filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#c9d1d9]">
              <thead className="bg-[#21262d] text-[#8b949e] uppercase font-semibold border-b border-[#30363d]">
                <tr>
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-4 w-32">Size</th>
                  <th className="py-2.5 px-4 w-48">Last Modified</th>
                  <th className="py-2.5 px-4 w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {filteredItems.map(item => (
                  <tr 
                    key={item.path} 
                    className="hover:bg-[#21262d]/50 transition group cursor-pointer"
                    onClick={() => {
                      if (item.isDirectory) loadDirectory(item.path);
                      else handlePreview(item);
                    }}
                  >
                    <td className="py-2.5 px-4 font-medium flex items-center gap-2.5">
                      {item.isDirectory ? (
                        <Folder className="w-4 h-4 text-[#58a6ff] shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-[#8b949e] shrink-0" />
                      )}
                      <span className={`truncate font-mono ${item.isDirectory ? 'text-white font-bold hover:underline' : 'text-[#c9d1d9]'}`}>
                        {item.name}
                      </span>
                      {item.isSymbolicLink && (
                        <span className="text-[10px] text-[#a371f7] bg-[#a371f7]/10 px-1.5 py-0.5 rounded border border-[#a371f7]/30">
                          symlink
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-[#8b949e] font-mono">
                      {item.isDirectory ? '-' : formatBytes(item.size)}
                    </td>
                    <td className="py-2.5 px-4 text-[#8b949e]">
                      {formatDate(item.mtime)}
                    </td>
                    <td className="py-2.5 px-4 text-right" onClick={e => e.stopPropagation()}>
                      {!item.isDirectory && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handlePreview(item)}
                            className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#30363d] rounded transition"
                            title="Preview File"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={`/api/files/download?file=${encodeURIComponent(item.path)}`}
                            download={item.name}
                            className="p-1.5 text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#30363d] rounded transition"
                            title="Download File"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* In-Browser File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30363d] bg-[#0d1117]">
              <div className="flex items-center gap-2.5 min-w-0">
                <File className="w-4 h-4 text-[#58a6ff] shrink-0" />
                <span className="text-sm font-bold text-white font-mono truncate">{previewFile.name}</span>
                <span className="text-xs text-[#8b949e] font-mono shrink-0">({formatBytes(previewFile.size)})</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleCopyPreview}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d] rounded-lg transition"
                  title="Copy File Content"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#3fb950]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <a
                  href={`/api/files/download?file=${encodeURIComponent(previewFile.path)}`}
                  download={previewFile.name}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d] rounded-lg transition"
                >
                  <Download className="w-3.5 h-3.5 text-[#58a6ff]" />
                  <span>Download</span>
                </a>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#30363d] rounded-lg transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-4 bg-[#0d1117]">
              <pre className="text-xs font-mono text-[#c9d1d9] whitespace-pre-wrap break-all leading-relaxed select-text">
                {previewFile.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
