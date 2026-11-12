/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/views/**/*.ejs', './src/public/js/**/*.js', './src/config/adminResources.js', './src/controllers/**/*.js'],
  theme: {
    extend: {
      colors: {
        // Values live in CSS variables (src/styles/app.css) so the palette is easy to adjust.
        brand: {
          red: 'var(--brand-red)',
          'red-dark': 'var(--brand-red-dark)',
          yellow: 'var(--brand-yellow)',
          'yellow-soft': 'var(--brand-yellow-soft)',
          green: 'var(--brand-green)',
          'green-dark': 'var(--brand-green-dark)',
          black: 'var(--brand-black)',
          white: 'var(--brand-white)',
          cream: 'var(--brand-cream)',
        },
      },
      fontFamily: {
        display: ['Anton', 'Impact', 'Arial Narrow', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        hard: '4px 4px 0 0 var(--brand-black)',
        'hard-sm': '2px 2px 0 0 var(--brand-black)',
      },
      maxWidth: { site: '80rem' },
    },
  },
  plugins: [],
};
