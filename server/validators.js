'use strict';
/**
 * Input validation. Every request body is parsed through a zod schema;
 * unknown keys are stripped (.strict() would reject — we prefer strip + ignore
 * so a newer client doesn't break an older server).
 */
const { z } = require('zod');
const registry = require('./provisioning/registry');

const DEFAULT_CC = (process.env.DEFAULT_COUNTRY_CODE || '93').replace(/\D/g, '');

function normaliseEmail(raw) {
  return String(raw || '').trim().toLowerCase().normalize('NFKC');
}

/** Normalise to E.164 (+93701234567). Local numbers starting with 0 get the default country code. */
function normalisePhone(raw) {
  let s = String(raw || '').trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0\d{6,14}$/.test(s)) s = `+${DEFAULT_CC}${s.slice(1)}`;
  return s;
}

const email = z.string().max(254).transform(normaliseEmail)
  .refine(v => /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(v), 'Enter a valid email address, like name@shop.com.');

const phone = z.string().max(32).transform(normalisePhone)
  .refine(v => /^\+[1-9]\d{7,14}$/.test(v), 'Enter a phone number with country code, like +93 70 123 4567.');

const businessName = z.string().trim().min(2, 'Business name needs at least 2 characters.').max(80, 'Keep the business name under 80 characters.')
  // Block control characters and angle brackets outright; everything else is escaped on output anyway.
  .refine(v => !/[\u0000-\u001f\u007f<>]/.test(v), 'Business name contains characters that are not allowed.');

const businessType = z.string().max(64).refine(id => registry.has(id), 'Choose a business type from the list.');

// Short list of the most common passwords. Production: check against HIBP k-anonymity API.
const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'afghanistan', 'kabul123', 'p@ssw0rd', 'letmein1', '11111111', '00000000']);
const password = z.string().min(10, 'Use at least 10 characters.').max(128, 'Keep the password under 128 characters.')
  .refine(v => !COMMON.has(v.toLowerCase()), 'That password is too common. Pick something less predictable.');

const code = z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits.');

const schemas = {
  signup: z.object({
    businessName, email, phone, businessType, password,
    verifyBy: z.enum(['email', 'phone']).default('email'),
  }),
  signupVerify: z.object({ pendingId: z.string().uuid(), code }),
  loginEmail: z.object({ email, password: z.string().min(1).max(128) }),
  loginPhoneStart: z.object({ phone }),
  loginPhoneVerify: z.object({ phone, code }),
  completeProfile: z.object({ businessName, phone, businessType }),
  verifyChannelStart: z.object({ channel: z.enum(['email', 'phone']) }),
  verifyChannelCode: z.object({ channel: z.enum(['email', 'phone']), code }),
  resend: z.object({ pendingId: z.string().uuid(), channel: z.enum(['email', 'phone']).default('email') }),
};

function parse(schema, body) {
  const r = schema.safeParse(body || {});
  if (r.success) return { data: r.data };
  const fields = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] || '_';
    if (!fields[k]) fields[k] = issue.message;
  }
  return { error: { message: 'Some fields need attention.', fields } };
}

module.exports = { schemas, parse, normaliseEmail, normalisePhone };
