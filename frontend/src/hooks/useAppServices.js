import { useState, useEffect } from 'react';
import { useAuthService } from './useAuthService';
import { useRunnersService } from './useRunnersService';
import { useSystemTelemetry } from './useSystemTelemetry';
import { useSettingsService } from './useSettingsService';
import { useTerminalService } from './useTerminalService';
import { useWorkflowsService } from './useWorkflowsService';
import { useLogsService } from './useLogsService';
import { useVersionService } from './useVersionService';

export function useAppServices() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [toast, setToast] = useState(null);
  function triggerToast(msg, type = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });
  function showConfirm(title, message, onConfirm) {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  }

  const auth = useAuthService(triggerToast);
  const version = useVersionService(auth.isAuthenticated);
  const system = useSystemTelemetry();
  const workflows = useWorkflowsService();
  const terminal = useTerminalService();

  const settings = useSettingsService(triggerToast, showConfirm);
  const runners = useRunnersService(triggerToast, showConfirm, settings.logLevelRef);
  const logs = useLogsService(showConfirm, triggerToast, settings.logLevelRef, settings.settings);

  // Global background polling loop
  useEffect(() => {
    if (auth.isAuthenticated) {
      runners.fetchRunners();
      system.fetchSystem();
      settings.fetchSettings();
      logs.fetchGlobalLogs();

      const interval = setInterval(() => {
        runners.fetchRunners();
        system.fetchSystem();
        if (activeTab === 'global-logs') logs.fetchGlobalLogs();
        if (runners.isLogModalOpenRef.current && runners.selectedRunnerRef.current) {
          const lvl = settings.logLevelRef.current || 'INFO';
          const src = runners.logSource || 'workflow';
          fetch(`/api/runners/${runners.selectedRunnerRef.current.id}/logs?limit=500&level=${lvl}&source=${src}`)
            .then(res => res.json())
            .then(data => {
              if (data.lines) runners.setRunnerLogs(data.lines);
            });
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [auth.isAuthenticated, activeTab]);

  return {
    ...auth,
    ...version,
    ...runners,
    ...system,
    ...settings,
    ...terminal,
    ...workflows,
    ...logs,
    activeTab, setActiveTab, searchQuery, setSearchQuery, statusFilter, setStatusFilter,
    isAboutModalOpen, setIsAboutModalOpen, isSidebarCollapsed, setIsSidebarCollapsed,
    toast, triggerToast, confirmModal, setConfirmModal,
    handleLogLevelChange: (lvl) => settings.handleLogLevelChange(lvl, logs.fetchGlobalLogs),
    handleRestore: (file) => settings.handleRestore(file, runners.fetchRunners)
  };
}
