// Record the rendered scene directly; no screen permission or server upload.
export function setupRecording(source,{begin=()=>{},end=()=>{}}={}){
 const $=id=>document.getElementById(id),button=$('recordVideo'),status=$('videoStatus'),save=$('videoDownload');
 let recorder,stream,canvas,ctx,chunks=[],started=0,last=0,url=null,track=null,lastSecond=-1;
 const supported=typeof MediaRecorder!=='undefined'&&typeof HTMLCanvasElement.prototype.captureStream==='function';
 if(!supported){button.disabled=true;status.textContent='Video recording is unavailable in this browser.';}
 const reset=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;track=null;recorder=null;end();button.textContent='Record live';if(document.getElementById('exportVideo'))document.getElementById('exportVideo').disabled=typeof VideoEncoder==='undefined'||typeof VideoFrame==='undefined';$('recordingStop').hidden=true;};
 button.onclick=()=>{
  if(recorder){stop();return;}
  if(document.getElementById('exportProgress')?.open)return;
  try{
   const mime=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
   if(!mime)throw Error('No supported video format in this browser.');
   const height=Number($('videoQuality').value),width=height*16/9;begin(width,height);const scale=Math.min(1,width/source.width,height/source.height);canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.floor(source.width*scale/2)*2);canvas.height=Math.max(2,Math.floor(source.height*scale/2)*2);ctx=canvas.getContext('2d',{alpha:false});
   // Request each completed frame explicitly: a second 30 Hz capture timer can miss frames.
   stream=canvas.captureStream(0);track=stream.getVideoTracks()[0];if(!track.requestFrame){stream.getTracks().forEach(t=>t.stop());stream=canvas.captureStream(30);track=null;}recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000});chunks=[];save.hidden=true;if(url){URL.revokeObjectURL(url);url=null;}
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   recorder.onerror=()=>{status.textContent='Recording failed. Please try a shorter recording.';reset();};
   recorder.onstop=()=>{const blob=new Blob(chunks,{type:mime});chunks=[];url=URL.createObjectURL(blob);save.href=url;save.download='weather-explorer-'+new Date().toISOString().replace(/[:.]/g,'-')+(mime.startsWith('video/mp4')?'.mp4':'.webm');save.hidden=false;status.textContent='Recording ready. Save the video below.';reset();$('videoPanel').hidden=false;$('videoOpen').setAttribute('aria-expanded','true');};
   document.getElementById('exportVideo')?.setAttribute('disabled','');started=performance.now();last=0;lastSecond=-1;recorder.start(1000);button.textContent='Stop & save';$('recordingStop').hidden=false;status.textContent='Recording the scene, clock and place labels. Move, orbit or play the forecast as usual.';$('videoPanel').hidden=true;$('videoOpen').setAttribute('aria-expanded','false');
  }catch(e){reset();status.textContent=e.message;}
 };
 function stop(){if(recorder?.state==='recording')recorder.stop();}
 $('recordingStop').onclick=stop;
 addEventListener('pagehide',()=>{stop();stream?.getTracks().forEach(t=>t.stop());if(url)URL.revokeObjectURL(url);});
 return now=>{
  if(recorder?.state!=='recording')return;
  const interval=1000/30,elapsed=now-last;if(elapsed<interval)return;
  // Preserve the fractional remainder instead of dropping every late animation frame.
  last=now-elapsed%interval;
  try{
   compositeVideo(source,canvas,ctx);
   track?.requestFrame();
   const seconds=Math.floor((now-started)/1000);if(seconds!==lastSecond){lastSecond=seconds;$('recordingStop').textContent=`● ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Stop & save`;}
  }catch{status.textContent='Unable to capture this scene.';stop();}
 };
}

export function compositeVideo(source,canvas,ctx){
 const $=id=>document.getElementById(id);
   const w=canvas.width,h=canvas.height,scale=Math.min(w/innerWidth,h/innerHeight),ox=(w-innerWidth*scale)/2,oy=(h-innerHeight*scale)/2;
   ctx.fillStyle='#0c141a';ctx.fillRect(0,0,w,h);ctx.drawImage(source,ox,oy,innerWidth*scale,innerHeight*scale);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
   ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=4;
   for(const el of document.querySelectorAll('.placeLabel,#pointMarkerName')){
    if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')continue;
    const r=el.getBoundingClientRect(),selected=el.id==='pointMarkerName',x=r.left+r.width/2,y=r.bottom+(selected?11:7);
    ctx.font='600 13px system-ui';ctx.fillStyle=selected?'#ff817a':'#e8f3fa';ctx.fillText(el.firstChild?.textContent||'',x,r.bottom-3);ctx.beginPath();ctx.arc(x,y,selected?5:2.5,0,Math.PI*2);ctx.fill();
    const temp=el.querySelector('.placeTemperature');if(temp&&!temp.hidden)ctx.fillText(temp.textContent,x,y+23);
   }
   ctx.restore();
   drawVideoBands(ctx,w,h,videoDetails());
}

export function videoDetails(){
 const $=id=>document.getElementById(id),text=id=>$(id)?.textContent?.trim()||'';
 const place=$('pointMarkerName')?.firstChild?.textContent?.trim();
 const layers=[['windLayer','10 m wind'],['rainLayer','Precipitation'],['cloudLayer','Clouds'],['pressureLayer','Isobars']].filter(([id])=>$(id)?.checked).map(([,name])=>name);
 const surface=$('surfaceField');if(surface&&surface.value!=='none')layers.push(surface.selectedOptions?.[0]?.textContent||'Surface weather');
 return {title:place?`${place} · Weather Explorer`:'Weather Explorer · Explore',description:layers.join(' · ')||'Terrain and landscape',date:text('clockDate'),hour:text('clockHour'),zone:text('clockZone'),lead:text('clockLead'),run:text('modelRun')};
}

// Output-space typography and safe margins are independent of the browser window.
// Both live capture and frame-by-frame export use the same presentation.
export function drawVideoBands(ctx,w,h,details){
 const scale=Math.min(w/1280,h/720),pad=24*scale,top=92*scale,bottom=142*scale;
 ctx.save();ctx.shadowBlur=0;ctx.textAlign='left';ctx.textBaseline='alphabetic';
 ctx.fillStyle='rgba(8,14,19,0.88)';ctx.fillRect(0,0,w,top);ctx.fillRect(0,h-bottom,w,bottom);
 const line=(text,y,size,colour='#e6edf2',weight=500,family='system-ui')=>{
  ctx.fillStyle=colour;ctx.font=`${weight} ${size*scale}px ${family}`;
  ctx.fillText(text,pad,y,w-2*pad);
 };
 line(details.title,pad+26*scale,26,'#e6edf2',700);
 line(details.description,pad+54*scale,17,'#b8c7d1');
 // Reserve two hour columns so 9:59 → 10:00 cannot shift the timezone.
 const hour=details.hour.replace(/\b(\d):(?=\d{2})/,' $1:');
 line(`${details.date} · ${hour} · ${details.zone}`,h-bottom+35*scale,25,'#e6edf2',700,'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
 line(`${details.lead} h · IFS Open Data${details.run?' · '+details.run:''}`,h-bottom+63*scale,16,'#b8c7d1');
 line('Weather Explorer · weatherexplorer.neilgordon.me',h-bottom+91*scale,17);
 line('Data: © '+new Date().getFullYear()+' ECMWF · CC BY 4.0 · Interpolated and unit-converted',h-bottom+112*scale,13,'#b8c7d1');
 line('Terrain: Copernicus · Land cover: ESA WorldCover · Places: GeoNames',h-12*scale,12,'#b8c7d1');
 ctx.restore();
}
