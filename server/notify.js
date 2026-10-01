'use strict';
/**
 * Outbound email + SMS. "console" providers print to stdout and keep the last
 * messages in memory (used by tests) — the config refuses console in production.
 */
const config = require('./config');

const outbox = []; // dev/test only
function remember(msg) {
  outbox.push({ ...msg, at: Date.now() });
  if (outbox.length > 50) outbox.shift();
}

async function sendEmail({ to, subject, text }) {
  if (config.mail.provider === 'console') {
    remember({ channel: 'email', to, subject, text });
    console.log(`\n[dev mail] to=${to}\n  subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}\n`);
    return;
  }
  if (config.mail.provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.mail.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mail.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
    return;
  }
  throw new Error(`Unknown MAIL_PROVIDER ${config.mail.provider}`);
}

async function sendSms({ to, text }) {
  if (config.sms.provider === 'console') {
    remember({ channel: 'phone', to, text });
    console.log(`\n[dev sms] to=${to}\n  ${text}\n`);
    return;
  }
  if (config.sms.provider === 'twilio') {
    const { twilioSid, twilioToken, twilioFrom } = config.sms;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: twilioFrom, Body: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
    return;
  }
  throw new Error(`Unknown SMS_PROVIDER ${config.sms.provider}`);
}

module.exports = { sendEmail, sendSms, outbox };
