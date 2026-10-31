import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../config.js';
import { MetaModelClient, type JsonModel } from '../records/meta-model.js';
import { DEMO_MODEL, DemoController, HealthController } from './demo.controller.js';

@Module({})
export class DemoModule {
  /** Pass `model` to replace the Meta client in tests; `null` disables inference. */
  static forRoot(config: Pick<AppConfig, 'model'>, model?: JsonModel | null): DynamicModule {
    const client =
      model !== undefined ? model : config.model ? new MetaModelClient(config.model) : null;
    return {
      module: DemoModule,
      controllers: [DemoController, HealthController],
      providers: [{ provide: DEMO_MODEL, useValue: client }],
    };
  }
}
