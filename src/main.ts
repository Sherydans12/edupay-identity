import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import type { Environment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApplication(app);

  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.getOrThrow('PORT'));
}

void bootstrap();
