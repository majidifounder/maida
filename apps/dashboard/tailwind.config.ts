import type { Config } from 'tailwindcss';

/**
 * Maida design tokens v3.0 — monochrome.
 * The neutral ramp carries the entire UI; success/danger/notice are the only
 * color in the product and communicate state exclusively (never decoration).
 * See maida-brand-guidelines.md §4/§9.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F0F0E',
        charcoal: '#3A3A37',
        slate2: '#6B6B66',
        stone2: '#9B9B95',
        mist: '#D8D6D0',
        fog: '#EFEDE9',
        paper: '#FAFAF9',
        success: { DEFAULT: '#2E7D48', text: '#1B6E39', bg: '#EAF6EE' },
        danger: { DEFAULT: '#C6403E', text: '#9B2C2A', bg: '#FBEBEA' },
        notice: { DEFAULT: '#B8792B', text: '#8A5A1E', bg: '#FBF3E7' },
        // Legacy alias — maps the old blue "brand" onto Ink so any straggler
        // class renders monochrome instead of blue.
        brand: { DEFAULT: '#0F0F0E', dark: '#3A3A37' },
      },
      fontFamily: {
        serif: ['"DM Serif Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"DM Mono"', '"Courier New"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,15,14,0.06), 0 1px 2px rgba(15,15,14,0.04)',
        raised: '0 4px 12px rgba(15,15,14,0.08), 0 2px 4px rgba(15,15,14,0.05)',
        modal: '0 20px 60px rgba(15,15,14,0.18), 0 8px 24px rgba(15,15,14,0.08)',
      },
      borderRadius: {
        btn: '8px',
        card: '12px',
        modal: '16px',
      },
    },
  },
  plugins: [],
} satisfies Config;
