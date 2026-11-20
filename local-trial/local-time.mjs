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
export function updateForecastClock(meta,frame,centre){
 if(!meta)return;const zone=zoneAt(centre.lat,centre.lon),p=timeParts(meta.times[frame],zone),$=id=>document.getElementById(id);
 $('clockDate').textContent=p.date;$('clockHour').textContent=p.day+' '+p.hour;
 $('clockZone').textContent=`${p.zone} · ${zone.replaceAll('_',' ')}`;$('mapClock').title=`Forecast time at view centre · ${p.offset}. Time-zone boundaries are approximate.`;
 $('validTime').textContent=p.full;$('forecastLead').textContent=`+${meta.steps[frame]} h · ${p.zone}`;
 $('timelineStart').textContent=timeParts(meta.times[0],zone).full;$('timelineEnd').textContent=timeParts(meta.times.at(-1),zone).full;
 $('modelRun').textContent='Model run: '+new Date(meta.initial_utc).toISOString().slice(0,16).replace('T',' ')+' UTC';
}
