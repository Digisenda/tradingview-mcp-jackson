import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.FROM_EMAIL ?? "admin@digisendaai.com";
const ADMIN = process.env.ADMIN_EMAIL ?? "admin@digisendaai.com";

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  cc?: string[];
}

export async function sendEmail({ to, subject, html, cc }: SendEmailOptions) {
  const result = await resend.emails.send({
    from: `DigiSenda AI <${FROM}>`,
    to: Array.isArray(to) ? to : [to],
    cc: cc ?? [ADMIN],
    subject,
    html,
  });

  if (result.error) {
    throw new Error(`Email send failed: ${result.error.message}`);
  }

  return result.data;
}
