import type { INestApplication } from '@nestjs/common';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';
import type { Environment } from './config/environment.js';
import { normalizeWebOrigin } from './security/browser-session.policy.js';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  const trustedOrigins = new Set(config.getOrThrow('IDENTITY_TRUSTED_WEB_ORIGINS'));

  app.use(helmet());
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, origin?: boolean | string) => void,
    ) => {
      if (!origin) {
        callback(null, false);
        return;
      }
      const normalizedOrigin = normalizeWebOrigin(origin);
      callback(null, normalizedOrigin && trustedOrigins.has(normalizedOrigin) ? origin : false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '.well-known/jwks.json', method: RequestMethod.GET },
      { path: 'internal/v1/sessions/:sessionId/status', method: RequestMethod.GET },
      { path: 'internal/v1/identity-users/resolve', method: RequestMethod.POST },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(app.get(GlobalExceptionFilter));

  const openApiConfig = new DocumentBuilder()
    .setTitle('EduPay Identity API')
    .setDescription('Independent authentication and tenant-membership service')
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApiConfig));
}
