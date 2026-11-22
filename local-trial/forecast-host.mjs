// Shared by the page and data worker. Only a public URL belongs in this config.
let config;
export async function forecastUrl(path){
 if(!path.startsWith('/global-data/'))return path;
 config??=fetch(new URL('./forecast-host.json',import.meta.url),{cache:'no-store'}).then(async r=>{
  if(!r.ok)throw Error('Forecast host configuration unavailable');
  const c=await r.json();if(typeof c.baseUrl!=='string')throw Error('Invalid forecast host');return c.baseUrl.replace(/\/$/,'');
 });
 return (await config)+path.slice('/global-data'.length);
}
export async function packedTile(url,indexes){
 const slash=url.lastIndexOf('/'),directory=url.slice(0,slash),name=url.slice(slash+1);
 if(!indexes.has(directory)){
  const p=fetch(directory+'/tiles.json').then(r=>{if(!r.ok)throw Error('Forecast pack index unavailable');return r.json();});
  indexes.set(directory,p);p.catch(()=>indexes.delete(directory));
 }
 const entry=(await indexes.get(directory))[name];
 if(!entry||entry.length!==2||!entry.every(Number.isSafeInteger)||entry[0]<0||entry[1]<=0)throw Error('Invalid forecast tile range');
 const [start,length]=entry,end=start+length-1;
 const r=await fetch(directory+'/tiles.bin',{headers:{Range:`bytes=${start}-${end}`}});
 if(r.status!==206||r.headers.get('Content-Range')?.split('/')[0]!==`bytes ${start}-${end}`)throw Error('Forecast host did not honour tile range');
 const data=await r.arrayBuffer();if(data.byteLength!==length)throw Error('Incomplete forecast tile');return data;
}
