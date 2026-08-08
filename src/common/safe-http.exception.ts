import { HttpException } from '@nestjs/common';

export interface SafeErrorBody {
  code: string;
  message: string;
  details: ReadonlyArray<unknown>;
}

export class SafeHttpException extends HttpException {
  readonly safeError: SafeErrorBody;

  constructor(status: number, code: string, message: string, details: ReadonlyArray<unknown> = []) {
    super(message, status);
    this.safeError = { code, message, details };
  }
}
