import * as React from 'react';
import { useUi } from '@/stores/ui';

function systemDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useUi((s) => s.theme);
  const [sys, setSys] = React.useState(systemDark);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setSys(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return theme === 'system' ? (sys ? 'dark' : 'light') : theme;
}

export function useApplyTheme() {
  const resolved = useResolvedTheme();
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
}
