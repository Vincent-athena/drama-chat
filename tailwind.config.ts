import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
      },
      colors: {
        stage: { 950: "#0b0710", 900: "#140d1c", 800: "#1f1529", 700: "#2d1f3b" },
        gold: { 400: "#e6c27a", 500: "#d4a64a" },
        blood: { 500: "#b3263e", 600: "#8f1d31" },
      },
    },
  },
  plugins: [],
} satisfies Config;
