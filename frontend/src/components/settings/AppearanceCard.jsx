import React, { useMemo } from 'react';
import { Palette, Clock } from 'lucide-react';

// Builds a list of timezones sorted by UTC offset.
function getTimezones() {
  let rawList = [];
  try {
    rawList = Intl.supportedValuesOf('timeZone');
  } catch (e) {
    rawList = [
      'UTC', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Tokyo',
      'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Bangkok', 'Asia/Jakarta',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
      'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney'
    ];
  }

  const now = new Date();
  const parsed = [];
  const seen = new Set();

  for (const tz of rawList) {
    if (seen.has(tz)) continue;
    seen.add(tz);
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now);
      const offsetName = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
      const match = offsetName.match(/GMT([+-])(\d+)(?::(\d+))?/);
      let offsetMins = 0;
      if (match) {
        const sign = match[1] === '-' ? -1 : 1;
        const hrs = parseInt(match[2], 10);
        const mins = match[3] ? parseInt(match[3], 10) : 0;
        offsetMins = sign * (hrs * 60 + mins);
      }
      const signStr = offsetMins >= 0 ? '+' : '-';
      const absMins = Math.abs(offsetMins);
      const hStr = String(Math.floor(absMins / 60)).padStart(2, '0');
      const mStr = String(absMins % 60).padStart(2, '0');
      const utcCode = `(UTC${signStr}${hStr}:${mStr})`;
      parsed.push({ tz, label: `${utcCode} ${tz}`, offsetMins });
    } catch (e) {}
  }

  parsed.sort((a, b) => a.offsetMins - b.offsetMins || a.tz.localeCompare(b.tz));
  return parsed;
}

export default function AppearanceCard({
  settings,
  currentTheme,
  setCurrentTheme,
  triggerToast,
  autoSaveSettings
}) {
  const timezones = useMemo(() => getTimezones(), []);
  const localTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Browser Default';
    } catch (e) {
      return 'Browser Default';
    }
  }, []);

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-4">
      <div className="border-b border-[#30363d] pb-3">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Palette className="w-4 h-4 text-[#a371f7]" /> Appearance &amp; Timezone
        </h2>
        {settings.showHeadlines && (
          <p className="text-xs text-[#8b949e] mt-1">Select theme color scheme and set local timezone for logs.</p>
        )}
      </div>

      {/* ── Theme Selector ── */}
      <div className="bg-[#0d1117] border border-[#30363d] p-4 rounded-xl space-y-2">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-[#a371f7]" />
          <h4 className="text-sm font-semibold text-white">Theme</h4>
        </div>
        <p className="text-xs text-[#8b949e]">Choose the UI color theme</p>
        <select
          value={currentTheme || 'dark'}
          onChange={e => {
            const val = e.target.value;
            setCurrentTheme(val);
            if (triggerToast) triggerToast(`Theme updated to '${val}'`, 'success');
          }}
          className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#58a6ff] mt-1"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="midnight">Midnight</option>
          <option value="forest">Forest</option>
        </select>
      </div>

      {/* ── Timezone ── */}
      <div className="bg-[#0d1117] border border-[#30363d] p-4 rounded-xl space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-4 h-4 text-[#58a6ff]" />
          <h4 className="text-sm font-semibold text-white">Timezone</h4>
        </div>
        <p className="text-xs text-[#8b949e]">Affects log timestamp display</p>
        <select
          value={settings.timezone || 'Browser Default'}
          onChange={e => autoSaveSettings({ ...settings, timezone: e.target.value }, `Timezone set to '${e.target.value}'`)}
          className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#58a6ff] mt-1"
        >
          <option value="Browser Default">Auto-Detect ({localTz})</option>
          <option value="UTC">(UTC+00:00) UTC (Universal Coordinated Time)</option>
          {timezones.map(item => (
            <option key={item.tz} value={item.tz}>{item.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
