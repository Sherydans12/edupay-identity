import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RequestIdMiddleware } from './common/request-id.js';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';
import { validateEnvironment } from './config/environment.js';
import { HealthModule } from './health/health.module.js';
import { JwtModule } from './jwt/jwt.module.js';
import { PersistenceModule } from './persistence/persistence.module.js';
import { SecurityModule } from './security/security.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PersistenceModule,
    SecurityModule,
    JwtModule,
    HealthModule,
  ],
  providers: [GlobalExceptionFilter, RequestIdMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
