import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf4ee',
          100: '#fae3d0',
          500: '#e07b39',
          600: '#c8662a',
          700: '#a34f1e',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
