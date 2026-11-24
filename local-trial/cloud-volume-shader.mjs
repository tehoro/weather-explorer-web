export const vertex=`out vec3 localPosition;void main(){localPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const fragment=`precision highp float;precision highp sampler3D;
uniform sampler3D texA,texB,detailMap;uniform sampler2D groundMap,terrainDepth,standardA,standardB;uniform vec2 viewport,areaSize;uniform vec4 weatherUV;uniform vec3 enabledBands;uniform float volumeReady,cameraFar,logarithmicDepth,standardBlend;uniform mat4 cameraToLocal,inverseProjection;uniform float mixTime,opacity,tint,fixedMode,areaWidth,top,detailEnabled,groundSize,adaptiveOpacity;
uniform vec3 camLocal;in vec3 localPosition;out vec4 fragColor;
vec2 hitBox(vec3 o,vec3 d){vec3 a=(vec3(-.5)-o)/d,b=(vec3(.5)-o)/d;vec3 lo=min(a,b),hi=max(a,b);return vec2(max(max(lo.x,lo.y),lo.z),min(min(hi.x,hi.y),hi.z));}
float floorAt(vec2 uv){return texture(groundMap,(uv*(groundSize-1.)+.5)/groundSize).r;}
float band(float z,float lo,float hi){return clamp(min((z-lo)/.2,(hi-z)/.2),0.,1.);}
vec2 cloudAt(vec3 uv){
 if(any(lessThan(uv,vec3(0.)))||any(greaterThan(uv,vec3(1.))))return vec2(0.);
 float edge=smoothstep(0.,.025,min(min(uv.x,1.-uv.x),min(uv.z,1.-uv.z)));
 if(volumeReady<.5){vec2 st=clamp(weatherUV.xy+uv.xz*weatherUV.zw,0.,1.);vec3 c=mix(texture(standardA,st).rgb,texture(standardB,st).rgb,standardBlend)*enabledBands;float z=uv.y*top-floorAt(uv.xz);return vec2(max(max(c.r*band(z,.3,1.8),c.g*band(z,3.,5.4)),c.b*band(z,7.,10.4))*edge,0.);}
 vec3 tc=(uv*(vec3(65.,128.,65.)-1.)+.5)/vec3(65.,128.,65.);vec4 d=mix(texture(texA,tc),texture(texB,tc),mixTime);
 float z=uv.y*top;float enabled=z<3.?enabledBands.x:z<7.?enabledBands.y:enabledBands.z;
 return vec2(d.r*edge*enabled,d.b);
}
float roundedDetail(vec3 uv){
 vec3 km=vec3((uv.x-.5)*areaSize.x,uv.y*top,(uv.z-.5)*areaSize.y);
 float distanceKm=length((uv-.5-camLocal)*vec3(areaSize.x,top,areaSize.y));
 float near=1.-smoothstep(25.,180.,distanceKm);
 if(near<.001||detailEnabled<.5)return 1.;
 vec3 tc=(uv*(vec3(65.,128.,65.)-1.)+.5)/vec3(65.,128.,65.);float regime=volumeReady>.5?mix(texture(texA,tc).a,texture(texB,tc).a,mixTime):.3;
 float strength=near*regime*(1.-smoothstep(7.,10.,km.y));
 if(strength<.01)return 1.;
 // Broad, stationary distortion breaks the repeated tile without extra fetches.
 vec3 warped=km+5.*sin(km.zxy/43.+vec3(1.7,4.1,.8))
                   +2.5*sin(km.yzx/19.+vec3(3.4,.2,2.6));
 mat3 turn=mat3(.36,.48,-.8,-.8,.60,0.,.48,.64,.60);
 float lumps=texture(detailMap,turn*warped/32.).r;
 float fine=texture(detailMap,transpose(turn)*warped/13.7+vec3(.37,.19,.71)).r;
 return max(.05,1.+strength*((lumps-.45)*3.2+(fine-.45)*.6));
}
void main(){if(opacity<=0.)discard;vec3 dir=normalize(localPosition-camLocal);vec2 bounds=hitBox(camLocal,dir);bounds.x=max(0.,bounds.x);
// Stop at the actual rasterised mountain surface, not a jittered terrain sample.
vec2 screenUV=gl_FragCoord.xy/viewport;float depth=texture(terrainDepth,screenUV).r;
if(depth<1.){vec4 viewPoint=inverseProjection*vec4(screenUV*2.-1.,depth*2.-1.,1.);viewPoint/=viewPoint.w;if(logarithmicDepth>.5){vec4 ray=inverseProjection*vec4(screenUV*2.-1.,1.,1.);ray/=ray.w;float viewZ=exp2(depth*log2(cameraFar+1.))-1.;viewPoint=vec4(ray.xyz*(-viewZ/ray.z),1.);}
vec3 localGround=(cameraToLocal*viewPoint).xyz;bounds.y=min(bounds.y,dot(localGround-camLocal,dir));}
if(bounds.x>=bounds.y)discard;
float dt=(bounds.y-bounds.x)/80.;float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);vec3 p=camLocal+dir*(bounds.x+dt*jitter);
float distanceKm=length(dir*vec3(areaSize.x*.12,top,areaSize.y*.12))*dt;vec3 colour=vec3(0.);float alpha=0.;
for(int i=0;i<80;i++){vec3 uv=p+.5;vec2 c=cloudAt(uv);if(c.x>.002){float a=1.-exp(-c.x*roundedDetail(uv)*distanceKm*1.5);vec3 light=vec3(-.7/areaSize.x,1./top,-.3/areaSize.y);float shade=exp(-(cloudAt(uv+light*.3).x+cloudAt(uv+light*.9).x)*1.5);vec3 lit=mix(vec3(.38,.45,.54),vec3(.96,.98,1.),shade);lit=mix(lit,vec3(1.,.52,.73),tint*c.y*(1.-fixedMode));colour+=(1.-alpha)*a*lit;alpha+=(1.-alpha)*a;if(alpha>.98)break;}p+=dir*dt;}
if(alpha<.002)discard;vec3 physicalDir=normalize(dir*vec3(areaSize.x,top,areaSize.y));
float clearance=(camLocal.y+.5)*top-floorAt(clamp(camLocal.xz+.5,0.,1.));
float beneath=max(smoothstep(-.02,.18,physicalDir.y),(1.-smoothstep(.1,1.5,clearance))*(1.-smoothstep(.02,.2,-physicalDir.y)));
float displayOpacity=mix(opacity,max(opacity,.95),beneath*adaptiveOpacity);
fragColor=vec4(colour/alpha,alpha*displayOpacity);
fragColor=linearToOutputTexel(fragColor);
}`;
