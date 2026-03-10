'use client';
import { useTheme } from './ThemeProvider';

// Drop-in toggle button — add to navbar
// Usage: <ThemeToggle />
export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${className}`}
    >
      {/* Sun icon */}
      <svg
        className={`absolute w-5 h-5 text-yellow-500 transition-all ${theme === 'dark' ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {/* Moon icon */}
      <svg
        className={`absolute w-5 h-5 text-blue-400 transition-all ${theme === 'dark' ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    </button>
  );
}
