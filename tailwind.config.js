/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Syne', 'sans-serif']
      },
      colors: {
        accent: '#00c2ff',
        accent2: '#7b61ff',
        accent3: '#00ffc8',
        ink: '#04050a'
      },
      animation: {
        'blob-1': 'blobMove 12s ease-in-out infinite',
        'blob-2': 'blobMove 15s ease-in-out infinite reverse',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'shimmer': 'shimmer 4s linear infinite'
      },
      keyframes: {
        blobMove: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(20px,-20px) scale(1.05)' }
        },
        pulseSoft: {
          '0%,100%': { opacity: 1 },
          '50%': { opacity: 0.3 }
        },
        shimmer: {
          '0%': { backgroundPosition: '0% center' },
          '100%': { backgroundPosition: '200% center' }
        }
      }
    }
  },
  plugins: []
};
