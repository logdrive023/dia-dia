/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Dia a Dia — Estoque e Caixa',
        short_name: 'Dia a Dia',
        description: 'Controle de estoque, vendas e caixa, offline no celular.',
        lang: 'pt-BR',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f1f5f9',
        theme_color: '#2563eb',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'] },
    }),
  ],
  // React e o banco ficam em arquivos próprios, que não mudam entre versões: numa atualização o celular
  // baixa só a parte do app (menos internet, abre mais rápido com internet ruim)
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom'], banco: ['dexie', 'dexie-react-hooks'] },
      },
    },
  },
  // um arquivo de teste por vez: os backtests pesados não roubam CPU dos testes de tela (no GitHub há poucos núcleos)
  test: { environment: 'node', setupFiles: ['./src/__tests__/setup.ts'], testTimeout: 60_000, hookTimeout: 30_000, fileParallelism: false },
});
