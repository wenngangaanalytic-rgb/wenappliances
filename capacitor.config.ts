import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wenappliances.admin',
  appName: 'Admin Wen',
  webDir: 'dist/admin',
  android: {
    allowMixedContent: false
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#9C6644'
    }
  }
};

export default config;
