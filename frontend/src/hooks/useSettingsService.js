import { useState, useRef } from 'react';

export function useSettingsService(triggerToast, showConfirm, fetchRunners) {
  const logLevelRef = useRef('INFO');

  const [settings, setSettings] = useState({
    logLevel: 'INFO',
    showHeadlines: false,
    showTimestamps: true,
    autoScrollLogs: true,
    timezone: 'Browser Default',
    watchdogEnabled: false,
    watchdogIntervalSec: 30,
    webhookEnabled: false,
    webhookUrl: '',
    webhookEvents: ['runner_crashed', 'runner_offline'],
    archiveRetention: 'never',
    archiveRetentionDays: 30
  });

  const [pwdForm, setPwdForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  function fetchSettings() {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          if (data.logLevel) logLevelRef.current = data.logLevel;
          setSettings(prev => ({ ...prev, ...data }));
        }
      });
  }

  function autoSaveSettings(newSettings, toastMsg) {
    setSettings(newSettings);
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    })
      .then(res => res.json())
      .then(() => {
        if (toastMsg) triggerToast(toastMsg, 'success');
      });
  }

  function handleChangePassword(e) {
    e.preventDefault();
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      triggerToast('New passwords do not match', 'error');
      return;
    }
    fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pwdForm)
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          triggerToast(data.error, 'error');
        } else {
          setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
          triggerToast('Password changed successfully!', 'success');
        }
      });
  }

  function handleLogLevelChange(newLevel, fetchGlobalLogs) {
    logLevelRef.current = newLevel;
    autoSaveSettings({ ...settings, logLevel: newLevel }, `Log level updated to ${newLevel}`);
    if (fetchGlobalLogs) fetchGlobalLogs(newLevel);
  }

  function handleWebhookTest(testUrl) {
    if (!testUrl || !testUrl.trim()) {
      triggerToast('Please enter a Webhook URL first', 'error');
      return;
    }
    fetch('/api/settings/webhook-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: testUrl })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          triggerToast('Test alert sent to webhook successfully!', 'success');
        } else {
          triggerToast(data.error || 'Webhook test failed', 'error');
        }
      })
      .catch(() => triggerToast('Failed to reach webhook URL', 'error'));
  }

  function handleBackup() {
    fetch('/api/settings/backup')
      .then(res => res.json())
      .then(data => {
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const ts = new Date().toISOString().slice(0,10);
        link.href = url;
        link.download = `github_runner_backup_${ts}.json`;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          if (link.parentNode) link.parentNode.removeChild(link);
        }, 2500);
        triggerToast('System configuration backed up!', 'success');
      });
  }

  function handleRestore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        showConfirm(
          'Restore Configuration Backup',
          `Restoring this backup will replace current settings and provision ${parsed.runners?.length || 0} runner slots. Continue?`,
          () => {
            fetch('/api/settings/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(parsed)
            })
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  if (fetchRunners) fetchRunners();
                  fetchSettings();
                  triggerToast('Backup restored successfully!', 'success');
                } else {
                  triggerToast(data.error || 'Restore failed', 'error');
                }
              });
          }
        );
      } catch (err) {
        triggerToast('Invalid backup JSON file', 'error');
      }
    };
    reader.readAsText(file);
  }

  return {
    settings, setSettings, pwdForm, setPwdForm, logLevelRef, fetchSettings, autoSaveSettings,
    handleChangePassword, handleLogLevelChange, handleWebhookTest, handleBackup, handleRestore
  };
}
