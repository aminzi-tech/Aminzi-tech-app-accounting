'use strict';
const config = require('./config');
const { createApp } = require('./app');

const { app } = createApp();
app.listen(config.port, () => {
  console.log(`AminZi Workspace on ${config.appOrigin} (port ${config.port}, ${config.isProd ? 'production' : 'development'})`);
  if (!config.googleEnabled) console.log('  Google sign-in is off: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
  if (config.mail.provider === 'console') console.log('  Emails and SMS codes are printed here (console provider).');
});
