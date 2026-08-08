import type { INestApplication } from '@nestjs/common';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/global-exception.filter.js';

export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.setGlobalPrefix('api', {
    exclude: [{ path: '.well-known/jwks.json', method: RequestMethod.GET }],
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
