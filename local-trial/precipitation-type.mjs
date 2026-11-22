// Same deterministic precipitation-type hues as Highlights' ECMWF chart palette.
export const TYPES={0:['Dry','#000000'],1:['Rain','#3ce213'],3:['Freezing rain','#ff044b'],5:['Snow','#9d68ee'],6:['Wet snow','#4543fa'],7:['Rain and snow','#1fb8a6'],8:['Ice pellets','#ff8000'],12:['Freezing drizzle','#fb6ec0']};
export function precipitationType(type,rain,snow){
 if(rain<.05)return 0;
 if(type>=0&&TYPES[type])return type;
 const fraction=snow/Math.max(.001,rain);
 return fraction>.8?5:fraction>.2?7:1;
}
export function typeName(type,rain,snow){return TYPES[precipitationType(type,rain,snow)]?.[0]||'Unknown';}
export const typeShader=`
vec3 precipitationColour(float type){
 if(type<.5)return vec3(.3,.5,.6);
 if(type<2.)return vec3(.235,.886,.075);
 if(type<4.)return vec3(1.,.016,.294);
 if(type<5.5)return vec3(.616,.408,.933);
 if(type<6.5)return vec3(.271,.263,.98);
 if(type<7.5)return vec3(.122,.722,.651);
 if(type<10.)return vec3(1.,.502,0.);
 return vec3(.984,.431,.753);
}
float precipitationKind(vec4 p){
 if(p.r<.05)return 0.;
 if(p.b>=0.)return floor(p.b+.5);
 float f=p.g/max(.001,p.r);return f>.8?5.:f>.2?7.:1.;
}`;
