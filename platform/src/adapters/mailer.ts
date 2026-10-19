import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send(mail: Mail): Promise<void> };

/** Development: prints mails to the log (sign-in codes appear there). */
export const consoleMailer: Mailer = {
  async send(mail) {
    console.log(`--- mail to ${mail.to}: ${mail.subject}\n${mail.text}\n---`);
  },
};

/** Tests: keeps the mails. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { sent, send: async (mail) => void sent.push(mail) };
}

/** SMTP (MAIL_URL=smtps://user:pass@host:465). Use a provider with EU processing (spec §8). */
export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}
