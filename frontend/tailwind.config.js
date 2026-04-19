/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-live": "pulse-live 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        "pulse-live": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 0 0 rgba(56, 189, 248, 0.5)" },
          "50%": { opacity: "0.85", boxShadow: "0 0 0 8px rgba(56, 189, 248, 0)" },
        },
      },
    },
  },
  plugins: [],
};
