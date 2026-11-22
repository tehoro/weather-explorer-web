export function setupUI(){
 const $=id=>document.getElementById(id),aside=document.querySelector('aside');aside.id='settingsPanel';aside.setAttribute('aria-label','Settings');
 const header=document.createElement('header');header.className='brand glass';header.innerHTML='<strong>Weather Explorer <span>LOCAL</span></strong><small>Private trial · build C</small><button id="helpOpen">Help</button><button id="cleanView">Clean view</button>';document.body.append(header);
 const clock=document.createElement('div');clock.id='mapClock';clock.innerHTML='<div id="clockDate"></div><div id="clockHour">Loading forecast…</div><div id="clockZone"></div>';document.body.append(clock);
 const timeline=document.createElement('section');timeline.id='timeline';timeline.className='glass';timeline.setAttribute('aria-label','Forecast timeline');timeline.innerHTML='<div class="timelineHeading"><div id="timeSlot"></div><span id="forecastLead"></span></div><div id="rangeSlot"></div><div class="timelineEnds"><span id="timelineStart"></span><span id="modelRun"></span><span id="timelineEnd"></span></div>';document.body.append(timeline);
 $('timeSlot').append($('validTime'));$('rangeSlot').append($('forecastTime'));
 const toolbar=document.createElement('nav');toolbar.id='playback';toolbar.className='glass';toolbar.setAttribute('aria-label','Playback');toolbar.innerHTML='<button id="previousFrame" aria-label="Previous forecast">−3 h</button><span id="playSlot"></span><button id="nextFrame" aria-label="Next forecast">+3 h</button><select id="playbackSpeed" aria-label="Playback speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select><button id="forecastNow">Now</button><button id="settingsToggle" aria-controls="settingsPanel" aria-expanded="true">Settings</button>';document.body.append(toolbar);$('playSlot').append($('weatherPlay'));
 const nodes=[...aside.children],weather=$('weatherControls');
 const precipitation=document.createElement('div');precipitation.innerHTML='<label for="precipitationStyle">Precipitation style</label><select id="precipitationStyle"><option value="symbols">Raindrops &amp; snowflakes</option><option value="streaks">Rain streaks &amp; drifting snow</option></select><p><small>Streaks use small, slower drifting snow particles. Density follows IFS precipitation; falling heights and speeds are illustrative.</small></p>';
 weather.append(precipitation);
 const refresh=document.createElement('p');refresh.id='runRefreshStatus';refresh.setAttribute('role','status');refresh.hidden=true;weather.prepend(refresh);
 const loading=document.createElement('div');loading.id='prepareStatus';loading.className='glass';loading.setAttribute('role','status');loading.hidden=true;loading.style.cssText='position:fixed;left:20px;top:90px;max-width:340px;padding:12px;z-index:8;pointer-events:none';document.body.append(loading);
 const retryBuffer=document.createElement('button');retryBuffer.id='retryBuffer';retryBuffer.textContent='Retry loading this view';retryBuffer.hidden=true;weather.append(retryBuffer);
 const location=document.createElement('details');location.open=true;location.innerHTML='<summary>Location</summary>';
 const view=document.createElement('details');view.innerHTML='<summary>View &amp; terrain</summary><label for="viewAngle">View angle</label><select id="viewAngle"><option value="slanted">Slanted</option><option value="top">Top-down</option></select><label><input type="checkbox" id="placeNames" checked>Place names</label><p id="placesStatus"><small>Loading global place names…</small></p>';
 const diagnostics=document.createElement('details');diagnostics.innerHTML='<summary>Loading details</summary>';
 const reading=document.createElement('details');reading.innerHTML='<summary>Weather at view centre</summary>';reading.append($('weather'));
 const help=document.createElement('dialog');help.id='helpDialog';help.className='glass';help.innerHTML='<div class="panelHeading"><h2>Explore the local forecast</h2><button id="helpClose" aria-label="Close help">×</button></div><p>Drag to rotate and tilt; Shift-drag or right-drag to pan. Scroll to zoom. On touchscreens, one finger rotates and two fingers pan or pinch.</p><p>The clock and timeline use the time zone at the centre of the view, including daylight saving at the forecast date. Geographic time-zone boundaries are approximate. The model-run time remains in UTC.</p>';document.body.append(help);
 for(const node of nodes){
  if(node===weather||node.id==='weather')continue;
  if(node.matches('h1,small'))node.remove();
  else if(node.id==='locationSearch')location.append(node);
  else if(node.classList.contains('nav')||node.id==='surfaceStyle'||node.matches('label[for="surfaceStyle"]')||node.id==='styleNote')view.append(node);
  else if(node.id==='status')diagnostics.append(node);
  else if(node.tagName==='P')help.append(node);
  else if(node.tagName==='A')view.append(node);
 }
 aside.replaceChildren();const panelHeader=document.createElement('div');panelHeader.className='panelHeading';panelHeader.innerHTML='<h2>Settings</h2><button id="closeSettings" aria-label="Close settings">×</button>';aside.append(panelHeader);
 const body=document.createElement('div');body.className='panelBody';body.append(location,weather,reading,view,diagnostics);aside.append(body);
 function panel(open){aside.hidden=!open;document.body.classList.toggle('panelClosed',!open);$('settingsToggle').setAttribute('aria-expanded',String(open));}
 $('closeSettings').onclick=()=>panel(false);$('settingsToggle').onclick=()=>{document.body.classList.remove('clean');panel(aside.hidden);};
 $('cleanView').onclick=()=>{const clean=document.body.classList.toggle('clean');panel(false);$('cleanView').textContent=clean?'Show controls':'Clean view';};
 $('helpOpen').onclick=()=>help.showModal();$('helpClose').onclick=()=>help.close();
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!help.open){document.body.classList.remove('clean');$('cleanView').textContent='Clean view';panel(false);}});
 if(matchMedia('(max-width:700px)').matches)panel(false);
}
