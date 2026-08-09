import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { EmailOutboxService } from './email-outbox.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
try {
  const result = await app.get(EmailOutboxService).deliverPending();
  console.log(`Identity email outbox run complete: published=${result.published} failed=${result.failed}`);
} finally {
  await app.close();
}
