import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';

@Controller()
export class SystemController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Public values the browser needs. Never put secrets here. */
  @Get('config')
  publicConfig() {
    return {
      clerkPublishableKey: this.config.clerkPublishableKey,
      storageProtection: this.config.storageEncryptionKey ? 'encrypted-new-files' : 'development-plaintext',
    };
  }

  @Get('health')
  health() {
    return { ok: true };
  }
}
