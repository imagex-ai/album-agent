import colors from 'tailwindcss/colors';

// Runtime palette channels retain Tailwind's exact defaults for existing themes.
const themedScale = (name, scale) => Object.fromEntries(Object.entries(scale).map(([step, hex]) => {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map(channel => parseInt(channel, 16)).join(' ');
  return [step, `rgb(var(--${name}-${step}, ${rgb}) / <alpha-value>)`];
}));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: themedScale('neutral', colors.slate),
        background: 'var(--bg-main)',
        surface: 'var(--bg-surface)',
        'surface-elevated': 'var(--bg-surface-elevated)',
        'surface-hover': 'var(--bg-surface-hover)',
        border: 'var(--border-color)',
        'border-focus': 'var(--border-focus)',
        brand: themedScale('brand', colors.blue),
        'primary-end': themedScale('brand', colors.indigo),
        'primary-violet': themedScale('brand', colors.violet),
        accent: {
          purple: '#8b5cf6',
          cyan: '#06b6d4',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#f43f5e'
        }
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      boxShadow: {
        'glow-brand': '0 0 25px -5px rgb(var(--brand-500, 59 130 246) / 0.35)',
        'glow-emerald': '0 0 25px -5px rgba(16, 185, 129, 0.35)',
        'glow-accent': '0 0 25px -5px rgba(139, 92, 246, 0.35)',
        'card-elevated': '0 8px 30px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s infinite linear',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        }
      }
    },
  },
  plugins: [],
}
