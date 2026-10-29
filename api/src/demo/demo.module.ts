import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../config.js';
import { MuseSpark, type JsonModel } from '../records/muse.js';
import { DemoController, DemoHealthController, DEMO_MODEL } from './demo.controller.js';

@Module({})
export class DemoModule {
  static forRoot(config: Pick<AppConfig, 'models'>, model?: JsonModel | null): DynamicModule {
    return { module: DemoModule, controllers: [DemoController, DemoHealthController], providers: [
      { provide: DEMO_MODEL, useValue: model !== undefined ? model : config.models.length ? new MuseSpark(config.models) : null },
    ] };
  }
}
