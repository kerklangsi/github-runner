import React from 'react';
import './themes/theme.css';

// Custom Hooks & Utilities
import { useAppServices } from './hooks/useAppServices';
import { formatUptime, handleCopyLogs, handleSaveLogFile, renderLogLines } from './utils/logUtils';

// Modular Layout & Auth Components
import Sidebar from './components/layout/Sidebar';
import TopHeader from './components/layout/TopHeader';
import ToastNotification from './components/layout/ToastNotification';
import LoginView from './components/auth/LoginView';

// Modals
import AddRunnerModal from './components/modals/AddRunnerModal';
import DeleteRunnerModal from './components/modals/DeleteRunnerModal';
import ConfirmModal from './components/modals/ConfirmModal';
import AboutModal from './components/modals/AboutModal';
import RunnerLogsModal from './components/modals/RunnerLogsModal';

// Tabs
import DashboardTab from './components/tabs/DashboardTab';
import AllRunnersTab from './components/tabs/AllRunnersTab';
import GlobalLogsTab from './components/tabs/GlobalLogsTab';
import WorkflowsTab from './components/tabs/WorkflowsTab';
import TerminalTab from './components/tabs/TerminalTab';
import FilesTab from './components/tabs/FilesTab';
import SystemHardwareTab from './components/tabs/SystemHardwareTab';
import SettingsTab from './components/tabs/SettingsTab';

// Main root application view and state coordinator
export default function App() {
  const s = useAppServices();

  const crashedCount = s.runners.filter(r => r.status === 'CRASHED').length;

  const copyLogs = (logs) => handleCopyLogs(logs, s.triggerToast);
  const saveLogFile = (filename, logs) => handleSaveLogFile(filename, logs, s.triggerToast);
  const renderLogs = (lines, hint, showSrc) => renderLogLines(lines, hint, showSrc, s.settings);

  if (!s.isAuthenticated) {
    return (
      <LoginView
        loginForm={s.loginForm}
        setLoginForm={s.setLoginForm}
        loginError={s.loginError}
        handleLogin={s.handleLogin}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-[#c9d1d9] font-sans antialiased overflow-hidden select-text">
      {/* Top Header Navbar */}
      <TopHeader
        avatarUrl={s.avatarUrl}
        currentUsername={s.currentUsername}
        setActiveTab={s.setActiveTab}
        handleLogout={s.handleLogout}
        versionInfo={s.versionInfo}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          activeTab={s.activeTab}
          setActiveTab={s.setActiveTab}
          isSidebarCollapsed={s.isSidebarCollapsed}
          setIsSidebarCollapsed={s.setIsSidebarCollapsed}
          totalRunners={s.runners.length}
          fetchGlobalLogs={s.fetchGlobalLogs}
          fetchWorkflows={s.fetchWorkflows}
          fetchSettings={s.fetchSettings}
          setStatusFilter={s.setStatusFilter}
          setIsAboutModalOpen={s.setIsAboutModalOpen}
          versionInfo={s.versionInfo}
        />

        {/* Main Content Workspace */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {s.activeTab === 'dashboard' && (
            <DashboardTab
              system={s.system}
              runners={s.runners}
              crashedCount={crashedCount}
              setStatusFilter={s.setStatusFilter}
              setActiveTab={s.setActiveTab}
              searchQuery={s.searchQuery}
              setSearchQuery={s.setSearchQuery}
              statusFilter={s.statusFilter}
              openAddModal={s.openAddModal}
              settings={s.settings}
              editModeRunners={s.editModeRunners}
              setEditModeRunners={s.setEditModeRunners}
              runnerEdits={s.runnerEdits}
              setRunnerEdits={s.setRunnerEdits}
              showRunnerTokens={s.showRunnerTokens}
              setShowRunnerTokens={s.setShowRunnerTokens}
              unlockedRunnerTokens={s.unlockedRunnerTokens}
              setUnlockedRunnerTokens={s.setUnlockedRunnerTokens}
              handleUpdateRunnerInlineConfig={s.handleUpdateRunnerInlineConfig}
              handleStart={s.handleStart}
              handleStop={s.handleStop}
              handleRestart={s.handleRestart}
              openLogs={s.openLogs}
              handleExportRunnerConfig={s.handleExportRunnerConfig}
              openDeleteConfirmModal={s.openDeleteConfirmModal}
              fetchRunners={s.fetchRunners}
              triggerToast={s.triggerToast}
              globalLogs={s.globalLogs}
              renderLogLines={renderLogs}
              handleCopyLogs={copyLogs}
              handleSaveLogFile={saveLogFile}
              formatUptime={formatUptime}
            />
          )}

          {s.activeTab === 'runners' && (
            <AllRunnersTab
              runners={s.runners}
              openAddModal={s.openAddModal}
              settings={s.settings}
              editModeRunners={s.editModeRunners}
              setEditModeRunners={s.setEditModeRunners}
              runnerEdits={s.runnerEdits}
              setRunnerEdits={s.setRunnerEdits}
              showRunnerTokens={s.showRunnerTokens}
              setShowRunnerTokens={s.setShowRunnerTokens}
              unlockedRunnerTokens={s.unlockedRunnerTokens}
              setUnlockedRunnerTokens={s.setUnlockedRunnerTokens}
              handleUpdateRunnerInlineConfig={s.handleUpdateRunnerInlineConfig}
              handleStart={s.handleStart}
              handleStop={s.handleStop}
              handleRestart={s.handleRestart}
              openLogs={s.openLogs}
              handleExportRunnerConfig={s.handleExportRunnerConfig}
              openDeleteConfirmModal={s.openDeleteConfirmModal}
              fetchRunners={s.fetchRunners}
              triggerToast={s.triggerToast}
            />
          )}

          {s.activeTab === 'global-logs' && (
            <GlobalLogsTab
              globalLogs={s.globalLogs}
              globalLogSearch={s.globalLogSearch}
              setGlobalLogSearch={s.setGlobalLogSearch}
              handleClearGlobalLogs={s.handleClearGlobalLogs}
              globalLogConsoleRef={s.globalLogConsoleRef}
              renderLogLines={renderLogs}
              handleCopyLogs={copyLogs}
              handleSaveLogFile={saveLogFile}
              settings={s.settings}
            />
          )}

          {s.activeTab === 'workflows' && (
            <WorkflowsTab
              workflowHistory={s.workflowHistory}
              workflowLoading={s.workflowLoading}
              fetchWorkflows={s.fetchWorkflows}
              settings={s.settings}
            />
          )}

          {s.activeTab === 'terminal' && (
            <TerminalTab
              terminalOutput={s.terminalOutput}
              setTerminalOutput={s.setTerminalOutput}
              terminalCommand={s.terminalCommand}
              setTerminalCommand={s.setTerminalCommand}
              terminalHistory={s.terminalHistory}
              historyIndex={s.historyIndex}
              setHistoryIndex={s.setHistoryIndex}
              isTerminalRunning={s.isTerminalRunning}
              terminalConsoleRef={s.terminalConsoleRef}
              executeTerminalCommand={s.executeTerminalCommand}
              handleCopyLogs={copyLogs}
              settings={s.settings}
            />
          )}

          {s.activeTab === 'files' && (
            <FilesTab
              triggerToast={s.triggerToast}
              settings={s.settings}
            />
          )}

          {s.activeTab === 'system' && (
            <SystemHardwareTab
              system={s.system}
              settings={s.settings}
              formatUptime={formatUptime}
            />
          )}

          {s.activeTab === 'settings' && (
            <SettingsTab
              avatarUrl={s.avatarUrl}
              currentUsername={s.currentUsername}
              usernameInput={s.usernameInput}
              setUsernameInput={s.setUsernameInput}
              handleUpdateUsername={s.handleUpdateUsername}
              pwdForm={s.pwdForm}
              setPwdForm={s.setPwdForm}
              handleChangePassword={s.handleChangePassword}
              settings={s.settings}
              setSettings={s.setSettings}
              autoSaveSettings={s.autoSaveSettings}
              handleLogLevelChange={s.handleLogLevelChange}
              currentTheme={s.currentTheme}
              setCurrentTheme={s.setCurrentTheme}
              triggerToast={s.triggerToast}
              handleAvatarFileUpload={s.handleAvatarFileUpload}
              avatarInputUrl={s.avatarInputUrl}
              setAvatarInputUrl={s.setAvatarInputUrl}
              handleSaveAvatarUrl={s.handleSaveAvatarUrl}
              handleBackup={s.handleBackup}
              handleRestore={s.handleRestore}
              handleWebhookTest={s.handleWebhookTest}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <AddRunnerModal
        isAddModalOpen={s.isAddModalOpen}
        setIsAddModalOpen={s.setIsAddModalOpen}
        addForm={s.addForm}
        setAddForm={s.setAddForm}
        showAddToken={s.showAddToken}
        setShowAddToken={s.setShowAddToken}
        handleConfigFileUpload={s.handleConfigFileUpload}
        handleAddRunner={s.handleAddRunner}
      />

      <DeleteRunnerModal
        deleteConfirmModal={s.deleteConfirmModal}
        setDeleteConfirmModal={s.setDeleteConfirmModal}
        handleDelete={s.handleDelete}
      />

      <ConfirmModal
        confirmModal={s.confirmModal}
        setConfirmModal={s.setConfirmModal}
      />

      <AboutModal
        isAboutModalOpen={s.isAboutModalOpen}
        setIsAboutModalOpen={s.setIsAboutModalOpen}
        system={s.system}
        versionInfo={s.versionInfo}
      />

      <RunnerLogsModal
        isLogModalOpen={s.isLogModalOpen}
        setIsLogModalOpen={s.setIsLogModalOpen}
        selectedRunner={s.selectedRunner}
        logSearch={s.logSearch}
        setLogSearch={s.setLogSearch}
        handleClearRunnerLogs={s.handleClearRunnerLogs}
        logConsoleRef={s.logConsoleRef}
        renderLogLines={renderLogs}
        runnerLogs={s.runnerLogs}
        handleCopyLogs={copyLogs}
        handleSaveLogFile={saveLogFile}
      />

      {/* Toast Notification */}
      <ToastNotification toast={s.toast} />
    </div>
  );
}
