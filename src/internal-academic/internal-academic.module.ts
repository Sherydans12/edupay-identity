import { Module } from '@nestjs/common';
import { InternalAcademicController } from './internal-academic.controller.js';
import { InternalAcademicService } from './internal-academic.service.js';
import {
  InternalServiceAuthenticator,
  InternalServiceAuthGuard,
} from './internal-service-auth.guard.js';

@Module({
  controllers: [InternalAcademicController],
  providers: [
    InternalAcademicService,
    InternalServiceAuthenticator,
    InternalServiceAuthGuard,
  ],
})
export class InternalAcademicModule {}
