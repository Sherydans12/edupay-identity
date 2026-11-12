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

export interface SafeProviderDiagnostic {
  code?: string;
  message?: string;
}

export class EmailDeliveryError extends Error {
  constructor(
    readonly safeCode: string,
    readonly retryable = true,
    readonly providerDiagnostic?: SafeProviderDiagnostic,
  ) {
    super(safeCode);
  }

  get safeSummary(): string {
    const detail = [this.providerDiagnostic?.code, this.providerDiagnostic?.message]
      .filter((value): value is string => Boolean(value))
      .join(': ');
    return detail ? `${this.safeCode}[${detail}]`.slice(0, 512) : this.safeCode;
  }
}
