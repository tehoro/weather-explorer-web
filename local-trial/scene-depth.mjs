// Match custom weather shaders to Three's built-in logarithmic depth buffer.
// All visible surfaces must use the same depth mapping, including particles.
export function depthShader(source,stage){
 if(source.includes('logdepthbuf_pars_'))return source;
 const end=source.lastIndexOf('}');
 if(end<0)throw Error('Shader has no main body');
 return (stage==='vertex'&&!source.includes('#include <common>')?'#include <common>\n':'')+`#include <logdepthbuf_pars_${stage}>\n`+source.slice(0,end)+`\n#include <logdepthbuf_${stage}>\n`+source.slice(end);
}
export function prepareSceneDepth(scene){
 scene.traverse(object=>{
  for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){
   if(!material.isShaderMaterial||material.userData.logDepthReady)continue;
   material.vertexShader=depthShader(material.vertexShader,'vertex');
   material.fragmentShader=depthShader(material.fragmentShader,'fragment');
   material.userData.logDepthReady=true;material.needsUpdate=true;
  }
 });
}
