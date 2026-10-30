// Local performance investigation. Writes counts/times, never recognized text.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { build } from 'esbuild';
import { createWorker } from 'tesseract.js';
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'artifacts/timing-investigation');
await mkdir(out, { recursive: true });
const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');
await build({ entryPoints: [join(root, 'src/app/extraction/ocr-layout.ts')], outfile: join(out, 'ocr-layout.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { readsWell, readingScore } = await import(pathToFileURL(join(out, 'ocr-layout.mjs')).href);
const started = performance.now();
const worker = await createWorker('pol+deu+eng', 1, { langPath: join(root, 'artifacts/benchmark/tessdata'), cacheMethod: 'none', gzip: true });
const setupMs = performance.now() - started;
const osdStarted = performance.now();
const orientation = await createWorker('osd', 0, { langPath: join(root, 'public/vendor/tessdata'), cacheMethod: 'none', gzip: true });
const osdSetupMs = performance.now() - osdStarted;
const report = { cpu: cpus()[0].model, runtime: 'Node Tesseract 7, same languages and quality rules, Sharp canvas equivalent', setupMs, osdSetupMs, files: [] };
const record = async () => writeFile(join(out, 'ocr-profile.json'), JSON.stringify(report, null, 2));
try {
  for (const [index, file] of process.argv.slice(2).entries()) {
    const decodeAt = performance.now();
    const input = await sharp(file).rotate().resize({ width:2600, height:2600, fit:'inside', withoutEnlargement:true }).png().toBuffer();
    const size = await sharp(input).metadata();
    const row = { fixture: index + 1, width:size.width, height:size.height, decodeMs:performance.now()-decodeAt, passes:[] };
    report.files.push(row);
    const osdAt = performance.now();
    const detected = (await orientation.detect(input)).data;
    row.orientation = { milliseconds:performance.now()-osdAt, degrees:detected.orientation_degrees, confidence:detected.orientation_confidence };
    console.log(JSON.stringify({fixture:row.fixture,orientation:row.orientation}));
    const recognize = async (image, stage) => {
      const at = performance.now();
      const { data } = await worker.recognize(image, {}, { blocks:true, text:false });
      const entry = { stage, milliseconds:performance.now()-at, confidence:data.confidence, score:readingScore(data), readsWell:readsWell(data) };
      row.passes.push(entry); console.log(JSON.stringify({fixture:row.fixture,...entry})); await record();
      return data;
    };
    // Reproduce the live app, whose OSD engine request currently returns 404.
    const first = await recognize(input, 'live-first-without-osd');
    if (!readsWell(first)) {
      const small = await sharp(input).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer();
      const scores = [];
      for(const turn of [0,1,2,3]) scores.push(readingScore(await recognize(await sharp(small).rotate(turn*90).png().toBuffer(), 'live-orientation-'+turn)));
      const best = scores.indexOf(Math.max(...scores));
      row.fallbackTurns = best !== 0 && scores[best] >= scores[0]*1.3+5 ? best : 0;
      if(row.fallbackTurns) await recognize(await sharp(input).rotate(row.fallbackTurns*90).png().toBuffer(), 'live-corrected-full-size');
    }
    row.liveOcrMs = row.passes.reduce((sum,p)=>sum+p.milliseconds,0);
    if(detected.orientation_confidence >= 10 && [0,90,180,270].includes(detected.orientation_degrees)) {
      const upright = await sharp(input).rotate(detected.orientation_degrees).png().toBuffer();
      await recognize(upright, 'with-working-orientation');
      row.withOrientationMs = row.orientation.milliseconds + row.passes.at(-1).milliseconds;
    }
    await record();
    console.log(JSON.stringify({fixture:row.fixture,liveOcrMs:row.liveOcrMs,withOrientationMs:row.withOrientationMs}));
  }
} finally { await worker.terminate(); await orientation.terminate(); await record(); }
