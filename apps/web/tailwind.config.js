/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'DM Sans'", 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ["'Playfair Display'", 'Georgia', 'serif'],
      },
      // Brand colours: change them here and every component class below follows.
      colors: { ink: '#172825', moss: '#668a78', sage: '#e8eee8', cream: '#f7f8f4', sun: '#eab96f', muted: '#75817b', line: '#e3e8e2' },
    },
  },
  plugins: [],
};
