import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'PAWME',
        short_name: 'PAWME',
        description: 'Playdates and friends for your pet, right in your neighborhood.',
        theme_color: '#ff6b4a',
        background_color: '#fff8f1',
        display: 'standalone',
        orientation: 'portrait',
        id: '/',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['social', 'lifestyle'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // separate maskable icon: Android crops it, so the paw sits inside the safe zone
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell offline; API calls always go to the network.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Pet photos are immutable per path — cache them so the deck survives a poor connection.
            urlPattern: /\/storage\/v1\/object\/public\/pet-photos\//,
            handler: 'CacheFirst',
            options: { cacheName: 'pet-photos', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 } },
          },
        ],
      },
    }),
  ],
  server: { host: true, port: 5173 },
});
