// Paste into the development app's DevTools console while Documents is open.
// Observes the real queue. No file/text/image contents are logged or transmitted.
// No reload needed; the already-running file is excluded from complete samples.
(() => {
  if (window.carryoverProfile) return 'Timing probes are already installed.';
  const q = ng.getComponent(document.querySelector('app-upload'))?.queue;
  if (!q) throw new Error('Open Documents in the development app first.');
  const ex = q.extraction, ocr = ex.ocr, ner = q.ner;
  const rows = [], saves = [], undo = [];
  let active = null;
  const now = () => performance.now();
  const round = value => Math.round(value * 1000) / 1000;
  const sum = (row, key) => row.events.filter(e => e.stage === key).reduce((n, e) => n + e.seconds, 0);
  function wrap(object, key, stage, details) {
    const original = object[key];
    if (typeof original !== 'function') throw new Error('Missing timing target: ' + key);
    object[key] = async function (...args) {
      const row = active;
      const event = { stage, seconds: 0, ...(details?.(args) ?? {}) };
      const started = now();
      if (row) row.pending.push(event);
      try {
        const result = await original.apply(this, args);
        if (stage === 'ocrPass') event.confidence = result.confidence;
        if (stage === 'orientation') event.turns = result?.turns ?? null;
        return result;
      } finally {
        event.seconds = (now() - started) / 1000;
        if (row) { row.pending.splice(row.pending.indexOf(event), 1); row.events.push(event); }
      }
    };
    undo.push(() => { object[key] = original; });
  }
  wrap(ex, 'extract', 'readingTotal');
  wrap(ex.io, 'loadImage', 'decodeResize');
  wrap(ex.io, 'canvasToBlob', 'previewEncoding');
  wrap(ocr, 'getWorker', 'ocrSetup');
  wrap(ocr, 'recognize', 'ocrPass', args => ({
    pass: args[1] ? 'full' : 'rotation probe', width: args[0].width, height: args[0].height,
  }));
  wrap(ner, 'predict', 'privacyTotal');
  wrap(ner, 'load', 'privacySetup');
  wrap(ner, 'request', 'privacyInference');
  const drain = q.recovery.drain;
  q.recovery.drain = async function (...args) {
    const started = now();
    try { return await drain.apply(this, args); }
    finally { saves.push((now() - started) / 1000); }
  };
  undo.push(() => { q.recovery.drain = drain; });
  const process = q.process;
  q.process = async function (doc) {
    const row = { file: doc.localId, reusedOcr: !!doc.pages.length, mode: doc.privacyMode,
      started: now(), events: [], pending: [] };
    active = row;
    console.info('[Carryover timing] Started', row.file);
    try { return await process.call(this, doc); }
    finally {
      row.total = (now() - row.started) / 1000;
      const finished = this.documents().find(d => d.localId === doc.localId);
      row.status = finished?.status ?? 'removed';
      row.pages = finished?.pages.length ?? 0;
      row.words = finished?.pages.reduce((n, p) => n + p.words.length, 0) ?? 0;
      row.backend = ner.variant();
      row.privacyCheck = finished?.privacyCheck;
      rows.push(row);
      if (active === row) active = null;
      console.groupCollapsed('[Carryover timing] ' + row.file + ' — ' + round(row.total) + ' s');
      console.table([summary(row)]);
      console.table(row.events.filter(e => e.stage === 'ocrPass').map(e => ({ ...e, seconds: round(e.seconds) })));
      console.groupEnd();
      report();
    }
  };
  undo.push(() => { q.process = process; });
  function summary(row) {
    const read = sum(row, 'readingTotal'), privacy = sum(row, 'privacyTotal');
    const stages = {
      decodeResize: sum(row, 'decodeResize'), orientation: sum(row, 'orientation'),
      ocrSetup: sum(row, 'ocrSetup'), ocr: sum(row, 'ocrPass') - sum(row, 'ocrSetup'),
      previewEncoding: sum(row, 'previewEncoding'),
      readingOther: read - sum(row, 'decodeResize') - sum(row, 'orientation') - sum(row, 'ocrPass') - sum(row, 'previewEncoding'),
      privacySetup: sum(row, 'privacySetup'), privacyInference: sum(row, 'privacyInference'),
      privacyOther: privacy - sum(row, 'privacySetup') - sum(row, 'privacyInference'),
      rulesAndReview: row.total - read - privacy, total: row.total,
    };
    return { file: row.file, status: row.status, backend: row.backend, pages: row.pages, words: row.words,
      reusedOcr: row.reusedOcr, privacyCheck: row.privacyCheck,
      ocrPasses: row.events.filter(e => e.stage === 'ocrPass').length,
      ...Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, round(v)])) };
  }
  function report() {
    const complete = rows.filter(r => r.status === 'review' && !r.reusedOcr);
    const summaries = complete.map(summary);
    const numeric = ['decodeResize', 'orientation', 'ocrSetup', 'ocr', 'previewEncoding', 'readingOther',
      'privacySetup', 'privacyInference', 'privacyOther', 'rulesAndReview', 'total', 'ocrPasses'];
    const average = Object.fromEntries(numeric.map(key => [key,
      summaries.length ? round(summaries.reduce((n, r) => n + r[key], 0) / summaries.length) : null]));
    console.info('[Carryover timing] Averages in seconds (' + complete.length + ' complete files; queued wait/review excluded)');
    console.table([average]);
    return { files: rows.map(summary), average, completeFiles: complete.length,
      backgroundSave: { count: saves.length, average: saves.length ? round(saves.reduce((a, b) => a + b, 0) / saves.length) : null,
        max: saves.length ? round(Math.max(...saves)) : null, overlapsProcessing: true },
      current: active ? { file: active.file, elapsed: round((now() - active.started) / 1000),
        stages: active.pending.map(e => e.stage) } : null,
    };
  }
  window.carryoverProfile = { rows, saves, report, stop() { undo.reverse().forEach(fn => fn()); } };
  return 'Per-file timing installed. Read averages with carryoverProfile.report(). Timings stay in this tab.';
})()
