import { invoke } from '@tauri-apps/api/core';

export interface ServerInfo {
  baseUrl: string;
  token: string;
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let cached: Promise<ServerInfo> | null = null;

export function getServerInfo(): Promise<ServerInfo> {
  cached ??= isTauri
    ? invoke<ServerInfo>('server_info')
    : Promise.resolve({
        baseUrl: import.meta.env.VITE_SERVER_URL ?? 'http://127.0.0.1:4777',
        token: import.meta.env.VITE_SERVER_TOKEN ?? 'dev-token',
      });
  return cached;
}
