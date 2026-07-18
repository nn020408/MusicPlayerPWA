// Azure app registration settings — from portal.azure.com > App registrations > MusicPlayer
const APP_CONFIG = {
  clientId: "d5dfb518-91f5-4082-ad30-b2df5adc1ae5",
  // Personal Microsoft accounts only (Supported account types = "All Microsoft account users")
  authority: "https://login.microsoftonline.com/consumers",
  scopes: ["Files.Read", "offline_access", "User.Read"],
};
