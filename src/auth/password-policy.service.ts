import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { SafeHttpException } from '../common/safe-http.exception.js';

@Injectable()
export class PasswordPolicyService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  assertAcceptable(password: string): void {
    const minimum = this.config.getOrThrow('PASSWORD_MIN_LENGTH');
    const hasControlCharacter = [...password].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });
    if (password.length < minimum || password.length > 1_024 || hasControlCharacter) {
      throw new SafeHttpException(
        400,
        'PASSWORD_POLICY_FAILED',
        `The password must be between ${minimum} and 1024 characters and cannot contain control characters.`,
      );
    }
  }
}
