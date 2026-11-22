// Coordinate lookup stays local; Intl applies the zone's rules at forecast time.
export function zoneAt(lat,lon,lookup=globalThis.tzlookup){
 try{return lookup(Math.max(-90,Math.min(90,lat)),((lon+180)%360+360)%360-180);}catch{return 'UTC';}
}
export function timeParts(iso,zone){
 const date=new Date(iso),format=options=>new Intl.DateTimeFormat('en-NZ',{timeZone:zone,...options});
 const offset=format({timeZoneName:'longOffset'}).formatToParts(date).find(p=>p.type==='timeZoneName').value;
 let name=format({timeZoneName:'short'}).formatToParts(date).find(p=>p.type==='timeZoneName').value;
 if(zone==='Pacific/Auckland')name=offset==='GMT+13:00'?'NZDT':'NZST';
 if(zone==='Pacific/Chatham')name=offset==='GMT+13:45'?'CHADT':'CHAST';
 return {date:format({year:'numeric',month:'short',day:'numeric'}).format(date),day:format({weekday:'short'}).format(date),hour:format({hour:'numeric',minute:'2-digit',hour12:true}).format(date).toUpperCase(),zone:name,offset,full:format({weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(date)+' '+name};
}
export function forecastMoment(meta,frame){
 const f=Math.max(0,Math.min(meta.times.length-1,frame)),a=Math.floor(f),b=Math.min(a+1,meta.times.length-1),mix=f-a;
 return {time:Date.parse(meta.times[a])+(Date.parse(meta.times[b])-Date.parse(meta.times[a]))*mix,lead:meta.steps[a]+(meta.steps[b]-meta.steps[a])*mix};
}
let lastClockKey='';
export function updateForecastClock(meta,frame,centre){
 if(!meta)return;const zone=zoneAt(centre.lat,centre.lon),moment=forecastMoment(meta,frame),key=meta.initial_utc+'/'+Math.floor(moment.time/60000)+'/'+zone;if(key===lastClockKey)return;lastClockKey=key;const p=timeParts(moment.time,zone),$=id=>document.getElementById(id);
 $('clockDate').textContent=p.date;$('clockHour').textContent=p.day+' '+p.hour;
 $('clockZone').textContent=`${p.zone} · ${zone.replaceAll('_',' ')}`;$('mapClock').title=`Forecast time in this location’s time zone · ${p.offset}. Time-zone boundaries are approximate.`;
 $('validTime').textContent=p.full;$('forecastLead').textContent=`+${Math.floor(moment.lead)} h ${String(Math.floor((moment.lead%1)*60+1e-6)).padStart(2,'0')} min · ${p.zone}`;
 $('timelineStart').textContent=timeParts(meta.times[0],zone).full;$('timelineEnd').textContent=timeParts(meta.times.at(-1),zone).full;
 $('modelRun').textContent='Model run: '+new Date(meta.initial_utc).toISOString().slice(0,16).replace('T',' ')+' UTC';
}
