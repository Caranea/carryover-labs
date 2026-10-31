// Synthetic browser checks using the production OCR, privacy rules/worker and pixel burn functions.
import { build } from 'esbuild';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = join(root, 'artifacts/pipeline-verification');
await mkdir(out, { recursive: true });
await build({ entryPoints: [join(root, 'src/app/pii/ner.worker.ts')], outfile: join(out, 'ner.worker.js'), bundle: true, platform: 'browser', format: 'esm' });
await writeFile(join(out, 'privacy.ts'), `
import '@angular/compiler';
import { OcrService } from '../../src/app/extraction/ocr.service';
import { applyDetections, NORMAL } from '../../src/app/pii/detect';
import { burnPage, boxesToBurn } from '../../src/app/redaction/burn';
const log = value => document.querySelector('pre').textContent += JSON.stringify(value) + '\\n';
const save = data => fetch('/report', {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(data,null,2)});
document.querySelector('button').onclick = async () => {
 document.querySelector('button').disabled = true;
 const results = [], ocr = new OcrService(), worker = new Worker('/ner.worker.js',{type:'module'});
 let backend = null;
 const loadAt = performance.now();
 const ready = new Promise((resolve,reject) => {
  worker.onmessage = ({data}) => {
   if(data.type==='backend') backend=data.variant;
   if(data.type==='ready') resolve(true);
   if(data.type==='load-error') reject(new Error('Local privacy model unavailable'));
  };
  worker.onerror = () => reject(new Error('Local privacy worker failed'));
 });
 worker.postMessage({type:'load',modelId:'bardsai/eu-pii-anonimization-multilang',wasmBase:location.origin+'/vendor/ort/',gpuModelBase:location.origin+'/models/pii-fp16-62ca5712-v1/'});
 log({stage:'loading-local-privacy-model'});
 try {
 await ready; log({stage:'model-ready',backend,elapsedMs:Math.round(performance.now()-loadAt)});
 const base=document.createElement('canvas');base.width=2400;base.height=1800;
 const ctx=base.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,2400,1800);ctx.fillStyle='black';ctx.font='38px Arial';
 const personal=[], clinical=[];
 const line=(text,x,y,target) => {ctx.fillText(text,x,y);const m=ctx.measureText(text);if(target)target.push({x:x-m.actualBoundingBoxLeft,y:y-m.actualBoundingBoxAscent,w:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,h:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});};
 line('Patient:',70,100);line('Marta Beispiel',330,100,personal);
 line('Email:',70,165);line('marta.beispiel@example.com',330,165,personal);
 line('Telefon:',70,230);line('+48 500 111 222',330,230,personal);
 line('Patient ID:',70,295);line('AB12345678',330,295,personal);
 line('Geburtsdatum:',70,360);line('12.03.1980',400,360,personal);
 line('Entnahmedatum: 2026-10-15',70,460);
 line('Untersuchung',70,570);line('Ergebnis',950,570);line('Einheit',1300,570);line('Referenz',1700,570);
 ['Glukose|92|mg/dL|70-99','CRP|<0,6|mg/L|0-5','Monozyten|0,4|10^9/L|0,2-0,8','Monozyten|4|%|2-8','Freies T4|15|pmol/L|12-22','Coeliac screening|Negative||'].forEach((row,i)=>row.split('|').forEach((t,j)=>line(t,[70,950,1300,1700][j],650+i*100,clinical)));
 const rotatedBox=(b,a)=>a===90?{x:1800-b.y-b.h,y:b.x,w:b.h,h:b.w}:a===180?{x:2400-b.x-b.w,y:1800-b.y-b.h,w:b.w,h:b.h}:a===270?{x:b.y,y:2400-b.x-b.w,w:b.h,h:b.w}:b;
 for(const angle of [0,90,180,270]) {
  const canvas=document.createElement('canvas');canvas.width=angle%180?1800:2400;canvas.height=angle%180?2400:1800;
  const c=canvas.getContext('2d');c.translate(canvas.width/2,canvas.height/2);c.rotate(angle*Math.PI/180);c.drawImage(base,-1200,-900);
  const at=performance.now();const output=await ocr.recognizePage(canvas,0);const ocrMs=Math.round(performance.now()-at);
  const words=output.words;const lines=[];for(const w of words){(lines[w.line]??=[]).push(w.text);}
  const piiAt=performance.now();
  const predictions=await new Promise((resolve,reject)=>{
   worker.onmessage=({data})=>{if(data.type==='result')resolve(data.predictions);if(data.type==='predict-error')reject(new Error('Privacy inference failed'));};
   worker.postMessage({type:'predict',id:angle+1,lines:lines.filter(Boolean)});
  });
  const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const page={index:0,width:canvas.width,height:canvas.height,image,imageUrl:null,words,regions:[],ocr:true};
  const detected=applyDetections([page],[new Map(words.map((w,i)=>[w.id,{label:predictions[i][0],score:predictions[i][1]}]))],NORMAL)[0];
  const piiMs=Math.round(performance.now()-piiAt),burnAt=performance.now();
  const burned=await burnPage(detected);const burnMs=Math.round(performance.now()-burnAt);
  const masks=boxesToBurn(detected);
  const ink=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const coverage=b=>{let covered=0,total=0;for(let y=Math.floor(b.y);y<b.y+b.h;y++)for(let x=Math.floor(b.x);x<b.x+b.w;x++){const i=(y*canvas.width+x)*4;if(ink[i]>240&&ink[i+1]>240&&ink[i+2]>240)continue;total++;if(masks.some(m=>x>=m.x&&x<m.x+m.w&&y>=m.y&&y<m.y+m.h))covered++;}return total?covered/total:1;};
  const row={angle,backend,ocrMs,piiMs,burnMs,passes:1,words:words.length,identifiers:personal.length,identifierCoverage:personal.map(b=>Math.round(coverage(rotatedBox(b,angle))*100)),fullyCovered:personal.filter(b=>coverage(rotatedBox(b,angle))>=0.98).length,clinicalRegionsMasked:clinical.filter(b=>b.w>0 && b.h>0).filter(b=>coverage(rotatedBox(b,angle))>0.05).length};
  // Manual region geometry must remain correct even when OCR fails.
  const manual=await burnPage({...page,regions:personal.map(b=>rotatedBox(b,angle))});
  const bitmap=await createImageBitmap(manual);const check=document.createElement('canvas');check.width=bitmap.width;check.height=bitmap.height;check.getContext('2d').drawImage(bitmap,0,0);
  row.manualRegionsBlack=personal.every(b=>{const r=rotatedBox(b,angle);const p=check.getContext('2d').getImageData(Math.ceil(r.x),Math.ceil(r.y),Math.floor(r.w),Math.floor(r.h)).data;for(let i=0;i<p.length;i+=4)if(p[i]||p[i+1]||p[i+2])return false;return true;});
  bitmap.close();results.push(row);log(row);await save(results);
 }
 log({stage:'complete'});
 } catch {log({stage:'failed'});await save(results);} finally {worker.terminate();await ocr.terminate();}
};
`);
await build({ entryPoints:[join(out,'privacy.ts')],outfile:join(out,'privacy.js'),bundle:true,platform:'browser',format:'esm',tsconfig:join(root,'tsconfig.app.json') });
await writeFile(join(out,'privacy.html'), '<!doctype html><meta charset="utf-8"><title>Pipeline privacy verification</title><h1>Synthetic privacy orientation checks</h1><button>Run local checks</button><pre style="white-space:pre-wrap;max-width:960px"></pre><script type="module" src="/privacy.js"></script>');
if (process.argv.includes('--build-only')) process.exit(0);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json'};
createServer(async(req,res)=>{
 try {
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(req.method==='POST'&&path==='/report'){const chunks=[];for await(const chunk of req)chunks.push(chunk);await writeFile(join(out,'privacy-timings.json'),Buffer.concat(chunks));res.end('ok');return;}
  let file=path==='/'?join(out,'privacy.html'):join(out,path.slice(1));
  for(const [prefix,dir] of [['/models/','public/models'],['/vendor/ort/','node_modules/onnxruntime-web/dist'],['/vendor/tesseract-core/','node_modules/tesseract.js-core'],['/vendor/tesseract/','node_modules/tesseract.js/dist']]) if(path.startsWith(prefix))file=join(root,dir,path.slice(prefix.length));
  if(path.startsWith('/vendor/tessdata/')){const name=path.split('/').at(-1),lang=name.split('.')[0];file=join(root,'node_modules/@tesseract.js-data',lang,'4.0.0_best_int',name);}
  if(!resolve(file).startsWith(root + (process.platform==='win32'?'\\':'/'))){res.writeHead(403).end();return;}
  const size=await stat(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':size.size});createReadStream(file).pipe(res);
 }catch{res.writeHead(404).end();}
}).listen(4294,'127.0.0.1',()=>console.log('Synthetic privacy verification at http://localhost:4294'));
