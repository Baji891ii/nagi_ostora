const developers = ['212638915517'];

export default {
  name: 'nagi sichiro bot',
  version: '2.0.0',
  prefix: '.',
  sessionDir: './session',
  dataDir: './data',
  developers,
  behaviour: { autoRead: false },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '9077247838:AAF_VWNPE0JNbCAQPEfOzsRenfVRVLsAq7s',
    adminId: process.env.TELEGRAM_ADMIN_ID || '9077247838'
  },
  console: { enabled: true },
  database: { saveInterval: 10000 },
  testChannel: 'https://whatsapp.com/channel/0029VbDwfhiG3R3aIAbmA73m'
};
