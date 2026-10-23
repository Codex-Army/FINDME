'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch (e) { console.warn('Could not read .env:', e.message); }
}
module.exports = {
  port: Number(process.env.PORT) || 3000,
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionSecretIsEphemeral: !process.env.SESSION_SECRET,
  flag: process.env.FLAG || 'FLAG{HUNT_THE_HIDDEN_LOCATION}',
  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || 'database'),
  trustProxy: String(process.env.TRUST_PROXY).toLowerCase() === 'true'
};
