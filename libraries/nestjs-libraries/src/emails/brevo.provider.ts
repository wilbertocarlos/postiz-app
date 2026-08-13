import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';

export class BrevoProvider implements EmailInterface {
  name = 'brevo';
  validateEnvKeys = ['BREVO_API_KEY'];

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    emailFromName: string,
    emailFromAddress: string,
    replyTo?: string
  ) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY!,
      },
      body: JSON.stringify({
        sender: {
          name: emailFromName,
          email: emailFromAddress,
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Brevo email request failed (${response.status}): ${await response.text()}`
      );
    }

    return response.json();
  }
}
