import { AppError } from '../../shared/errors';
export interface ResetMailer {
  send(to: string, url: string, id: string): Promise<void>;
}
export class ResendResetMailer implements ResetMailer {
  constructor(
    private readonly key: string,
    private readonly from: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async send(to: string, url: string, id: string) {
    const response = await this.transport('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `password-reset-${id}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject: 'Reset your E-com Global password',
        text: `You requested a password reset for E-com Global.\n\nOpen this link to choose a new password. It expires in 30 minutes and can be used once:\n${url}\n\nIf you did not request this, ignore this email. Your password has not changed. E-com Global will never ask you to send your password or this link to anyone.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new AppError(
        503,
        'EMAIL_DELIVERY_FAILED',
        'Email provider unavailable',
      );
  }
}
