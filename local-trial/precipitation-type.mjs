// Local terrain palette: distinct from green land and muted sea colours.
// Shared by the terrain shader, meteogram and point forecast.
export const TYPES={0:['Dry','#000000'],1:['Rain','#3264ff'],3:['Freezing rain','#ff478b'],5:['Snow','#cfb9f4'],6:['Wet snow','#9355e8'],7:['Rain and snow','#7564ed'],8:['Ice pellets','#ff8000'],12:['Freezing drizzle','#d94fcb']};
export function precipitationType(type,rain,snow){
 if(rain<.05)return 0;
 if(type>=0&&TYPES[type])return type;
 const fraction=snow/Math.max(.001,rain);
 return fraction>.8?5:fraction>.2?7:1;
}
export function typeName(type,rain,snow){return TYPES[precipitationType(type,rain,snow)]?.[0]||'Unknown';}
export function typeColour(type,rain,snow){return TYPES[precipitationType(type,rain,snow)][1];}
export function typeLegend(){return Object.entries(TYPES).filter(([id])=>id!=='0').map(([, [name,colour]])=>`${name} <span style="color:${colour}" aria-hidden="true">■</span>`).join(' · ');}
const rgb=hex=>[1,3,5].map(i=>(parseInt(hex.slice(i,i+2),16)/255).toFixed(6)).join(',');
export const typeShader=`
vec3 precipitationColour(float type){
 ${Object.entries(TYPES).map(([id,[,colour]])=>`if(abs(type-${Number(id).toFixed(1)})<.5)return vec3(${rgb(colour)});`).join('\n ')}
 return vec3(.3,.5,.6);
}
float precipitationKind(vec4 p){
 if(p.r<.05)return 0.;
 if(p.b>=0.)return floor(p.b+.5);
 float f=p.g/max(.001,p.r);return f>.8?5.:f>.2?7.:1.;
}`;
