'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

const storageKey = 'ecom-theme-v1';
function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}
function subscribe(notify: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function sync() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      // Browser privacy settings can disable storage.
    }
    document.documentElement.dataset.theme =
      saved === 'dark' || saved === 'light'
        ? saved
        : media.matches
          ? 'dark'
          : 'light';
    notify();
  }
  window.addEventListener('storage', sync);
  window.addEventListener('ecom-theme-change', notify);
  media.addEventListener('change', sync);
  sync();
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener('ecom-theme-change', notify);
    media.removeEventListener('change', sync);
  };
}
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  function toggle() {
    const theme = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      // Switching remains available even when persistence is unavailable.
    }
    window.dispatchEvent(new Event('ecom-theme-change'));
  }
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggle}
    >
      <Sun className="theme-sun" size={20} aria-hidden="true" />
      <Moon className="theme-moon" size={20} aria-hidden="true" />
    </button>
  );
}
