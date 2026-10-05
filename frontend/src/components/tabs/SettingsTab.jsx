import React from 'react';
import AdminAccountCard from '../settings/AdminAccountCard';
import PasswordSecurityCard from '../settings/PasswordSecurityCard';
import DisplaySettingsCard from '../settings/DisplaySettingsCard';
import BackupRestoreCard from '../settings/BackupRestoreCard';
import AvatarCard from '../settings/AvatarCard';
import LogLevelCard from '../settings/LogLevelCard';
import AppearanceCard from '../settings/AppearanceCard';
import AutomationAlertsCard from '../settings/AutomationAlertsCard';

export default function SettingsTab({
  avatarUrl,
  currentUsername,
  usernameInput,
  setUsernameInput,
  handleUpdateUsername,
  pwdForm,
  setPwdForm,
  handleChangePassword,
  settings,
  setSettings,
  autoSaveSettings,
  handleLogLevelChange,
  currentTheme,
  setCurrentTheme,
  triggerToast,
  handleAvatarFileUpload,
  avatarInputUrl,
  setAvatarInputUrl,
  handleSaveAvatarUrl,
  handleBackup,
  handleRestore,
  handleWebhookTest
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* LEFT COLUMN STACK */}
      <div className="space-y-6">
        <AdminAccountCard
          avatarUrl={avatarUrl}
          currentUsername={currentUsername}
          usernameInput={usernameInput}
          setUsernameInput={setUsernameInput}
          handleUpdateUsername={handleUpdateUsername}
          settings={settings}
        />
        <PasswordSecurityCard
          pwdForm={pwdForm}
          setPwdForm={setPwdForm}
          handleChangePassword={handleChangePassword}
          settings={settings}
        />
        <DisplaySettingsCard
          settings={settings}
          autoSaveSettings={autoSaveSettings}
        />
        <BackupRestoreCard
          handleBackup={handleBackup}
          handleRestore={handleRestore}
          settings={settings}
        />
      </div>

      {/* RIGHT COLUMN STACK */}
      <div className="space-y-6">
        <AvatarCard
          handleAvatarFileUpload={handleAvatarFileUpload}
          avatarInputUrl={avatarInputUrl}
          setAvatarInputUrl={setAvatarInputUrl}
          handleSaveAvatarUrl={handleSaveAvatarUrl}
          settings={settings}
        />
        <LogLevelCard
          settings={settings}
          handleLogLevelChange={handleLogLevelChange}
          autoSaveSettings={autoSaveSettings}
          triggerToast={triggerToast}
        />
        <AppearanceCard
          settings={settings}
          currentTheme={currentTheme}
          setCurrentTheme={setCurrentTheme}
          triggerToast={triggerToast}
          autoSaveSettings={autoSaveSettings}
        />
        <AutomationAlertsCard
          settings={settings}
          setSettings={setSettings}
          autoSaveSettings={autoSaveSettings}
          handleWebhookTest={handleWebhookTest}
        />
      </div>
    </div>
  );
}
