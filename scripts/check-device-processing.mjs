// Local browser verification using the actual production worker and OCR service.
// All input text and images are synthetic. No patient documents are used.
import { build } from 'esbuild';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'artifacts/device-processing');
await mkdir(out, { recursive: true });
await build({ entryPoints: [join(root, 'src/app/pii/ner.worker.ts')], outfile: join(out, 'ner.worker.js'), bundle: true, platform: 'browser', format: 'esm' });
await writeFile(join(out, 'page.ts'), `
import '@angular/compiler';
import { OcrService } from '../../src/app/extraction/ocr.service';
import { selectDetectorVariant } from '../../src/app/pii/model-selection';
const report = document.querySelector('pre');
const log = text => { report.textContent += text + '\\n'; };
const save = (name, data) => fetch('/report/' + name, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data,null,2) });
document.querySelector('#clear').onclick = async () => {
 const cache = await caches.open('transformers-cache');
 await cache.delete(location.origin+'/models/pii-fp16/onnx/model_fp16.onnx');
 log('Synthetic GPU export cache cleared');
};
document.querySelector('#probe').onclick = async () => {
 const adapter = await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
 log(JSON.stringify({webgpu:!!navigator.gpu,adapter:!!adapter,info:adapter?.info, f16:adapter?.features.has('shader-f16'),maxBuffer:adapter?.limits.maxBufferSize,maxBinding:adapter?.limits.maxStorageBufferBindingSize,selected:await selectDetectorVariant(navigator)}));
};
const runModel = (forceCpu = false) => {
 const worker = new Worker('/ner.worker.js', { type:'module' });
 const rows = ['Patient Jan Kowalski. Email jan.kowalski@example.com. Telefon +48 500 111 222.', 'Patientin Anna Beispiel, geboren 12.03.1980. Anschrift Musterstrasse 12, Berlin.', 'Patient Alex Example, date of birth 01/02/1975. Address 17 Example Road, London.'];
 const labs = ['Glucose 92 mg/dL reference range 70 to 99.', 'Haemoglobin 13.8 g/dL reference range 12 to 16.'];
 const lines = [...rows, ...Array.from({length:46},(_,i)=>labs[i%2])].map(x=>x.split(/\\s+/));
 const events = []; let started = 0, variant = null, percent = -1;
 worker.onerror = e => log('WORKER ERROR ' + e.message);
 worker.onmessage = async ({data}) => {
  if(data.type === 'backend') variant = data.variant;
  if(data.type !== 'progress' || Math.floor(data.fraction*10) !== percent) log(JSON.stringify(data.type === 'result' ? {type:data.type,words:data.predictions.length,milliseconds:performance.now()-started,labels:data.predictions.filter(x=>x[0]!=='O').slice(0,30)} : data));
  if(data.type === 'progress') percent = Math.floor(data.fraction*10); else events.push(data);
  if(data.type === 'ready') { started = performance.now(); worker.postMessage({type:'predict',id:1,lines}); }
  if(data.type === 'result') { const result={variant,milliseconds:performance.now()-started,lines,predictions:data.predictions,events}; await save('model', result); await save('model-'+variant,result); worker.terminate(); }
  if(data.type === 'load-error' || data.type === 'predict-error') { await save('error', {data,events}); worker.terminate(); }
 };
 worker.postMessage({type:'load',modelId:'bardsai/eu-pii-anonimization-multilang',wasmBase:location.origin+'/vendor/ort/',gpuModelBase:location.origin+'/models/pii-fp16-62ca5712-v1/',forceCpu});
};
document.querySelector('#model').onclick = () => runModel();
document.querySelector('#cpu').onclick = () => runModel(true);
document.querySelector('#rotation').onclick = async () => {
 const ocr = new OcrService(); const results = [];
 try { for (const variant of ['clean','blurred']) {
  const response = await fetch('/fixture/'+variant); const bitmap = await createImageBitmap(await response.blob());
  for (const angle of [0,90,180,270]) {
   const canvas = document.createElement('canvas'); const swap = angle%180!==0;
   canvas.width=swap?bitmap.height:bitmap.width; canvas.height=swap?bitmap.width:bitmap.height;
   const ctx=canvas.getContext('2d'); ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2);
   const started = performance.now(); const output=await ocr.recognizePage(canvas,0);
   const row={variant,angle,milliseconds:performance.now()-started,width:output.canvas.width,height:output.canvas.height,words:output.words.length,sample:output.words.slice(0,10).map(w=>w.text)};
   results.push(row);log(JSON.stringify(row));await save('rotation',results);
  } bitmap.close();
 }} finally {await ocr.terminate();} log('ROTATION COMPLETE');
};
`);
await build({ entryPoints: [join(out, 'page.ts')], outfile: join(out, 'page.js'), bundle: true, platform: 'browser', format: 'esm', tsconfig: join(root, 'tsconfig.app.json') });
await writeFile(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Device processing verification</title><h1>Synthetic device checks</h1><button id="probe">Check GPU</button> <button id="model">Run selected privacy model</button> <button id="cpu">Run CPU comparison</button> <button id="rotation">Check rotation before OCR</button> <button id="clear">Clear synthetic GPU cache</button><pre style="white-space:pre-wrap"></pre><script type="module" src="/page.js"></script>');
const types = { '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.html':'text/html', '.wasm':'application/wasm', '.png':'image/png', '.jpg':'image/jpeg' };
createServer(async (req,res) => {
 try {
  const path = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(req.method==='POST' && /^\/report\/(model|model-gpu-fp16|model-cpu-q8|error|rotation)$/.test(path)) {
   const chunks=[]; for await(const chunk of req) chunks.push(chunk);
   await writeFile(join(out,path.split('/').at(-1)+'.json'), Buffer.concat(chunks)); res.end('ok'); return;
  }
  const routes = [
   ['/models/',join(root,'public/models')], ['/vendor/ort/',join(root,'node_modules/onnxruntime-web/dist')],
   ['/vendor/tesseract-core/',join(root,'node_modules/tesseract.js-core')], ['/vendor/tesseract/',join(root,'node_modules/tesseract.js/dist')],
  ];
  let file = path==='/' ? join(out,'index.html') : join(out,path.slice(1));
  for(const [prefix,dir] of routes) if(path.startsWith(prefix)) file=join(dir,path.slice(prefix.length));
  if(path.startsWith('/vendor/tessdata/')) {
   const name=path.split('/').at(-1); const lang=name.split('.')[0];
   file=lang==='osd'?join(root,'public/vendor/tessdata',name):join(root,'node_modules/@tesseract.js-data',lang,'4.0.0_best_int',name);
  }
  if(path==='/fixture/clean') file=join(root,'artifacts/gpu-research/ocr-clean.png');
  if(path==='/fixture/blurred') file=join(root,'artifacts/gpu-research/ocr-blurred.jpg');
  if(!resolve(file).startsWith(root + '\\')) {res.writeHead(403);res.end();return;}
  const s=await stat(file); res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':s.size}); createReadStream(file).pipe(res);
 } catch {res.writeHead(404);res.end();}
}).listen(4291,'127.0.0.1',()=>console.log('Synthetic verification: http://localhost:4291'));
