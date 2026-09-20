import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './app.jsx';
import AnalyticsConsent from './AnalyticsConsent.jsx';
import { initializeNativeNotifications } from './browserNotifications';
import './index.css';

const isAdminBuild = import.meta.env.MODE === 'admin';
const isAdminHost = typeof window !== 'undefined' && window.location.hostname.includes('wenappliances-admin');

const setApplicationIdentity = () => {
  if (!isAdminBuild && !isAdminHost) return;

  document.title = 'Admin Wen';
  document.querySelector('meta[name="description"]')?.setAttribute('content', 'Secure WenAppliances administration portal');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#9C6644');
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Admin Wen');

  const favicon = document.querySelector('link[rel="icon"]');
  favicon?.setAttribute('href', '/wen-icon.png');

  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  appleIcon?.setAttribute('href', '/wen-icon.png');

};

setApplicationIdentity();
void initializeNativeNotifications();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
    <AnalyticsConsent />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerPath = isAdminBuild || isAdminHost
      ? '/admin-service-worker.js'
      : '/service-worker.js';

    navigator.serviceWorker.register(serviceWorkerPath).catch((error) => {
      console.warn('WenAppliances notification service worker could not be registered.', error);
    });
  });
}
