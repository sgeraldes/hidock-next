/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./src/index.html"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Outfit"', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          border: "hsl(var(--sidebar-border))",
        },
        status: {
          live: "hsl(var(--status-live))",
          success: "hsl(var(--status-success))",
          warning: "hsl(var(--status-warning))",
          info: "hsl(var(--status-info))",
        },
        speaker: {
          1: "hsl(var(--speaker-1))",
          2: "hsl(var(--speaker-2))",
          3: "hsl(var(--speaker-3))",
          4: "hsl(var(--speaker-4))",
          5: "hsl(var(--speaker-5))",
          6: "hsl(var(--speaker-6))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        raised: "0 1px 2px hsl(228 14% 4% / 0.3)",
        floating: "0 4px 16px hsl(228 14% 4% / 0.5), 0 1px 4px hsl(228 14% 4% / 0.3)",
        overlay: "0 8px 32px hsl(228 14% 4% / 0.7)",
        glow: "0 0 12px hsl(var(--glow-primary))",
        "glow-live": "0 0 16px hsl(var(--glow-live))",
        "glow-accent": "0 0 12px hsl(var(--glow-accent))",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        entrance: "cubic-bezier(0.16, 1, 0.3, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
        emphasis: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        micro: "100ms",
        standard: "150ms",
        entrance: "200ms",
        exit: "150ms",
        emphasis: "300ms",
      },
      keyframes: {
        "pulse-live": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "slide-in-right": {
          from: { transform: "translateX(8px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "slide-in-up": {
          from: { transform: "translateY(4px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { transform: "scale(0.95)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        // Legacy
        "pulse-recording": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "pulse-live": "pulse-live 1.5s ease-in-out infinite",
        "slide-in-right": "slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-up": "slide-in-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 150ms ease-out",
        "scale-in": "scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        // Legacy
        "pulse-recording": "pulse-recording 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/container-queries"),
  ],
};
