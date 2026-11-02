import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { loadConfig } from '../config.js';
import { validateAnswer } from '../records/meta-model.js';
import { identificationTask, normalizeBatch, type SourceDocument } from './normalization.js';
import { SAMPLE_KEY, SampleAnswers, type SampleRecording } from './samples.js';
import { extractionTask, processPage } from './source-processing.js';

const file = loadConfig({}).samplesFile;
const recorded = existsSync(file);

describe(
  'recorded sample patient',
  { skip: !recorded && 'api/samples/recorded.json not recorded yet' },
  () => {
    const recording = recorded ? (JSON.parse(readFileSync(file, 'utf8')) as SampleRecording) : null;

    it('holds Meta answers in the formats the server accepts from Meta', () => {
      const spark = extractionTask('');
      for (const [key, page] of Object.entries(recording!.pages)) {
        assert.match(key, SAMPLE_KEY);
        validateAnswer(spark, page);
      }
      const item = (
        identificationTask([], []).schema as {
          properties: {
            tests: { items: { properties: Record<string, unknown>; required: string[] } };
          };
        }
      ).properties.tests.items;
      const { ref: _ref, ...properties } = item.properties;
      const identity = {
        type: 'object',
        additionalProperties: false,
        required: item.required.filter((name) => name !== 'ref'),
        properties,
      };
      for (const answer of Object.values(recording!.identities))
        validateAnswer({ schema: identity }, answer);
    });

    it('charts every sample document, alone or all together, without a model', async () => {
      const answers = new SampleAnswers(recording);
      const png = await sharp({
        create: { width: 1100, height: 1559, channels: 3, background: '#fff' },
      })
        .png()
        .toBuffer();
      const image = `data:image/png;base64,${png.toString('base64')}`;
      const documents = new Map<string, SourceDocument>();
      for (const sample of Object.keys(recording!.pages)) {
        const [id, index] = sample.split(':');
        const page = await processPage(
          {
            batchId: 'test',
            documentId: id,
            pageId: `${id}:${index}`,
            page: Number(index),
            revision: 'r',
            image,
            sample,
          },
          answers.page(sample),
        );
        const doc = documents.get(id) ?? { id, name: id, observations: [], dates: [] };
        doc.observations.push(...page.observations);
        doc.dates!.push(...page.dates);
        documents.set(id, doc);
      }
      const all = [...documents.values()];
      const together = await normalizeBatch(all, null, undefined, { cache: answers });
      assert.ok(together.stats.values > 0);
      for (const doc of all) await normalizeBatch([doc], null, undefined, { cache: answers });
    });
  },
);
