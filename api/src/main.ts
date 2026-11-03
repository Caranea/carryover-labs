import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { BatchesModule } from './batches/batches.module.js';
import { loadConfig } from './config.js';
import { securityHeaders } from './security/http-security.js';
import { isAppPage } from './web-routes.js';

async function bootstrap() {
  const config = loadConfig();
  const log = new Logger('Carryover');

  const app = await NestFactory.create<NestExpressApplication>(BatchesModule.forRoot(config), {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '21mb' });
  app.disable('x-powered-by');
  if (config.trustLoopbackProxy) app.set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  app.use(securityHeaders);

  // In production, serve the built Angular app from the same origin.
  const hasWebApp = existsSync(join(config.webRoot, 'index.html'));
  if (hasWebApp) {
    app.useStaticAssets(config.webRoot, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || !isAppPage(req.path)) return next();
      res.sendFile(join(config.webRoot, 'index.html'));
    });
  }

  await app.listen(config.port, config.listenHost);
  if (hasWebApp) {
    log.log(`App and API are running: open ${config.appUrl}`);
  } else {
    log.warn(
      `API only, on ${config.appUrl}: no built app in ${config.webRoot}. Run "npm run build".`,
    );
  }
}

void bootstrap();
