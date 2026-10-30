import { ref } from 'vue';

// Light/dark preference for the app shells (admin panel + signed-in
// customer app). Stored per browser; with nothing stored it follows the
// OS setting. Applied as <html data-theme="…"> so admin-theme.css can
// swap its tokens — the public pages don't opt into the dark tokens.
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'packeta-theme';

function readStored(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export const themeMode = ref<ThemeMode>(readStored() ?? (systemPrefersDark() ? 'dark' : 'light'));

function apply(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
}

apply(themeMode.value);

export function setTheme(mode: ThemeMode) {
  themeMode.value = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode / blocked storage — the choice just won't persist.
  }
  apply(mode);
}

export function toggleTheme() {
  setTheme(themeMode.value === 'dark' ? 'light' : 'dark');
}
