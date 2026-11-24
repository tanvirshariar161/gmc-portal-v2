import type { Config } from "tailwindcss";

// Tokens come from immigration.gmc.bt (docs/design-reference/tokens.css) and live as CSS variables in src/app/styles.css.
const v = (name: string) => `var(--${name})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    borderRadius: { none: "0", DEFAULT: "0", sm: "0", md: "0", lg: "0", checkbox: "4px", full: "9999px" },
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        sunk: v("sunk"),
        fg: v("fg"),
        "fg-2": v("fg-2"),
        muted: v("muted"),
        placeholder: v("placeholder"),
        line: v("line"),
        "line-soft": v("line-soft"),
        input: v("input"),
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), fg: "#ffffff" },
        brand: { 50: v("brand-50"), 200: v("brand-200"), 700: v("brand-700"), ink: v("brand-ink") },
        ok: { bg: v("ok-bg"), line: v("ok-line"), fg: v("ok-fg") },
        rev: { bg: v("rev-bg"), line: v("rev-line"), fg: v("rev-fg") },
        act: { bg: v("act-bg"), line: v("act-line"), fg: v("act-fg") },
        rej: { bg: v("rej-bg"), line: v("rej-line"), fg: v("rej-fg") },
        ember: v("ember"),
        thead: { DEFAULT: v("table-head"), fg: v("table-head-fg") }
      },
      fontFamily: {
        sans: ['"Roboto"', "Arial", "system-ui", "sans-serif"],
        serif: ['"Lora"', "Georgia", '"Times New Roman"', "serif"]
      },
      maxWidth: { page: "96rem" },
      boxShadow: {
        pop: "0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a"
      }
    }
  },
  plugins: []
} satisfies Config;
