import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.javin23863.linguarelay",
  appName: "Lingua Relay",
  webDir: "www",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor"
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 700,
      backgroundColor: "#09141e",
      showSpinner: false
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#09141e"
    }
  }
};

export default config;
