import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0E1A",
        surface: "#111827",
        accent: "#00FF88",
        "text-primary": "#F0F0F0",
        "text-muted": "#6B7280",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      borderColor: {
        subtle: "rgba(255,255,255,0.08)",
      },
      boxShadow: {
        glow: "0 0 12px rgba(0,255,136,0.3)",
        "glow-lg": "0 0 32px rgba(0,255,136,0.35)",
      },
      borderRadius: {
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
