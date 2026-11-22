// Opaque terrain uses texture alpha only as a water mask. Water stays at the
// same unlit colour as the global relief; land keeps its terrain lighting.
export function shadeWaterConsistently(material){
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
   outgoingLight=mix(diffuseColor.rgb,outgoingLight,diffuseColor.a);
   diffuseColor.a=1.;
   #include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=> 'terrain-unlit-water-v1';
}
