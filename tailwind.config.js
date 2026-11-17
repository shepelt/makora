/** @type {import('tailwindcss').Config} */
// Tailwind v3 on purpose: the UI is ported from the Meteor version, which
// used the v3 CDN build; v4 changes defaults (border color, shadow/ring sizes).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
