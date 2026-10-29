import { DynamicModule, Module } from '@nestjs/common';
import { ClerkAuthGuard, clerkVerifier, TOKEN_VERIFIER, type TokenVerifier } from './auth/clerk-auth.guard.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { DocumentsController } from './documents/documents.controller.js';
import { STORAGE } from './documents/storage.token.js';
import { DocumentStorage } from './documents/storage.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { KnowledgeStore } from './records/knowledge.js';
import { MuseSpark, type JsonModel } from './records/muse.js';
import { RECORDS, RecordsController } from './records/records.controller.js';
import { RecordsService } from './records/records.service.js';
import { ResultsController } from './results/results.controller.js';
import { SystemController } from './system/system.controller.js';
import { RECOVERY, RecoveryController } from './recovery/recovery.controller.js';
import { RecoveryService } from './recovery/recovery.service.js';

@Module({})
export class AppModule {
  /** `model` replaces Muse Spark in tests; by default it is built from the configured keys. */
  static forRoot(config: AppConfig, verifier?: TokenVerifier, model?: JsonModel | null): DynamicModule {
    const storage = new DocumentStorage(config.storageDir, config.storageEncryptionKey);
    const muse = model !== undefined ? model : config.models.length ? new MuseSpark(config.models) : null;
    const knowledgeFor = (userId: string) => {
      const owner = createHash('sha256').update(userId).digest('hex').slice(0, 40);
      return new KnowledgeStore(join(config.storageDir, owner, '_knowledge'), config.storageEncryptionKey, `${owner}/knowledge`);
    };
    const records = new RecordsService(storage, knowledgeFor, muse);
    const recovery = new RecoveryService(storage, muse);
    return {
      module: AppModule,
      controllers: [SystemController, DocumentsController, ResultsController, RecordsController, RecoveryController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: TOKEN_VERIFIER, useValue: verifier ?? clerkVerifier(config) },
        { provide: STORAGE, useValue: storage },
        { provide: RECORDS, useValue: records },
        { provide: RECOVERY, useValue: recovery },
        ClerkAuthGuard,
      ],
    };
  }
}
