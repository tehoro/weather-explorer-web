import {timeMode,setTimeMode} from './local-time.mjs';
export function setupExploreUnits(host){
 const button=document.createElement('button');button.id='exploreUnits';button.title='Units and time zone';button.setAttribute('aria-expanded','false');host.append(button);
 const panel=document.createElement('section');panel.id='exploreUnitsPanel';panel.className='glass actionPanel';panel.hidden=true;panel.innerHTML='<h2>Units and time zone</h2>';document.body.append(panel);
 const update=()=>{for(const kind of ['temperature','wind','rain']){const el=panel.querySelector('#units-'+kind);if(el)el.value=Units.choice(kind);}const surface=document.getElementById('surfaceField');if(surface){surface.querySelector('[value=temperature]').textContent='Temperature · '+Math.round(Units.convert(-10,'°C'))+' to '+Math.round(Units.convert(35,'°C'))+' '+Units.unit('°C');surface.querySelector('[value=wind]').textContent='Wind · 0 to '+Math.round(Units.convert(25,'m/s'))+' '+Units.unit('m/s');}button.textContent=[Units.unit('°C'),Units.unit('m/s'),Units.unit('mm'),{location:'View time',browser:'Browser time',utc:'UTC'}[timeMode()]].join(' · ');};
 for(const [kind,title]of [['temperature','Temperature'],['wind','Wind'],['rain','Precipitation']]){
  const label=document.createElement('label');label.textContent=title;const select=document.createElement('select');select.id='units-'+kind;
  for(const [value,text]of [['auto','Automatic'],...Units.CHOICES[kind]])select.add(new Option(text,value));select.value=Units.choice(kind);label.append(select);panel.append(label);
  select.onchange=()=>{Units.setChoice(kind,select.value);update();dispatchEvent(new Event('local-units-change'));};
 }
 const label=document.createElement('label');label.textContent='Time display';const select=document.createElement('select');select.id='exploreTimeMode';
 for(const [value,text]of [['location','View location'],['browser','Browser time'],['utc','UTC']])select.add(new Option(text,value));select.value=timeMode();label.append(select);panel.append(label);
 select.onchange=()=>{setTimeMode(select.value);update();dispatchEvent(new Event('local-units-change'));};
 const note=document.createElement('p');note.textContent='Units are shared with Highlights and Past Events. The time display is remembered separately for Explore.';panel.append(note);
 const close=document.createElement('button');close.textContent='Close';close.onclick=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');};panel.append(close);
 button.onclick=()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));};
 addEventListener('storage',e=>{if(e.key==='weather-explorer-units'){try{const values=JSON.parse(e.newValue||'{}');for(const kind of ['temperature','wind','rain'])if(Units.choice(kind)!==(values[kind]||'auto')){Units.setChoice(kind,values[kind]||'auto');panel.querySelector('#units-'+kind).value=Units.choice(kind);}}catch{}}select.value=timeMode();update();dispatchEvent(new Event('local-units-change'));});
 addEventListener('local-units-change',()=>{select.value=timeMode();update();});update();
}
