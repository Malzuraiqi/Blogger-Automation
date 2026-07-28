/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Dark-mode surfaces (default)
        ink: "#0F1014",
        "ink-2": "#16181D",
        "ink-3": "#1E2027",
        "ink-4": "#262930",
        // Light-mode surfaces
        canvas: "#F7F5F0",
        "canvas-2": "#EFECE5",
        "canvas-3": "#E5E1D8",
        // Type scale — dark
        paper: "#E8E5DC",
        "paper-dim": "#A09D95",
        "paper-faint": "#5C5A54",
        // Type scale — light
        stone: "#1A1916",
        "stone-dim": "#4A4844",
        "stone-faint": "#8C8A84",
        // Accent — used as thin lines, text on hover, never as fill
        accent: "#7B7FA8",          // muted indigo-slate
        "accent-dim": "#2D3050",    // deep for dark bg spark-dim replacement
        // Status semantic tones — desaturated
        ember: "#C49A5C",
        "ember-dim": "#3A2E1A",
        sage: "#7A9E82",
        "sage-dim": "#1F3326",
        danger: "#B85A52",
        border: "#272A31",
        "border-light": "#D8D4CC",
        // Legacy aliases kept for compatibility
        spark: "#7B7FA8",
        "spark-dim": "#2D3050",
      },
      fontFamily: {
        // Display serif — editorial weight for headings (Playfair Display)
        serif: ["\"Playfair Display\"", "\"Fraunces\"", "Georgia", "serif"],
        // UI grotesk — Inter for all UI chrome
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["\"IBM Plex Mono\"", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "1.4" }],
        xs: ["11.5px", { lineHeight: "1.5" }],
        sm: ["13px", { lineHeight: "1.6" }],
        base: ["14.5px", { lineHeight: "1.7" }],
        lg: ["16.5px", { lineHeight: "1.5" }],
        xl: ["19px", { lineHeight: "1.4" }],
        "2xl": ["22px", { lineHeight: "1.3" }],
        "3xl": ["28px", { lineHeight: "1.2" }],
        "4xl": ["36px", { lineHeight: "1.1" }],
      },
      letterSpacing: {
        widest: "0.18em",
        wider: "0.1em",
        wide: "0.06em",
      },
      transitionTimingFunction: {
        museum: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: {
        250: "250ms",
        350: "350ms",
      },
    },
  },
  plugins: [],
};
