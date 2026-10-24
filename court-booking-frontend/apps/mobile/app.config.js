// Dynamic layer over app.json (Expo passes app.json in as `config`).
//
// TEMPORARY: the development build ships WITHOUT Firebase. google-services.json only has an Android client for the
// old package com.maidan.app, and the Firebase project (maidan-31556) is not in our hands yet, so a
// com.aftrsolutions.khelo build would fail at the Gradle google-services step. Push notifications therefore do not
// work in development builds (lib/push-notifications.ts catches the token error). eas.json sets APP_VARIANT only
// per profile: preview and production keep googleServicesFile unchanged.
// To undo: put the new google-services.json in place and delete this file (or revert its commit).
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== "development") return config;
  const { googleServicesFile, ...android } = config.android ?? {};
  return { ...config, android };
};
