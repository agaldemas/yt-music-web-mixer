'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function assert(label, cond) { if (cond) { pass++; console.log('✓', label); } else { fail++; console.error('✗', label); } }
class MockAudioElement {
  constructor(){ this.src=''; this.volume=1; this.paused=true; this.currentTime=0; this.duration=180; this.error=null; this.style={}; this._listeners={}; this.parentNode=null; }
  addEventListener(n,h){(this._listeners[n]||(this._listeners[n]=[])).push(h)}
  removeEventListener(n,h){this._listeners[n]=(this._listeners[n]||[]).filter(x=>x!==h)}
  _emit(n){(this._listeners[n]||[]).slice().forEach(h=>h({target:this}))}
  _triggerError(code){this.error={code};this._emit('error')}
  load(){} play(){this.paused=false;return Promise.resolve()} pause(){this.paused=true} removeAttribute(n){if(n==='src')this.src=''}
}
global.window={}; global.HTMLAudioElement=MockAudioElement;
global.document={createElement:t=>t==='audio'?new MockAudioElement():{},getElementById:()=>null,querySelector:()=>null,body:{appendChild(){}},readyState:'complete'};
global.performance={now:()=>Date.now()};
let blobSeq=0; global.URL={createObjectURL:()=>`blob:mock-${++blobSeq}`,revokeObjectURL(){}}; global.Blob=class {constructor(parts,o){this.parts=parts;this.type=o&&o.type}};
const STATE={UNSTARTED:-1,ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5}; window.YTWrapper={STATE};
let setMutedCalls=[]; const chains={};
window.AudioEngine={
 createDeckChain(id,a){chains[id]={audioEl:a};return chains[id]},destroyDeckChain(id){delete chains[id]},hasDeck:id=>!!chains[id],
 clearDeckBuffer(){},setDeckBufferLoadPromise(){},loadDeckBufferFromBlob(){return Promise.resolve({duration:100})},
 resume(){return Promise.resolve()},setMuted(id,v){setMutedCalls.push([id,v])},getPitch(){return 0},setPitch(){},getAnalyser(){return null},getContext(){return {}}
};
let progressCalls = [];
window.DeckTransport = {
  setDownloadProgress: (deck, percent, loaded, total, label) => {
    progressCalls.push({ deck, percent, loaded, total, label });
  },
  setDownloadError: () => {}
};
let streamImpl=id=>Promise.resolve({videoId:id,bestAudio:{stream:{url:'/api/audio/'+id}},scratchEligible:true});
window.PipedStreams={fetchStreamInfo:(id,signal)=>streamImpl(id,signal),refreshStream:(id,signal)=>streamImpl(id,signal),getCorsSafeUrl:(e,s)=>s&&s.url||'',classifyError:e=>({message:e&&e.message||'Erreur réseau'})};
let fetchImpl=(url,opts)=>Promise.resolve({ok:true,status:200,headers:{get:n=>n==='content-type'?'audio/mpeg':null},arrayBuffer:()=>Promise.resolve(new Uint8Array([1,2,3]).buffer)});
window.LocalAPI={fetch:(u,o)=>fetchImpl(u,o)};
window.state={players:{},sourceKind:{},backendMode:{}};
require(path.join(ROOT,'js/audio-player.js'));
const AP=window.AudioPlayer;
(async function(){
 assert('API exposée',!!AP&&typeof AP.createAudioPlayer==='function');
 assert('mapping playing',AP._audioEventToState('playing')===1);
 let ready=0, errors=[]; const p=AP.createAudioPlayer('A',{onReady:()=>ready++,onError:e=>errors.push(e)}); window.state.players.A=p;
 p.loadVideoById('abc123XYZ_-'); await new Promise(r=>setTimeout(r,10));
 assert('source convertie en Blob',p._getAudioElement().src==='blob:mock-1');
 assert('progression téléchargement émise',progressCalls.length > 0 && progressCalls[0].deck === 'A');
 assert('backend/source renseignés',window.state.backendMode.A==='piped'&&window.state.sourceKind.A==='youtube');
 p.mute(); p.unMute(); assert('mute via AudioEngine',setMutedCalls.length===2&&setMutedCalls[0][1]===true&&setMutedCalls[1][1]===false);
 p._getAudioElement()._emit('canplay'); assert('onReady sur canplay',ready===1);
 let resolveFirst;
 fetchImpl=(url,opts)=>{
   if(url.includes('first')) return new Promise((resolve,reject)=>{resolveFirst=()=>resolve({ok:true,status:200,headers:{get:()=> 'audio/mpeg'},arrayBuffer:()=>Promise.resolve(new Uint8Array([1]).buffer)}); if(opts.signal)opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));});
   return Promise.resolve({ok:true,status:200,headers:{get:()=> 'audio/mpeg'},arrayBuffer:()=>Promise.resolve(new Uint8Array([2]).buffer)});
 };
 streamImpl=id=>Promise.resolve({videoId:id,bestAudio:{stream:{url:'/api/audio/'+id}},scratchEligible:true});
 p.loadVideoById('first00001'); await new Promise(r=>setTimeout(r,0)); p.loadVideoById('second00002'); await new Promise(r=>setTimeout(r,10)); if(resolveFirst)resolveFirst(); await new Promise(r=>setTimeout(r,10));
 assert('chargement obsolète ignoré',p._getAudioElement().src==='blob:mock-2');
 let played=false; p._getAudioElement().play=()=>{played=true;return Promise.resolve()}; p.cueVideoById('cue00000001'); await new Promise(r=>setTimeout(r,10)); assert('cue ne joue pas',!played);
 streamImpl=()=>Promise.resolve({bestAudio:null}); p.loadVideoById('nostream001'); await new Promise(r=>setTimeout(r,10)); assert('erreur sans flux explicite',errors.some(e=>/Aucun flux/.test(e.message)));
 p.dispose(); assert('dispose marque le player',p._getState().disposed===true);
 console.log(`AudioPlayer: ${pass} pass / ${fail} fail`); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
