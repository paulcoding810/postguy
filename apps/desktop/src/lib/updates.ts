import { invoke } from '@tauri-apps/api/core';
import type { Update } from '@tauri-apps/plugin-updater';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { openExternal } from './openExternal';
import { isTauri } from './server';

const RELEASES = 'https://github.com/paulcoding810/postguy/releases';
const AUTO_KEY = 'postguy.autoUpdateCheck';
const LAST_KEY = 'postguy.lastUpdateCheck';
const DAY_MS = 24 * 3600_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Whether Postguy checks for updates by itself, at launch and daily; on unless turned off. */
export const useAutoUpdateCheck = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: read(AUTO_KEY) !== 'off',
  set: (on) => {
    write(AUTO_KEY, on ? 'on' : 'off');
    set({ on });
  },
}));

interface Support {
  enabled: boolean;
  canInstall: boolean;
}

let support: Promise<Support> | null = null;
const updateSupport = () => (support ??= isTauri ? invoke<Support>('update_support') : Promise.resolve({ enabled: false, canInstall: false }));

let checking = false;

/**
 * Looks for a newer signed release. Quiet checks only speak up when there is one;
 * a manual check also says when you're up to date or why it couldn't check.
 */
export async function checkForUpdates({ quiet = false } = {}) {
  if (checking) return;
  const { enabled, canInstall } = await updateSupport();
  if (!enabled) {
    if (!quiet) toast.message('Updates aren’t available in this build', { description: 'Development builds don’t update themselves.', action: { label: 'Releases', onClick: () => void openExternal(RELEASES) } });
    return;
  }
  checking = true;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    write(LAST_KEY, String(Date.now()));
    if (!update) {
      if (!quiet) toast.success('Postguy is up to date');
      return;
    }
    const notes = `${RELEASES}/tag/v${update.version}`;
    toast.message(`Postguy ${update.version} is available`, {
      id: 'update',
      duration: Infinity,
      description: canInstall ? 'Your data is backed up before the update changes it.' : 'Download it from the releases page; this install can’t update itself.',
      action: canInstall
        ? { label: 'Restart to update', onClick: () => void install(update) }
        : { label: 'Download', onClick: () => void openExternal(notes) },
      cancel: { label: 'What’s new', onClick: () => void openExternal(notes) },
    });
  } catch (e) {
    if (!quiet) toast.error('Couldn’t check for updates', { description: e instanceof Error ? e.message : String(e) });
  } finally {
    checking = false;
  }
}

async function install(update: Update) {
  const id = toast.loading(`Downloading Postguy ${update.version}…`);
  try {
    await update.downloadAndInstall();
    toast.loading('Restarting…', { id });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    toast.error('The update didn’t install', {
      id,
      description: e instanceof Error ? e.message : String(e),
      action: { label: 'Download', onClick: () => void openExternal(`${RELEASES}/tag/v${update.version}`) },
    });
  }
}

/** Checks at launch and then daily while automatic checks are on; answers the macOS menu item. */
export function useUpdateChecks() {
  const on = useAutoUpdateCheck((s) => s.on);
  React.useEffect(() => {
    if (!isTauri || !on) return;
    const due = () => Date.now() - Number(read(LAST_KEY) ?? 0) >= DAY_MS;
    const first = setTimeout(() => due() && void checkForUpdates({ quiet: true }), 5000);
    const daily = setInterval(() => due() && void checkForUpdates({ quiet: true }), 3600_000);
    return () => {
      clearTimeout(first);
      clearInterval(daily);
    };
  }, [on]);
  React.useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => listen('check-updates', () => void checkForUpdates()).then((u) => (unlisten = u)));
    return () => unlisten?.();
  }, []);
}
