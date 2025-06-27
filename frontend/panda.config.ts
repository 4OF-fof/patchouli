import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  // Whether to use css reset
  preflight: true,

  // Where to look for your css declarations
  include: ["./src/**/*.{js,jsx,ts,tsx}"],

  // Files to exclude
  exclude: [],

  // Useful for theme customization
  theme: {
    extend: {
      tokens: {
        colors: {
          brand: {
            primary: { value: "#6366f1" },
            secondary: { value: "#8b5cf6" },
          },
          gray: {
            50: { value: "#f9fafb" },
            100: { value: "#f3f4f6" },
            200: { value: "#e5e7eb" },
            300: { value: "#d1d5db" },
            400: { value: "#9ca3af" },
            500: { value: "#6b7280" },
            600: { value: "#4b5563" },
            700: { value: "#374151" },
            800: { value: "#1f2937" },
            900: { value: "#111827" },
          },
        },
        spacing: {
          18: { value: "4.5rem" },
          72: { value: "18rem" },
          84: { value: "21rem" },
          96: { value: "24rem" },
        },
      },
    },
  },

  // The output directory for your css system
  outdir: "styled-system",
});
