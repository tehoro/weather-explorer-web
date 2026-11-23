// Record the rendered scene directly; no screen permission or server upload.
export function setupRecording(source){
 const $=id=>document.getElementById(id),button=$('recordVideo'),status=$('videoStatus'),save=$('videoDownload');
 let recorder,stream,canvas,ctx,chunks=[],started=0,last=0,url=null;
 const supported=typeof MediaRecorder!=='undefined'&&typeof HTMLCanvasElement.prototype.captureStream==='function';
 if(!supported){button.disabled=true;status.textContent='Video recording is unavailable in this browser.';}
 const reset=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;button.textContent='Record';$('recordingStop').hidden=true;};
 button.onclick=()=>{
  if(recorder){stop();return;}
  try{
   const mime=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
   if(!mime)throw Error('No supported video format in this browser.');
   const scale=Math.min(1,1920/source.width,1080/source.height);canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.floor(source.width*scale/2)*2);canvas.height=Math.max(2,Math.floor(source.height*scale/2)*2);ctx=canvas.getContext('2d');
   stream=canvas.captureStream(30);recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000});chunks=[];save.hidden=true;if(url){URL.revokeObjectURL(url);url=null;}
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   recorder.onerror=()=>{status.textContent='Recording failed. Please try a shorter recording.';reset();};
   recorder.onstop=()=>{const blob=new Blob(chunks,{type:mime});chunks=[];url=URL.createObjectURL(blob);save.href=url;save.download='weather-explorer-'+new Date().toISOString().replace(/[:.]/g,'-')+(mime.startsWith('video/mp4')?'.mp4':'.webm');save.hidden=false;status.textContent='Recording ready. Save the video below.';reset();$('videoPanel').hidden=false;$('videoOpen').setAttribute('aria-expanded','true');};
   started=performance.now();last=0;recorder.start(1000);button.textContent='Stop & save';$('recordingStop').hidden=false;status.textContent='Recording the scene, clock and place labels. Move, orbit or play the forecast as usual.';$('videoPanel').hidden=true;$('videoOpen').setAttribute('aria-expanded','false');
  }catch(e){reset();status.textContent=e.message;}
 };
 function stop(){if(recorder?.state==='recording')recorder.stop();}
 $('recordingStop').onclick=stop;
 addEventListener('pagehide',()=>{stop();stream?.getTracks().forEach(t=>t.stop());if(url)URL.revokeObjectURL(url);});
 return now=>{
  if(recorder?.state!=='recording'||now-last<1000/30)return;last=now;
  try{
   const w=canvas.width,h=canvas.height,scale=Math.min(w/innerWidth,h/innerHeight),ox=(w-innerWidth*scale)/2,oy=(h-innerHeight*scale)/2;
   ctx.fillStyle='#0c141a';ctx.fillRect(0,0,w,h);ctx.drawImage(source,ox,oy,innerWidth*scale,innerHeight*scale);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
   ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=4;
   for(const el of document.querySelectorAll('.placeLabel,#pointMarkerName')){
    if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')continue;
    const r=el.getBoundingClientRect(),selected=el.id==='pointMarkerName',x=r.left+r.width/2,y=r.bottom+(selected?11:7);
    ctx.font='600 13px system-ui';ctx.fillStyle=selected?'#ff817a':'#e8f3fa';ctx.fillText(el.firstChild?.textContent||'',x,r.bottom-3);ctx.beginPath();ctx.arc(x,y,selected?5:2.5,0,Math.PI*2);ctx.fill();
    const temp=el.querySelector('.placeTemperature');if(temp&&!temp.hidden)ctx.fillText(temp.textContent,x,y+23);
   }
   ctx.textAlign='right';ctx.fillStyle='#fff';ctx.font='600 19px system-ui';ctx.fillText($('clockDate').textContent,innerWidth-22,30);ctx.font='700 32px system-ui';ctx.fillText($('clockHour').textContent,innerWidth-22,70);ctx.font='600 14px system-ui';ctx.fillText($('clockLead').textContent+' · '+$('clockZone').textContent,innerWidth-22,96);
   ctx.textAlign='left';ctx.font='12px system-ui';ctx.fillText('Weather Explorer · Explore',16,innerHeight-34);ctx.fillText('Data: © '+new Date().getFullYear()+' ECMWF · CC BY 4.0 · Terrain: Copernicus · Land cover: ESA WorldCover · Places: GeoNames',16,innerHeight-15);ctx.restore();
   const seconds=Math.floor((now-started)/1000);$('recordingStop').textContent=`● ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Stop & save`;
  }catch{status.textContent='Unable to capture this scene.';stop();}
 };
}
