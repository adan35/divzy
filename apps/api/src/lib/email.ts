import nodemailer, { type Transporter } from 'nodemailer';
import { pino } from 'pino';
import { env } from '../config/env';

const log = pino({ name: 'email', level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
    });
  }
  return transporter;
}

/**
 * Send an email. No-op when SMTP is not configured. Failures are logged and
 * swallowed — email must never break or delay an API response.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;
  try {
    await transport.sendMail({ from: env.SMTP_FROM, to, subject, html });
  } catch (err) {
    log.error({ err, to, subject }, 'Failed to send email');
  }
}
