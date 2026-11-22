// Bound terrain draping work per animation frame. Hidden clouds do no work;
// unchanged terrain does no work. A changing terrain version completes the
// current pass before starting another, so streaming cannot starve the tail.
export function updateCloudTerrain(meshes,ground,revision,budget=512){
 let used=0;
 const share=Math.max(1,Math.floor(budget/Math.max(1,meshes.filter(m=>m.visible).length)));
 for(const mesh of meshes){
  if(!mesh.visible)continue;
  const g=mesh.geometry,a=g.attributes.position;
  if(g.userData.terrainRevision===revision&&g.userData.terrainCursor===undefined)continue;
  if(g.userData.terrainCursor===undefined){g.userData.terrainCursor=0;g.userData.targetRevision=revision;}
  let cursor=g.userData.terrainCursor;const limit=Math.min(budget,used+share);
  while(cursor<a.count&&used<limit){a.setY(cursor,Math.max(0,ground(a.getX(cursor),a.getZ(cursor)))+g.userData.alt);cursor++;used++;}
  a.needsUpdate=true;
  if(cursor===a.count){g.userData.terrainRevision=g.userData.targetRevision;delete g.userData.terrainCursor;g.computeBoundingSphere();}
  else g.userData.terrainCursor=cursor;
  if(used===budget)break;
 }
 return used;
}
