import nodemailer from 'nodemailer';

export function consoleMailer() {
  return {
    async send({ to, subject, text }) {
      console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
    },
  };
}

export function createMailer(config) {
  const credentials = [config.smtpHost, config.smtpUser, config.smtpPass];
  const supplied = credentials.filter(Boolean).length;
  if (supplied > 0 && supplied < credentials.length) {
    throw new Error('Configure SMTP_HOST, SMTP_USER and SMTP_PASS together');
  }
  if (supplied === 0) {
    if (config.env === 'production') {
      throw new Error('Configure SMTP_HOST, SMTP_USER and SMTP_PASS to send email in production');
    }
    return consoleMailer();
  }

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: config.smtpFrom, to, subject, text });
    },
  };
}
