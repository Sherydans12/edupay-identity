import { Injectable } from '@nestjs/common';

@Injectable()
export class IdentifierNormalizationService {
  normalizeUsername(value: string): string {
    return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  }

  normalizeEmail(value: string): string {
    return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
  }

  normalizeTenantHandle(value: string): string {
    return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  }

  isEmail(value: string): boolean {
    const trimmed = value.trim();
    const separator = trimmed.indexOf('@');
    return separator > 0 && separator < trimmed.length - 1;
  }
}
