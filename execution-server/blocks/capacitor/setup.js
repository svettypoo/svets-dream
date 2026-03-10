/**
 * Capacitor block — wraps any Next.js web app into iOS + Android native shells
 *
 * How it works:
 *  1. Next.js app builds to static export (next export → out/)
 *  2. Capacitor copies out/ into native iOS/Android projects
 *  3. Builds APK (Android) or IPA (iOS) with real App Store app icons
 *
 * Requirements on build machine:
 *  - Android: Android Studio + SDK (Railway can do this with docker)
 *  - iOS: Xcode + macOS only (needs Mac or GitHub Actions with macOS runner)
 */

const fs = require('fs');
const path = require('path');

module.exports = function setupCapacitor(outDir, config) {
  const appId = config.bundleId || `com.forge.${config.appName?.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const appName = config.appName || 'MyApp';

  // 1. Patch next.config.js to add static export
  const nextConfigPath = path.join(outDir, 'next.config.js');
  if (fs.existsSync(nextConfigPath)) {
    let nc = fs.readFileSync(nextConfigPath, 'utf8');
    if (!nc.includes('output:')) {
      nc = nc.replace('const nextConfig = {', "const nextConfig = {\n  output: 'export',\n  trailingSlash: true,");
      fs.writeFileSync(nextConfigPath, nc, 'utf8');
    }
  }

  // 2. Write capacitor.config.json
  const capacitorConfig = {
    appId,
    appName,
    webDir: 'out',
    server: { androidScheme: 'https' },
    plugins: {
      SplashScreen: { launchShowDuration: 2000, backgroundColor: config.primaryColor || '#6366f1', showSpinner: false },
      StatusBar: { style: 'Default', backgroundColor: config.primaryColor || '#6366f1' },
      PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    },
  };
  fs.writeFileSync(path.join(outDir, 'capacitor.config.json'), JSON.stringify(capacitorConfig, null, 2), 'utf8');

  // 3. Add capacitor deps to package.json
  const pkgPath = path.join(outDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.dependencies = {
      ...pkg.dependencies,
      '@capacitor/core': '^6.0.0',
      '@capacitor/android': '^6.0.0',
      '@capacitor/ios': '^6.0.0',
      '@capacitor/push-notifications': '^6.0.0',
      '@capacitor/status-bar': '^6.0.0',
      '@capacitor/splash-screen': '^6.0.0',
    };
    pkg.scripts = {
      ...pkg.scripts,
      'build:mobile': 'next build && npx cap sync',
      'build:android': 'next build && npx cap sync android && npx cap build android',
      'open:android': 'npx cap open android',
      'open:ios': 'npx cap open ios',
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
  }

  // 4. Write mobile build instructions
  const readme = `# Mobile Build — ${appName}

## Android APK
\`\`\`bash
npm install
npm run build:android
# APK at: android/app/build/outputs/apk/debug/app-debug.apk
\`\`\`

## iOS (requires macOS + Xcode)
\`\`\`bash
npm install
npm run build:mobile
npm run open:ios
# Then build from Xcode
\`\`\`

## App Details
- Bundle ID: ${appId}
- Primary Color: ${config.primaryColor || '#6366f1'}
- Web Dir: out/ (Next.js static export)

## Push Notifications
Push notifications are pre-configured via @capacitor/push-notifications.
Add your FCM (Android) and APNs (iOS) keys in capacitor.config.json.

## First-time Setup
\`\`\`bash
npx cap init "${appName}" "${appId}" --web-dir out
npx cap add android
npx cap add ios
\`\`\`
`;
  fs.writeFileSync(path.join(outDir, 'MOBILE.md'), readme, 'utf8');

  console.log(`   ✓ Capacitor configured: ${appId}`);
  console.log(`   ✓ Bundle scripts: build:mobile, build:android, open:android, open:ios`);
};
