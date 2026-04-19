import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0f',
        surface: '#12121a',
        'surface-2': '#1a1a26',
        border: '#2a2a3a',
        'text-muted': '#6b7280',
        long: '#22c55e',
        short: '#ef4444',
        accent: '#7c3aed',
      },
    },
  },
  plugins: [],
};

export default config;
