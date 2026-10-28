// Guarda o app no celular para funcionar sem internet.
// Página principal: tenta a internet primeiro (pega atualizações na hora) e usa a cópia guardada sem sinal.
const V='levprod-v13';
const ARQ=['./','index.html','export.js','jszip.min.js','mapa.json','mapa_dwg.json','modelo.js','medicao.js','contratos.json','logo.png','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ARQ.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const pagina=r.mode==='navigate'||/\/(index\.html)?$/.test(new URL(r.url).pathname);
  if(pagina){
    e.respondWith(fetch(new Request(r,{cache:'no-store'})).then(res=>{if(res.ok){const cp=res.clone();caches.open(V).then(c=>c.put('index.html',cp))}return res})
      .catch(()=>caches.match('index.html').then(x=>x||caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(c=>{
    const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque')){const cp=res.clone();caches.open(V).then(cc=>cc.put(r,cp))}return res}).catch(()=>c);
    return c||net;
  }));
});
