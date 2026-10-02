import React from 'react';
import { Github, User, LogOut, ArrowUpCircle } from 'lucide-react';

export default function TopHeader({
  avatarUrl,
  currentUsername,
  setActiveTab,
  handleLogout,
  versionInfo
}) {
  return (
    <header className="h-14 bg-[#161b22] border-b border-[#30363d] px-6 flex items-center justify-between z-20 shrink-0">
      <div className="flex items-center gap-3">
        <a 
          href="https://github.com/kerklangsi/github-runner" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-white hover:text-[#58a6ff] transition"
        >
          <Github className="w-6 h-6" />
          <h1 className="font-bold text-base tracking-tight">GitHub Runner Manager</h1>
        </a>
      </div>

      <div className="flex items-center gap-3">
        {versionInfo?.updateAvailable && (
          <a
            href={versionInfo.githubUrl || 'https://github.com/kerklangsi/github-runner/releases'}
            target="_blank"
            rel="noopener noreferrer"
            className="animate-pulse flex items-center gap-1.5 bg-[#1f6feb]/20 hover:bg-[#1f6feb]/30 text-[#58a6ff] text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#1f6feb]/50 transition"
            title={`Current: ${versionInfo.currentVersion} → New Release: ${versionInfo.latestVersion}`}
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            <span>Update {versionInfo.latestVersion} Available</span>
          </a>
        )}

        <button 
          onClick={() => setActiveTab('settings')}
          className="flex items-center gap-2 bg-[#21262d] hover:bg-[#30363d] text-white text-xs font-medium px-3 py-1.5 rounded-lg border border-[#30363d] transition"
        >
          {avatarUrl ? (
            <img 
              src={avatarUrl} 
              onError={(e) => { e.target.style.display = 'none'; }} 
              className="w-4 h-4 rounded-full object-cover border border-[#58a6ff]" 
              alt="Avatar"
            />
          ) : (
            <User className="w-3.5 h-3.5 text-[#58a6ff]" />
          )}
          {currentUsername}
        </button>

        <button 
          onClick={handleLogout}
          className="p-2 text-[#8b949e] hover:text-white transition rounded-lg hover:bg-[#21262d]" 
          title="Logout / Exit"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
