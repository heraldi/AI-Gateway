import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          900: '#0d1117',
          800: '#161b22',
          700: '#21262d',
          600: '#30363d',
          500: '#484f58',
        },
        accent: {
          DEFAULT: '#58a6ff',
          hover: '#79b8ff',
          dim: '#1f6feb',
        },
        success: '#3fb950',
        warning: '#d29922',
        danger: '#f85149',
        muted: '#8b949e',
      },
    },
  },
  plugins: [],
} satisfies Config;
