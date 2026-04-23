import type { Config } from "tailwindcss";

// ─── Zomeo.ai Brand Theme ───────────────────────────────────────────────────
// Primary: Emerald (nature / healing — fits homeopathy)
// Font: Inter (clean, medical-grade SaaS)
// Apply everywhere: buttons, active nav, links, focus rings, logos

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary brand color — use `primary-*` instead of `emerald-*`
        primary: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',  // main CTA color
          700: '#15803d',  // hover
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
