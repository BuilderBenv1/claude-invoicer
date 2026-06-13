import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0b1220',
        panel: '#111a2e',
      },
    },
  },
  plugins: [],
} satisfies Config;
