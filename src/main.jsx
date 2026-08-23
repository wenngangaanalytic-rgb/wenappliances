import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './app.jsx';
import './index.css';

const isAdminBuild = import.meta.env.MODE === 'admin';
const isAdminHost = typeof window !== 'undefined' && window.location.hostname.includes('wenappliances-admin');

const setApplicationIdentity = () => {
  if (!isAdminBuild && !isAdminHost) return;

  document.title = 'Admin Wen';
  document.querySelector('meta[name="description"]')?.setAttribute('content', 'Secure WenAppliances administration portal');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#2563EB');
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Admin Wen');

  const favicon = document.querySelector('link[rel="icon"]');
  favicon?.setAttribute('href', '/admin-wen-logo.svg');

  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  appleIcon?.setAttribute('href', '/admin-wen-logo.svg');

  const manifest = document.querySelector('link[rel="manifest"]');
  manifest?.setAttribute('href', '/admin-wen-manifest.webmanifest');
};

setApplicationIdentity();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
);

if ((isAdminBuild || isAdminHost || import.meta.env.MODE === 'storefront') && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerPath = isAdminBuild || isAdminHost ? '/admin-service-worker.js' : '/service-worker.js';
    navigator.serviceWorker.register(serviceWorkerPath).catch((error) => {
      console.warn('WenAppliances notification service worker could not be registered.', error);
    });
  });
}
