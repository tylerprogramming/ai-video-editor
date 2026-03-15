/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        editor: {
          bg: '#1a1a1a',
          panel: '#252525',
          border: '#3a3a3a',
          accent: '#4a9eff',
          track: '#2d2d2d',
          clip: '#3d6b9e',
          'clip-selected': '#5a9fd4',
          text: '#e0e0e0',
          muted: '#888888',
        }
      }
    }
  },
  plugins: []
}
