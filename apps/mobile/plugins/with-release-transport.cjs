const { withAndroidManifest, withInfoPlist, AndroidConfig } = require("expo/config-plugins");
function withReleaseTransport(config) {
  config = withInfoPlist(config, value => {
    // Expo's native template permits arbitrary traffic for Metro; distributed variants do not.
    value.modResults.NSAppTransportSecurity = {
      NSAllowsArbitraryLoads: false,
      NSAllowsArbitraryLoadsInWebContent: false,
      NSAllowsArbitraryLoadsForMedia: false,
    };
    return value;
  });
  return withAndroidManifest(config, value => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(value.modResults);
    application.$["android:usesCleartextTraffic"] = "false";
    application.$["android:allowBackup"] = "false";
    return value;
  });
}
module.exports = withReleaseTransport;
