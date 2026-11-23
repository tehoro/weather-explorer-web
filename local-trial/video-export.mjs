import {compositeVideo} from './video-recording.mjs';
export const EXPORT_FPS=30;
export function exportFrame(start,seconds,speed,last,playing){return playing?Math.min(last,start+seconds*speed/3):start;}
export function frameTiming(index){const timestamp=Math.round(index*1e6/EXPORT_FPS);return {timestamp,duration:Math.round((index+1)*1e6/EXPORT_FPS)-timestamp};}
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
export function cancellable(promise,signal){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
async function muxerLibrary(signal){
 if(window.Mp4Muxer)return window.Mp4Muxer;
 await cancellable(new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.5/build/mp4-muxer.min.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Unable to load the MP4 exporter. Please retry.'));};document.head.append(script);}),signal);
 return window.Mp4Muxer;
}
export function setupSmoothExport(source,controller){
 const $=id=>document.getElementById(id);let busy=false,url=null,activeAbort=null;
 if(!('VideoEncoder' in window)||!('VideoFrame' in window)){$('exportVideo').disabled=true;$('exportStatus').textContent='Smooth export needs a browser with WebCodecs, such as current Chrome or Safari.';}
 $('exportVideo').onclick=async()=>{
  if(busy)return;busy=true;const abort=activeAbort=new AbortController(),signal=abort.signal,dialog=$('exportProgress');let encoder,session,failed;
  const say=(message,percent)=>{$('exportMessage').textContent=message;if(percent!==undefined)$('exportMeter').value=percent;};
  const seconds=Math.max(5,Math.min(300,Math.round(Number($('exportDuration').value)||120))),total=seconds*EXPORT_FPS;
  $('exportDuration').value=seconds;$('exportVideo').disabled=$('recordVideo').disabled=true;$('exportDownload').hidden=true;
  $('exportCancel').onclick=()=>abort.abort(new DOMException('Export cancelled','AbortError'));dialog.oncancel=e=>{e.preventDefault();$('exportCancel').click();};dialog.showModal();say('Preparing weather and video encoder…',0);
  try{
   const library=await muxerLibrary(signal);
   let config;
   for(const codec of ['avc1.640028','avc1.4d0028','avc1.42e028']){const c={codec,width:1920,height:1080,bitrate:10000000,framerate:EXPORT_FPS};if((await VideoEncoder.isConfigSupported(c)).supported){config=c;break;}}
   if(!config)throw Error('This browser cannot encode 1080p H.264 video. Live recording is still available.');
   const muxer=new library.Muxer({target:new library.ArrayBufferTarget(),video:{codec:'avc',width:1920,height:1080},fastStart:'in-memory'});
   encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:e=>{failed=e;}});encoder.configure(config);
   session=controller.begin();
   await cancellable(session.prepare(seconds,signal,say),signal);
   const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d',{alpha:false});
   for(let i=0;i<total;i++){
    signal.throwIfAborted();if(failed)throw failed;
    // Backpressure bounds encoder memory without dropping or duplicating simulation steps.
    while(encoder.encodeQueueSize>4){await yieldTask();signal.throwIfAborted();if(failed)throw failed;}
    await session.frame(i/EXPORT_FPS,i?1/EXPORT_FPS:0);
    compositeVideo(source,canvas,ctx);
    const frame=new VideoFrame(canvas,frameTiming(i));try{encoder.encode(frame,{keyFrame:i%60===0});}finally{frame.close();}
    if(i%5===0){say(`Rendering ${i+1} / ${total} frames · ${Math.floor((i+1)/total*100)}%`,(i+1)/total*100);await yieldTask();}
   }
   say('Finishing MP4…',100);await cancellable(encoder.flush(),signal);signal.throwIfAborted();if(failed)throw failed;muxer.finalize();
   if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([muxer.target.buffer],{type:'video/mp4'}));$('exportDownload').href=url;$('exportDownload').download=`weather-explorer-smooth-${Date.now()}.mp4`;$('exportDownload').hidden=false;
   $('exportStatus').textContent=`Ready: ${seconds} seconds · 1920×1080 · 30 fps.`;
  }catch(e){$('exportStatus').textContent=signal.aborted?'Export cancelled.':`Export failed: ${e.message}`;}
  finally{
   if(encoder&&encoder.state!=='closed')encoder.close();
   try{await session?.restore();}catch(e){$('exportStatus').textContent+=' View restoration: '+e.message;}
   dialog.close();activeAbort=null;busy=false;$('exportVideo').disabled=$('recordVideo').disabled=false;$('videoPanel').hidden=false;$('videoOpen').setAttribute('aria-expanded','true');
  }
 };
 addEventListener('pagehide',()=>{activeAbort?.abort();if(url)URL.revokeObjectURL(url);});
}
