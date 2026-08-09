export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailDeliveryResult {
  providerResponseId: string;
}

export abstract class EmailDeliveryAdapter {
  abstract send(message: EmailMessage, deliveryKey: string): Promise<EmailDeliveryResult>;
}

export class EmailDeliveryError extends Error {
  constructor(readonly safeCode: string, readonly retryable = true) {
    super(safeCode);
  }
}
