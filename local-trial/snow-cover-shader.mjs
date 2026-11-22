// Shared Local/globe snow depiction. Heights are real kilometres above MSL.
export const snowCoverShader=`
 float terrainSnow(vec4 cover,vec3 regional,float terrainKm){
  float localLine=cover.b/max(cover.a,.0001);
  float localSnow=mix(cover.r,smoothstep(localLine-.15,localLine+.15,terrainKm)*max(cover.r,.65),cover.a);
  float regionalLine=regional.r/max(regional.g,.0001);
  // Only unresolved high ground can gain regional snow; retain broad model cover.
  float unresolved=smoothstep(.3,.6,terrainKm-regional.b);
  // Confidence softens the edge instead of making the entire summit translucent.
  float edge=.15+.2*(1.-clamp(regional.g,0.,1.));
  float regionalSnow=smoothstep(regionalLine-edge,regionalLine+edge,terrainKm);
  float weight=smoothstep(0.,.3,regional.g)*unresolved*(1.-cover.a);
  return mix(localSnow,max(localSnow,regionalSnow),weight);
 }
`;
