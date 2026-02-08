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
        // Dark theme colors (GitHub-inspired)
        dark: {
          'bg-primary': '#0d1117',
          'bg-secondary': '#161b22',
          'bg-tertiary': '#21262d',
          'border': '#30363d',
          'text-primary': '#c9d1d9',
          'text-secondary': '#f0f6fc',
          'text-muted': '#8b949e',
        },
        // Light theme colors
        light: {
          'bg-primary': '#ffffff',
          'bg-secondary': '#f6f8fa',
          'bg-tertiary': '#eaeef2',
          'border': '#d0d7de',
          'text-primary': '#24292f',
          'text-secondary': '#1f2328',
          'text-muted': '#57606a',
        },
        // Brand colors
        accent: {
          DEFAULT: '#3B82F6', // Blue-500
          hover: '#2563EB',   // Blue-600
          light: '#60A5FA',   // Blue-400
          bg: 'rgba(59, 130, 246, 0.1)'
        },
        success: {
          DEFAULT: '#22C55E', // Green-500
          bg: 'rgba(34, 197, 94, 0.1)'
        },
        error: {
          DEFAULT: '#EF4444', // Red-500
          bg: 'rgba(239, 68, 68, 0.1)'
        },
        warning: {
          DEFAULT: '#F59E0B', // Amber-500
          bg: 'rgba(245, 158, 11, 0.1)'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace']
      },
      fontSize: {
        '2xs': '0.625rem', // 10px
      },
      spacing: {
        '18': '4.5rem',
        '112': '28rem',
        '128': '32rem',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'bounce-slow': 'bounce 2s infinite',
        'pulse-slow': 'pulse 3s infinite',
        'slide-in': 'slideIn 0.3s ease-out',
        'slide-out': 'slideOut 0.3s ease-in',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideOut: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        }
      },
      boxShadow: {
        'glow': '0 0 20px rgba(59, 130, 246, 0.3)',
        'glow-lg': '0 0 30px rgba(59, 130, 246, 0.4)',
      }
    },
  },
  plugins: [],
}
