/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        razor: {
          dark: '#080E1A',
          card: '#0F1A2E',
          cardHover: '#162540',
          border: '#1E2D4A',
          borderLight: '#2D3F66',
          blue: '#3395FF',
          blueHover: '#227FE0',
          blueLight: '#EBF4FF',
          navy: '#0C2340',
          emerald: '#10B981',
          emeraldDark: '#064E3B',
          amber: '#F59E0B',
          amberDark: '#78350F',
          purple: '#8B5CF6',
          purpleDark: '#4C1D95',
          rose: '#F43F5E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
