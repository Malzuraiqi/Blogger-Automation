/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14171C",
        "ink-2": "#1B1F26",
        "ink-3": "#242A33",
        paper: "#F3F1EA",
        "paper-dim": "#B9B6AC",
        "paper-faint": "#7C7A72",
        spark: "#7C8CFF",
        "spark-dim": "#3D4470",
        ember: "#F2A541",
        "ember-dim": "#5B4526",
        sage: "#8FB996",
        "sage-dim": "#33463A",
        danger: "#E1685E",
        border: "#2C323C",
      },
      fontFamily: {
        serif: ["Fraunces", "serif"],
        sans: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
