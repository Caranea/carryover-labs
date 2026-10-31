import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../config.js';
import { MuseSpark, type JsonModel } from '../records/muse.js';
import { DemoController, DemoHealthController, DEMO_MODEL } from './demo.controller.js';

@Module({})
export class DemoModule {
  static forRoot(config: Pick<AppConfig, 'models'>, model?: JsonModel | null): DynamicModule {
    const endpoints = config.models.filter(endpoint => endpoint.model === 'muse-spark-1.3');
    return { module: DemoModule, controllers: [DemoController, DemoHealthController], providers: [
      { provide: DEMO_MODEL, useValue: model !== undefined ? model : endpoints.length ? new MuseSpark(endpoints) : null },
    ] };
  }
}
