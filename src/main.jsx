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

if ((isAdminBuild || isAdminHost) && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/admin-service-worker.js').catch((error) => {
      console.warn('WenAppliances notification service worker could not be registered.', error);
    });
  });
}

// Remove the old customer installable-app service worker from browsers that
// installed it before the storefront was returned to a normal website.
if (!isAdminBuild && !isAdminHost && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations
        .filter((registration) => registration.active?.scriptURL.endsWith('/service-worker.js'))
        .forEach((registration) => registration.unregister());
    }).catch(() => {
      // Continue if browser service-worker access is unavailable.
    });
  });
}
