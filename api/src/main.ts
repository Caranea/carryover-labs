import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { requestLimits, securityHeaders } from './security/http-security.js';

async function bootstrap() {
  const config = loadConfig();
  const log = new Logger('Carryover');
  if (!config.clerkSecretKey || !config.clerkPublishableKey) {
    log.warn('CLERK_SECRET_KEY or CLERK_PUBLISHABLE_KEY is missing. Copy api/.env.example to api/.env.');
  }
  if (!config.storageEncryptionKey) log.warn('Development storage is plaintext. Set STORAGE_ENCRYPTION_KEY before storing personal records. Existing files need explicit migration.');

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: ['error', 'warn', 'log'],
  });
  app.disable('x-powered-by');
  if (config.trustLoopbackProxy) app.set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  app.use(securityHeaders);
  app.use(requestLimits());

  // In production, serve the built Angular app from the same origin.
  if (existsSync(join(config.webRoot, 'index.html'))) {
    app.useStaticAssets(config.webRoot, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(join(config.webRoot, 'index.html'));
    });
  }

  await app.listen(config.port, config.listenHost);
  log.log(`API listening on ${config.listenHost}:${config.port}`);
}

void bootstrap();
