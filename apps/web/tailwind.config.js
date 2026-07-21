/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          300: '#a89dff',
          400: '#8a7dff',
          500: '#6d5dfc',
          600: '#6d5dfc',
          700: '#5b4ce6',
        },
        electric: {
          DEFAULT: '#22d3ee',
          soft: 'rgba(34,211,238,0.16)',
        },
        warm: {
          DEFAULT: '#f59e0b',
          soft: 'rgba(245,158,11,0.16)',
        },
        surface: {
          DEFAULT: '#131318',
          card: '#1a1a21',
          elevated: '#232330',
          border: 'rgba(255,255,255,0.08)',
        },
      },
      fontFamily: {
        display: ['"Unbounded"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'hero-gradient': 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(109,93,252,0.25), transparent)',
        'brand-gradient': 'linear-gradient(135deg, #6d5dfc 0%, #8a5cf6 55%, #b45cf0 100%)',
      },
    },
  },
  plugins: [],
}
