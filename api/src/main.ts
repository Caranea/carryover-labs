import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DemoModule } from './demo/demo.module.js';
import { loadConfig } from './config.js';
import { requestLimits, securityHeaders } from './security/http-security.js';

async function bootstrap() {
  const config = loadConfig();
  const log = new Logger('Carryover');

  const app = await NestFactory.create<NestExpressApplication>(DemoModule.forRoot(config), {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '21mb' });
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
