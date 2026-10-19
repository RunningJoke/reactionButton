/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

// base "./": the build runs from any path (later hosting, Capacitor webview).
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "ReactPod Config",
        short_name: "ReactPod",
        description: "Build, simulate and upload ReactPod programs",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#101418",
        theme_color: "#101418",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json,woff2}"],
      },
    }),
  ],
  server: {
    // the shipped programs in ../firmware/data are bundled (src/defaults); the program model is in ../packages
    fs: { allow: [".", "../firmware/data", "../packages"] },
  },
  test: {
    environment: "node", // React tests opt in with "@vitest-environment jsdom"
  },
});
