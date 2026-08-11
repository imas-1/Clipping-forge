/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08080d",
          900: "#0b0b14",
          850: "#101019",
          800: "#15151f",
          700: "#1d1d2a",
          600: "#2a2a3a",
          500: "#3d3d52",
        },
        signal: {
          DEFAULT: "#ff3b5c",
          soft: "#ff6b85",
          dim: "#5c1626",
        },
        reel: {
          DEFAULT: "#17e9b6",
          soft: "#6df3d3",
          dim: "#0f4d40",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,59,92,0.25), 0 8px 40px -8px rgba(255,59,92,0.35)",
        reel: "0 0 0 1px rgba(23,233,182,0.25), 0 8px 40px -8px rgba(23,233,182,0.35)",
      },
      keyframes: {
        scan: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
        pulseDot: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
        rise: { "0%": { opacity: 0, transform: "translateY(10px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
      },
      animation: {
        scan: "scan 2.2s linear infinite",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
        rise: "rise 0.5s ease-out both",
      },
    },
  },
  plugins: [],
};
