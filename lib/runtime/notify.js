// Radovin árfigyelő – értesítés (guide §20, P1.6, Commit 8).
//
// A riasztások elküldése Telegramra. A hitelesítési adatok CSAK környezeti változókból
// (RADOVIN_TELEGRAM_BOT_TOKEN, RADOVIN_TELEGRAM_CHAT_ID), SOHA konfigból / gitből –
// pontosan ahogy a guide §20 előírja: „Keep Telegram or other notification credentials
// in environment variables or the scheduler’s secret store, never in config committed to git."
//
// A funkció DRY-RUN biztonságos: ha nincs token/chat-id, NEM küld hálózatot, csak
// logol/return null-t; így a CI és a helyi fejlesztés soha nem véletlen riaszt.

'use strict';

const { log } = require('./logger.js');

function telegramConfigFromEnv(env) {
  const e = env || process.env;
  return {
    token: e.RADOVIN_TELEGRAM_BOT_TOKEN || '',
    chatId: e.RADOVIN_TELEGRAM_CHAT_ID || '',
  };
}

/**
 * Telegram üzenetküldés (opcionális). Ha token/chat-id hiányzik → dry-run, nem küld.
 * @param {string} text riasztás szövege
 * @param {Object} opts { env, force } – force igazsága kényszeríti a küldést (kézi teszt)
 * @returns {Promise<{sent:boolean, reason?:string, status?:number}>}
 */
async function notifyTelegram(text, opts = {}) {
  const { token, chatId } = telegramConfigFromEnv(opts.env || process.env);
  if (!text || !text.trim()) return { sent: false, reason: 'empty_text' };
  if (!token || !chatId) {
    log('notify_supressed', { reason: 'no_telegram_credentials', sent: false });
    return { sent: false, reason: 'no_credentials_dry_run' };
  }
  const teleUrl = 'https://api.telegram.org';
  const endpoint = `${teleUrl}/bot${token}/sendMessage`;
  const form = new URLSearchParams();
  form.set('chat_id', chatId);
  form.set('text', text);
  form.set('disable_web_page_preview', 'true');
  const resp = await fetch(endpoint, { method: 'POST', body: form });
  const status = resp.status;
  let body = null;
  try { body = await resp.json(); } catch {}
  const ok = status >= 200 && status <= 299 && body && body.ok === true;
  log('notify_sent', { sent: ok, status, event: 'notify' });
  return { sent: ok, status };
}

module.exports = { notifyTelegram, telegramConfigFromEnv };
