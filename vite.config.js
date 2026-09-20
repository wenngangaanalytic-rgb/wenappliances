import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [
    {
      name: 'wen-application-identity',
      transformIndexHtml(html) {
        if (mode !== 'admin') return html;

        return html
          .replace('href="/manifest.json"', 'href="/admin-manifest.json"')
          .replaceAll('WenAppliances premium appliance store', 'Secure Admin Wen administration portal')
          .replaceAll('WenAppliances', 'Admin Wen')
          .replace('name="robots" content="index, follow"', 'name="robots" content="noindex, nofollow"')
          .replaceAll('#9C6644', '#2563EB')
          .replaceAll('/wenappliances-logo.svg', '/admin-wen-logo.svg');
      }
    },
    react(),
    tailwindcss()
  ],
  build: {
    outDir: mode === 'admin' ? 'dist/admin' : 'dist'
  }
}));
