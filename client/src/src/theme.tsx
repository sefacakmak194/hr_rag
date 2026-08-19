import { useEffect, useState } from 'react';

export type Theme = 'fildisi' | 'koyu';

const KEY = 'phr-theme';

function initial(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === 'fildisi' || saved === 'koyu') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'koyu' : 'fildisi';
}

/**
 * Tema secimi.
 *
 * Secim `data-theme` olarak <html> uzerine yazilir; tum renkler CSS
 * belirteclerinden geldigi icin bileşenlerin tema bilgisine ihtiyaci yok.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}) {
  return (
    <div className="theme-toggle" role="group" aria-label="Tema">
      <button
        type="button"
        aria-pressed={theme === 'fildisi'}
        onClick={() => onChange('fildisi')}
      >
        Fildişi
      </button>
      <button type="button" aria-pressed={theme === 'koyu'} onClick={() => onChange('koyu')}>
        Koyu
      </button>
    </div>
  );
}

export default ThemeToggle;
