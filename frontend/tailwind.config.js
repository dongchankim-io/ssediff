/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(-2px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        fadeIn: "fadeIn 120ms ease-out",
      },
    },
  },
  plugins: [],
};
