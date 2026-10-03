import { useState, useRef, useEffect } from 'react';

export function useRunnersService(triggerToast, showConfirm, logLevelRef) {
  const [runners, setRunners] = useState([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  
  const [selectedRunner, setSelectedRunner] = useState(null);
  const [runnerLogs, setRunnerLogs] = useState([]);
  const [logSearch, setLogSearch] = useState('');
  const [logSource, setLogSource] = useState('workflow');

  // Token Visibility & Editing Locks
  const [showAddToken, setShowAddToken] = useState(false);
  const [showRunnerTokens, setShowRunnerTokens] = useState({});
  const [unlockedRunnerTokens, setUnlockedRunnerTokens] = useState({});

  // Add Runner Form
  const [addForm, setAddForm] = useState({
    name: '',
    githubUrl: '',
    registrationToken: '',
    labels: 'self-hosted, linux, x64',
    runnerGroup: 'Default'
  });

  const [runnerEdits, setRunnerEdits] = useState({});
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({
    isOpen: false,
    runnerId: null,
    runnerName: '',
    removeWorkDir: true
  });
  const [editModeRunners, setEditModeRunners] = useState({});

  const logConsoleRef = useRef(null);
  const selectedRunnerRef = useRef(null);
  const isLogModalOpenRef = useRef(false);

  useEffect(() => {
    selectedRunnerRef.current = selectedRunner;
    isLogModalOpenRef.current = isLogModalOpen;
  }, [selectedRunner, isLogModalOpen]);

  function fetchRunners() {
    fetch('/api/runners')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setRunners(data);
          const edits = {};
          data.forEach(r => {
            edits[r.id] = {
              githubUrl: r.githubUrl || '',
              registrationToken: r.registrationToken || '',
              labels: r.labels || 'self-hosted, linux, x64',
              runnerGroup: r.runnerGroup || 'Default'
            };
          });
          setRunnerEdits(prev => ({ ...edits, ...prev }));
        }
      });
  }

  function handleConfigFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      let parsed = {};
      if (file.name.endsWith('.json')) {
        parsed = JSON.parse(content);
      } else {
        const lines = content.split('\n');
        lines.forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split('=');
            if (parts.length >= 2) {
              const k = parts[0].trim().toUpperCase();
              const v = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
              if (k.includes('URL')) parsed.githubUrl = v;
              if (k.includes('TOKEN') || k.includes('PAT')) parsed.registrationToken = v;
              if (k.includes('NAME')) parsed.name = v;
              if (k.includes('LABEL')) parsed.labels = v;
              if (k.includes('GROUP')) parsed.runnerGroup = v;
            }
          }
        });
      }
      const importedToken = parsed.registrationToken || parsed.token || parsed.accessToken || prev.registrationToken;
      setAddForm(prev => ({
        name: parsed.name || parsed.runnerName || prev.name,
        githubUrl: parsed.githubUrl || parsed.url || parsed.targetUrl || prev.githubUrl,
        registrationToken: importedToken,
        labels: parsed.labels || parsed.runnerLabels || prev.labels,
        runnerGroup: parsed.runnerGroup || prev.runnerGroup
      }));

      if (importedToken && !importedToken.startsWith('ghp_') && !importedToken.startsWith('github_pat_')) {
        triggerToast(`Config loaded from ${file.name}. Note: Temporary tokens expire after 1 hr; use a PAT if needed.`, 'info');
      } else {
        triggerToast(`Config imported from ${file.name}!`, 'success');
      }
    };
    reader.readAsText(file);
  }

  function handleAddRunner(e) {
    e.preventDefault();
    if (!addForm.githubUrl || !addForm.registrationToken) {
      triggerToast('URL and PAT token are required', 'error');
      return;
    }
    fetch('/api/runners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm)
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          triggerToast(data.error, 'error');
        } else {
          setIsAddModalOpen(false);
          setAddForm({ name: '', githubUrl: '', registrationToken: '', labels: 'self-hosted, linux, x64', runnerGroup: 'Default' });
          fetchRunners();
          triggerToast(`Runner '${data.name || 'new'}' provisioned successfully!`, 'success');
        }
      });
  }

  function handleStart(runnerId) {
    fetch(`/api/runners/${runnerId}/start`, { method: 'POST' })
      .then(res => res.json())
      .then(() => { fetchRunners(); triggerToast('Starting runner instance...', 'info'); });
  }

  function handleStop(runnerId) {
    fetch(`/api/runners/${runnerId}/stop`, { method: 'POST' })
      .then(res => res.json())
      .then(() => { fetchRunners(); triggerToast('Runner stopped', 'info'); });
  }

  function handleRestart(runnerId) {
    fetch(`/api/runners/${runnerId}/restart`, { method: 'POST' })
      .then(res => res.json())
      .then(() => { fetchRunners(); triggerToast('Restarting runner container...', 'info'); });
  }

  function handleDelete(runnerId, removeWorkDir = true) {
    fetch(`/api/runners/${runnerId}?removeWorkDir=${removeWorkDir ? 'true' : 'false'}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => { fetchRunners(); triggerToast('Runner container deleted', 'success'); });
  }

  function handleUpdateRunnerInlineConfig(runnerId, runnerName) {
    const edit = runnerEdits[runnerId];
    if (!edit) return;
    fetch(`/api/runners/${runnerId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit)
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          triggerToast(data.error, 'error');
        } else {
          setEditModeRunners(prev => ({ ...prev, [runnerId]: false }));
          fetchRunners();
          triggerToast(`Configuration applied for '${runnerName}'!`, 'success');
        }
      });
  }

  function handleExportRunnerConfig(runner) {
    const configData = {
      name: runner.name,
      githubUrl: runner.githubUrl,
      registrationToken: runner.registrationToken || '',
      labels: runner.labels || 'self-hosted, linux, x64',
      runnerGroup: runner.runnerGroup || 'Default',
      watchdog: !!runner.watchdog
    };
    const jsonStr = JSON.stringify(configData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${runner.name || 'runner'}_config.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 2500);
    triggerToast(`Exported ${runner.name} config!`, 'success');
  }

  function handleClearRunnerLogs(runnerId) {
    if (!runnerId) return;
    showConfirm(
      'Clear Log View',
      'This will permanently delete the log file for this runner. This action cannot be undone.',
      () => {
        fetch(`/api/runners/${runnerId}/logs/clear`, { method: 'POST' })
          .then(res => res.json())
          .then(() => { setRunnerLogs([]); triggerToast('Runner logs cleared', 'success'); })
          .catch(() => setRunnerLogs([]));
      }
    );
  }

  function openLogs(runner, source = 'workflow') {
    setSelectedRunner(runner);
    setIsLogModalOpen(true);
    setLogSource(source);
    const lvl = logLevelRef.current || 'INFO';
    fetch(`/api/runners/${runner.id}/logs?limit=500&level=${lvl}&source=${source}`)
      .then(res => res.json())
      .then(data => {
        if (data.lines) setRunnerLogs(data.lines);
        if (data.source) setLogSource(data.source);
      });
  }

  // Switch log stream source between workflow and daemon
  function switchSource(source) {
    setLogSource(source);
    if (!selectedRunner) return;
    const lvl = logLevelRef.current || 'INFO';
    fetch(`/api/runners/${selectedRunner.id}/logs?limit=500&level=${lvl}&source=${source}`)
      .then(res => res.json())
      .then(data => {
        if (data.lines) setRunnerLogs(data.lines);
      });
  }

  function openAddModal() {
    setIsAddModalOpen(true);
  }

  function openDeleteConfirmModal(runner) {
    setDeleteConfirmModal({
      isOpen: true,
      runnerId: runner.id,
      runnerName: runner.name || runner.id,
      removeWorkDir: true
    });
  }

  return {
    runners, setRunners, fetchRunners, isAddModalOpen, setIsAddModalOpen, isLogModalOpen, setIsLogModalOpen,
    selectedRunner, setSelectedRunner, runnerLogs, setRunnerLogs, logSearch, setLogSearch, showAddToken, setShowAddToken,
    showRunnerTokens, setShowRunnerTokens, unlockedRunnerTokens, setUnlockedRunnerTokens, addForm, setAddForm,
    runnerEdits, setRunnerEdits, deleteConfirmModal, setDeleteConfirmModal, editModeRunners, setEditModeRunners,
    logConsoleRef, selectedRunnerRef, isLogModalOpenRef, logSource, setLogSource, switchSource, handleLogSourceChange: switchSource,
    handleConfigFileUpload, handleAddRunner, handleStart, handleStop, handleRestart, handleDelete,
    handleUpdateRunnerInlineConfig, handleExportRunnerConfig, handleClearRunnerLogs, openLogs, openAddModal, openDeleteConfirmModal
  };
}
