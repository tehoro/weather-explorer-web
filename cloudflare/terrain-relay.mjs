// Public, immutable terrain only. No user input is forwarded as an arbitrary URL.
export default {
 async fetch(request){
  const path=new URL(request.url).pathname;
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range','Access-Control-Expose-Headers':'Content-Range, Content-Length, ETag'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:cors});
  let match,url;
  if((match=path.match(/^\/dem\/(Copernicus_DSM_COG_30_[NS]\d{2}_00_[EW]\d{3}_00_DEM)\.tif$/)))url=`https://copernicus-dem-90m.s3.amazonaws.com/${match[1]}/${match[1]}.tif`;
  else if((match=path.match(/^\/water\/(ESA_WorldCover_10m_2021_v200_[NS]\d{2}[EW]\d{3}_Map)\.tif$/)))url=`https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${match[1]}.tif`;
  else return new Response('Not found',{status:404,headers:cors});
  const range=request.headers.get('Range'),parts=range?.match(/^bytes=(\d+)-(\d+)$/);
  if(!parts||+parts[2]<+parts[1]||+parts[2]-parts[1]+1>16*1024*1024)return new Response('A bounded range of at most 16 MiB is required',{status:400,headers:cors});
  const upstream=await fetch(url,{method:request.method,headers:{Range:range}});
  const headers=new Headers(cors);
  for(const name of ['Content-Type','Content-Range','Content-Length','ETag'])if(upstream.headers.has(name))headers.set(name,upstream.headers.get(name));
  headers.set('Cache-Control',upstream.status===206?'public, max-age=31536000, immutable':'no-store');
  return new Response(upstream.body,{status:upstream.status,headers});
 }
};
