import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1a56db', dark: '#1e429f' },
      },
    },
  },
  plugins: [],
} satisfies Config;
