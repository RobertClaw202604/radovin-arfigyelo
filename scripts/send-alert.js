#!/usr/bin/env node
// Radovin árfigyelő – kézi riasztás-teszt (guide §20, Commit 8).
//
// Használat:
//   node scripts/send-alert.js                  # dry-run: mutatja a szöveget, NEM küld
//   node scripts/send-alert.js --send           # tényleges Telegram-küldés (env creds kell)
//   RADOVIN_TELEGRAM_BOT_TOKEN=... RADOVIN_TELEGRAM_CHAT_ID=... node scripts/send-alert.js --send
//
// CI-biztonságos: --send nélkül vagy creds hiányában NEM megy hálózatra.

'use strict';

const { notifyTelegram } = require('../lib/runtime/notify.js');
const { toTelegramText } = require('../lib/pipeline/alerts.js');

const SEND = process.argv.includes('--send');
const TEXT = toTelegramText({
  severity: 'info',
  subject: 'teszt értesítés',
  lines: [['radovin', 'riaszto-rendszer', 'manual', SEND ? 'send' : 'dry-run']],
});

console.log('---- üzenet szövege (dry-run) ----\n' + TEXT + '\n----------------------------------');

if (!SEND) {
  console.log('(dry-run: --send nélkül nincs hálózati küldés)');
  process.exit(0);
}

notifyTelegram(TEXT).then((res) => {
  console.log('send result:', JSON.stringify(res));
  process.exit(res.sent ? 0 : 2);
}).catch((e) => { console.error('HIBA:', e.message); process.exit(1); });
