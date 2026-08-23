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
          .replaceAll('WenAppliances premium appliance store', 'Secure Admin Wen administration portal')
          .replaceAll('WenAppliances', 'Admin Wen')
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
