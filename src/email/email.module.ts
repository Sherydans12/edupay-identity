import { Module } from '@nestjs/common';
import { EmailOutboxService } from './email-outbox.service.js';
import { EmailDeliveryAdapter } from './email.types.js';
import { ResendEmailAdapter } from './resend.email.adapter.js';

@Module({
  providers: [
    EmailOutboxService,
    ResendEmailAdapter,
    { provide: EmailDeliveryAdapter, useExisting: ResendEmailAdapter },
  ],
  exports: [EmailOutboxService],
})
export class EmailModule {}
