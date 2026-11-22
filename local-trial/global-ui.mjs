export function setupUI(){
 const $=id=>document.getElementById(id),aside=document.querySelector('aside');aside.id='settingsPanel';aside.setAttribute('aria-label','Settings');
 const header=document.createElement('header');header.className='brand glass';header.innerHTML='<strong>Weather Explorer <span>LOCAL</span></strong><small>Private trial · build C</small><button id="helpOpen">Help</button><button id="cleanView">Clean view</button>';document.body.append(header);
 const clock=document.createElement('div');clock.id='mapClock';clock.innerHTML='<div id="clockDate"></div><div id="clockHour">Loading forecast…</div><div id="clockZone"></div>';document.body.append(clock);
 const timeline=document.createElement('section');timeline.id='timeline';timeline.className='glass';timeline.setAttribute('aria-label','Forecast timeline');timeline.innerHTML='<div class="timelineHeading"><div id="timeSlot"></div><span id="forecastLead"></span></div><div id="rangeSlot"></div><div class="timelineEnds"><span id="timelineStart"></span><span id="modelRun"></span><span id="timelineEnd"></span></div>';document.body.append(timeline);
 $('timeSlot').append($('validTime'));$('rangeSlot').append($('forecastTime'));
 const toolbar=document.createElement('nav');toolbar.id='playback';toolbar.className='glass';toolbar.setAttribute('aria-label','Playback');toolbar.innerHTML='<button id="previousFrame" aria-label="Previous forecast">−3 h</button><span id="playSlot"></span><button id="nextFrame" aria-label="Next forecast">+3 h</button><select id="playbackSpeed" aria-label="Playback speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select><button id="forecastNow">Now</button><button id="orbitToggle" aria-pressed="false">Orbit</button><button id="settingsToggle" aria-controls="settingsPanel" aria-expanded="true">Settings</button>';document.body.append(toolbar);$('playSlot').append($('weatherPlay'));
 const nodes=[...aside.children],weather=$('weatherControls');
 const precipitation=document.createElement('div');precipitation.innerHTML='<label for="precipitationStyle">Precipitation style</label><select id="precipitationStyle"><option value="symbols">Raindrops &amp; snowflakes</option><option value="streaks" selected>Rain streaks &amp; drifting snow</option></select><p><small>Streaks use small, slower drifting snow particles. Density follows IFS precipitation; falling heights and speeds are illustrative.</small></p>';
 const advanced=document.createElement('details');advanced.innerHTML='<summary>Advanced settings</summary>';advanced.append(precipitation);advanced.insertAdjacentHTML('beforeend','<label for="orbitPeriod">Orbit · seconds per full rotation</label><input id="orbitPeriod" type="number" min="10" max="3600" step="1" value="120"><p><small>Keep the current centre, distance and tilt. Drag or zoom to pause the orbit.</small></p>');
 const period=advanced.querySelector('#orbitPeriod');try{const saved=Number(localStorage.getItem('local-orbitPeriod'));if(saved>=10&&saved<=3600)period.value=saved;}catch{}
 period.onchange=()=>{period.value=String(Math.round(Math.max(10,Math.min(3600,Number(period.value)||120))));try{localStorage.setItem('local-orbitPeriod',period.value);}catch{}};
 advanced.insertAdjacentHTML('beforeend','<label for="windDensity">Wind trail density</label><select id="windDensity"><option value=".25">Sparse</option><option value=".5">Half</option><option value="1" selected>Standard</option></select><label for="windSpeed">Wind animation speed</label><select id="windSpeed"><option value=".5">Slow</option><option value="1" selected>Standard</option><option value="2">Fast</option></select><button id="resetAnimation">Reset animation to Standard</button>');
 advanced.querySelector('#resetAnimation').onclick=()=>{document.getElementById('windDensity').value='1';document.getElementById('windSpeed').value='1';document.getElementById('precipitationStyle').value='streaks';for(const id of ['precipitationStyle','windDensity','windSpeed'])document.getElementById(id).dispatchEvent(new Event('change'));};

 for(const id of ['precipitationStyle','windDensity','windSpeed']){
  const el=document.getElementById(id)||advanced.querySelector('#'+id);try{const saved=localStorage.getItem('local-'+id);if([...el.options].some(o=>o.value===saved))el.value=saved;}catch{}
  el.addEventListener('change',()=>{try{localStorage.setItem('local-'+id,el.value);}catch{}});
 }
 const refresh=document.createElement('p');refresh.id='runRefreshStatus';refresh.setAttribute('role','status');refresh.hidden=true;weather.prepend(refresh);
 const loading=document.createElement('div');loading.id='prepareStatus';loading.className='glass';loading.setAttribute('role','status');loading.hidden=true;loading.style.cssText='position:fixed;left:20px;top:90px;max-width:340px;padding:12px;z-index:8;pointer-events:none';document.body.append(loading);
 const retryBuffer=document.createElement('button');retryBuffer.id='retryBuffer';retryBuffer.textContent='Retry loading this view';retryBuffer.hidden=true;weather.append(retryBuffer);
 const location=document.createElement('details');location.open=true;location.innerHTML='<summary>Location</summary>';
 const weatherDetail=document.createElement('p');weatherDetail.id='weatherDetailStatus';weatherDetail.textContent='Preparing global weather preview…';$('weatherControls').append(weatherDetail);
 const view=document.createElement('details');view.innerHTML='<summary>View &amp; terrain</summary><label for="viewAngle">View angle</label><select id="viewAngle"><option value="slanted">Slanted</option><option value="top">Top-down</option><option value="low">Near ground · about 500 m</option></select><label><input type="checkbox" id="placeNames" checked>Place names</label><p id="placesStatus"><small>Loading global place names…</small></p>';
 const diagnostics=document.createElement('details');diagnostics.innerHTML='<summary>Loading details</summary>';
 $('weather').remove();
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
 const footer=document.querySelector('footer'),credits=document.createElement('section');
 credits.id='dataCredits';credits.tabIndex=-1;
 credits.innerHTML='<h3>Data sources and licences</h3>'+footer.innerHTML;
 credits.insertAdjacentHTML('beforeend','<p>Forecasts are based on ECMWF IFS Open Data, accessed through AWS with ECMWF as fallback. Fields are resampled, interpolated and unit-converted. <a href="https://www.ecmwf.int/en/forecasts/datasets/open-data">Weather source</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0 licence</a>. ECMWF does not accept liability for errors, omissions, availability or loss arising from use of its data.</p><p>Terrain produced using Copernicus WorldDEM™-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM™-90.</p><p><a href="https://esa-worldcover.org/en/data-access">WorldCover source and citation</a> · <a href="https://www.geonames.org/">GeoNames source</a>. These datasets are used under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Place names are filtered and tiled; land-cover data are resampled for display.</p>');
 help.append(credits);
 footer.innerHTML='Data: © 2026 ECMWF · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · <button id="creditsOpen" aria-haspopup="dialog" aria-controls="helpDialog">Data credits</button>';
 $('creditsOpen').onclick=()=>{help.showModal();credits.focus();credits.scrollIntoView({block:'start'});};
 aside.replaceChildren();const panelHeader=document.createElement('div');panelHeader.className='panelHeading';panelHeader.innerHTML='<h2>Settings</h2><button id="closeSettings" aria-label="Close settings">×</button>';aside.append(panelHeader);
 const hint=document.createElement('p');hint.id='pointHint';hint.className='glass';hint.textContent='Click for a forecast · double-click the landscape or click a town to centre';document.body.append(hint);
 const body=document.createElement('div');body.className='panelBody';body.append(location,weather,view,advanced,diagnostics);aside.append(body);
 function panel(open){aside.hidden=!open;document.body.classList.toggle('panelClosed',!open);$('settingsToggle').setAttribute('aria-expanded',String(open));}
 $('closeSettings').onclick=()=>panel(false);$('settingsToggle').onclick=()=>{document.body.classList.remove('clean');panel(aside.hidden);};
 $('cleanView').onclick=()=>{const clean=document.body.classList.toggle('clean');panel(false);$('cleanView').textContent=clean?'Show controls':'Clean view';};
 $('helpOpen').onclick=()=>{help.showModal();help.scrollTop=0;};$('helpClose').onclick=()=>help.close();
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!help.open){document.body.classList.remove('clean');$('cleanView').textContent='Clean view';panel(false);}});
 if(matchMedia('(max-width:700px)').matches)panel(false);
}
