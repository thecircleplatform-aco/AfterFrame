/**
 * AfterFrame transactional email templates.
 *
 * Rules these follow, because email clients are 2005 forever:
 *  - tables + inline styles only (no flex, no grid, no external CSS)
 *  - no external images: a blocked logo would leave an empty box
 *  - one column, 560px, white card on a neutral page — the standard shape of
 *    professional transactional mail, and the one that survives every client's
 *    dark-mode inversion without turning the text invisible
 *  - every message ships a plain-text twin, so clients that strip HTML still read it
 *
 * Each template returns `{ subject, text, html }`. `render(template, data)` is the
 * only entry point the worker uses.
 */

const BRAND = 'AfterFrame'
const LOGO_URL = 'https://afterframe.acocloud.app/brand/af-mark-black.png'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace"

// A light design system rather than one flat grey: ink for headings, slate for
// copy, and four tints pulled from the product's own brand spectrum. Each tint
// carries a matching solid, so the accent rule and the panel agree.
const PALETTE = {
  page: '#f5f6fa',
  card: '#ffffff',
  line: '#e5e8ef',
  text: '#475569',
  strong: '#0f172a',
  dim: '#64748b',
  faint: '#94a3b8',
  accent: '#4f46e5',
  accentTint: '#eef1ff',
  success: '#047857',
  successTint: '#ecfdf5',
  warn: '#b45309',
  warnTint: '#fffbeb',
  danger: '#be123c',
  dangerTint: '#fff1f2',
  button: '#4f46e5',
  buttonInk: '#ffffff',
  codeBg: '#f8fafc',
  band: '#f8fafc',
  // The product's brand spectrum, used only for the hairline under the lockup.
  spectrum: ['#f472b6', '#3b82f6', '#8b5cf6', '#34d399'],
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Hidden preview line Gmail shows next to the subject. */
function preheader(text) {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${escapeHtml(text)}</div>`
}

/**
 * The frame every message shares. `body` is trusted HTML built by the template
 * below, never user input.
 */
function shell({ preview, eyebrow, heading, body, footerNote }) {
  const stripe = PALETTE.spectrum
    .map((colour) => `<td width="25%" height="3" bgcolor="${colour}" style="height:3px;line-height:3px;font-size:0">&nbsp;</td>`)
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.page};color:${PALETTE.text};font-family:${FONT};-webkit-font-smoothing:antialiased">
${preheader(preview)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.page}">
  <tr>
    <td align="center" style="padding:40px 16px 52px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%">

        <!-- lockup: logo tile + wordmark, then the brand spectrum as a hairline -->
        <tr>
          <td style="padding:0 2px 14px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="34" valign="middle" style="width:34px;padding:0 10px 0 0">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:34px">
                    <tr>
                      <td align="center" valign="middle" width="34" height="34" bgcolor="${PALETTE.accentTint}" style="width:34px;height:34px;border-radius:9px">
                        <img src="${LOGO_URL}" width="19" height="15" alt="${BRAND}" style="display:block;border:0;outline:none;text-decoration:none">
                      </td>
                    </tr>
                  </table>
                </td>
                <td valign="middle" style="font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:-0.02em;color:${PALETTE.strong}">
                  ${BRAND}
                  <span style="font-size:10px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${PALETTE.faint};padding-left:8px">Studio</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 2px 20px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
              <tr>${stripe}</tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="background:${PALETTE.card};border:1px solid ${PALETTE.line};border-radius:16px;padding:32px 32px 30px">
            ${eyebrow ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${PALETTE.accent}">${escapeHtml(eyebrow)}</p>` : ''}
            <h1 style="margin:0 0 16px;font-family:${FONT};font-size:23px;line-height:1.28;font-weight:700;letter-spacing:-0.02em;color:${PALETTE.strong}">${escapeHtml(heading)}</h1>
            ${body}
          </td>
        </tr>

        <tr>
          <td style="padding:18px 0 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PALETTE.band};border:1px solid ${PALETTE.line};border-radius:12px">
              <tr>
                <td style="padding:16px 18px">
                  <p style="margin:0 0 10px;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${PALETTE.dim}">${footerNote}</p>
                  <p style="margin:0;font-family:${FONT};font-size:11.5px;line-height:1.6;color:${PALETTE.faint}">
                    ${BRAND} · a product of
                    <a href="https://acocloud.app" style="color:${PALETTE.accent};text-decoration:none;font-weight:600">ACO</a>
                    · you receive this because an account exists for this address.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

/** Bulletproof single-CTA button: a table cell, so Outlook draws it too. */
function button(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">
    <tr>
      <td align="center" bgcolor="${PALETTE.button}" style="border-radius:9px">
        <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:14.5px;font-weight:600;line-height:1.2;color:${PALETTE.buttonInk};text-decoration:none;border-radius:9px">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`
}

function para(html, { muted = false } = {}) {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:14.5px;line-height:1.65;color:${muted ? PALETTE.dim : PALETTE.text}">${html}</p>`
}

/** Small monospace box for a link, so it survives clients that block buttons. */
function linkBox(href) {
  return `<p style="margin:0 0 20px;padding:11px 13px;background:${PALETTE.codeBg};border:1px solid ${PALETTE.line};border-radius:8px;font-family:${MONO};font-size:11.5px;line-height:1.6;word-break:break-all;color:${PALETTE.dim}">${escapeHtml(href)}</p>`
}

/**
 * A tinted panel with a coloured left rule. This is what stops a message feeling
 * empty: it gives the card a second tone without turning into a coloured slab.
 */
function panel(html, tone = 'accent') {
  const tint = PALETTE[`${tone}Tint`] ?? PALETTE.accentTint
  const solid = PALETTE[tone] ?? PALETTE.accent
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 22px">
    <tr>
      <td width="3" bgcolor="${solid}" style="width:3px;line-height:0;font-size:0">&nbsp;</td>
      <td bgcolor="${tint}" style="padding:14px 16px">
        <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${PALETTE.text}">${html}</p>
      </td>
    </tr>
  </table>`
}

/** Two-column facts (used by the security notice). */
function facts(rows) {
  const body = rows
    .map(([label, value]) => `<tr>
        <td style="padding:0 14px 8px 0;font-family:${FONT};font-size:12.5px;line-height:1.5;color:${PALETTE.dim};white-space:nowrap">${escapeHtml(label)}</td>
        <td style="padding:0 0 8px;font-family:${FONT};font-size:12.5px;line-height:1.5;color:${PALETTE.strong};font-weight:600">${escapeHtml(value)}</td>
      </tr>`)
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">${body}</table>`
}

/** Checklist with coloured ticks — fills the welcome mail with real substance. */
function checklist(items, tone = 'success') {
  const solid = PALETTE[tone] ?? PALETTE.success
  const tint = PALETTE[`${tone}Tint`] ?? PALETTE.successTint
  const rows = items
    .map((text) => `<tr>
        <td width="22" valign="top" style="width:22px;padding:0 0 12px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:18px">
            <tr>
              <td align="center" valign="middle" width="18" height="18" bgcolor="${tint}" style="width:18px;height:18px;border-radius:9px;font-family:${FONT};font-size:11px;line-height:18px;color:${solid};font-weight:700">&#10003;</td>
            </tr>
          </table>
        </td>
        <td style="padding:0 0 12px;font-family:${FONT};font-size:13.5px;line-height:1.55;color:${PALETTE.text}">${text}</td>
      </tr>`)
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">${rows}</table>`
}

function helpLine(contact = 'Reply to this email and a human will pick it up.') {
  return `<p style="margin:0;padding-top:16px;border-top:1px solid ${PALETTE.line};font-family:${FONT};font-size:12.5px;line-height:1.6;color:${PALETTE.dim}">
    ${escapeHtml(contact)}
  </p>`
}

function divider() {
  return `<div style="height:1px;background:${PALETTE.line};margin:22px 0"></div>`
}

// ---- templates -------------------------------------------------------------

function resetPassword({ name, link, minutes = 60 }) {
  const who = name ? `, ${name.split(' ')[0]}` : ''
  const heading = 'Reset your password'
  const text = [
    `Hi${who},`,
    '',
    'Use the link below to choose a new password. It works once and expires in ' + minutes + ' minutes.',
    '',
    link,
    '',
    'If you did not ask for this, ignore this email — nothing changes until the link is used.',
    '',
    `— ${BRAND}`,
  ].join('\n')

  const html = shell({
    preview: `One-time reset link · expires in ${minutes} minutes`,
    eyebrow: 'Security',
    heading,
    footerNote: 'This message was sent because a password reset was requested for an account using this address.',
    body: [
      para(`A reset was requested for the account registered to <strong style="color:${PALETTE.strong}">this address</strong>. Choose a new password below to finish.`),
      button('Choose a new password', link),
      facts([
        ['Link type', 'Single use'],
        ['Expires', `${minutes} minutes from sending`],
        ['On use', 'Every other session is signed out'],
      ]),
      panel('Requesting another link cancels this one. If you did not ask for a reset, ignore this email — your password and existing sessions stay as they are.', 'warn'),
      para('Button not working? Paste this into your browser:', { muted: true }),
      linkBox(link),
      helpLine('Account security questions: security@acocloud.app'),
    ].join(''),
  })
  return { subject: `${heading} · ${BRAND}`, text, html }
}

function welcome({ name, email, link }) {
  const first = name ? name.split(' ')[0] : null
  const heading = first ? `Welcome, ${first}` : 'Welcome to AfterFrame'
  const text = [
    `Hi${first ? ' ' + first : ''},`,
    '',
    `Your ${BRAND} account is ready (${email}).`,
    '',
    'A timeline, an agent and a renderer in one window. Exports are encoded in your browser, so your footage never leaves the device.',
    '',
    `Open the studio: ${link}`,
    '',
    `— ${BRAND}`,
  ].join('\n')

  const html = shell({
    preview: 'Account created — sign-in details and session settings',
    eyebrow: 'Account',
    heading,
    footerNote: 'Keep this email: it records the address your account is tied to.',
    body: [
      para(`The account is registered to <strong style="color:${PALETTE.strong}">${escapeHtml(email)}</strong>. That address is the only one that can sign in and the only one that receives password resets.`),
      facts([
        ['Sign-in', 'This email + password'],
        ['Sessions', 'Up to 30 days per browser, ended by signing out'],
        ['Password storage', 'PBKDF2-SHA256, 100,000 iterations'],
        ['Email we send', 'Sign-in and security notices only'],
      ]),
      button('Open the studio', link),
      panel('No tracking pixels and no marketing mail are attached to this account. If you ever need the account removed, reply to this message.', 'accent'),
      helpLine('Questions about the account: support@acocloud.app'),
    ].join(''),
  })
  return { subject: `Welcome to ${BRAND}`, text, html }
}

function passwordChanged({ name, when, ip }) {
  const who = name ? `, ${name.split(' ')[0]}` : ''
  const heading = 'Your password was changed'
  const rows = [`When: ${when}`, ip ? `From: ${ip}` : null].filter(Boolean)
  const text = [
    `Hi${who},`,
    '',
    'The password on your AfterFrame account was just changed, and every other session was signed out.',
    ...rows,
    '',
    'If this was you, nothing to do. If it was not, reset the password again immediately and check the address.',
    '',
    `— ${BRAND}`,
  ].join('\n')

  const html = shell({
    preview: 'Password changed — all other sessions signed out',
    eyebrow: 'Security',
    heading,
    footerNote: 'Security notices are sent for every password change and cannot be turned off.',
    body: [
      para('The password on this account was changed, and <strong style="color:' + PALETTE.strong + '">every other session was signed out</strong> — a changed password should not leave old sessions alive.'),
      facts([['When', when], ...(ip ? [['Request from', ip]] : []), ['Sessions ended', 'All except the one that made the change']]),
      panel('If this was you, nothing to do. If it was not, reset the password again now and reply to this message so the account can be reviewed.', 'danger'),
      helpLine('Report unauthorised access: security@acocloud.app'),
    ].join(''),
  })
  return { subject: `Security notice · password changed · ${BRAND}`, text, html }
}

const TEMPLATES = {
  'reset-password': resetPassword,
  welcome,
  'password-changed': passwordChanged,
}

/** Render one template by name. Unknown names are a programming error, not user input. */
export function renderTemplate(name, data = {}) {
  const template = TEMPLATES[name]
  if (!template) throw new Error(`unknown email template: ${name}`)
  return template(data)
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES)
