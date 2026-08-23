import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wenappliances.admin',
  appName: 'Admin Wen',
  webDir: 'dist/admin',
  android: {
    allowMixedContent: false
  }
};

export default config;
