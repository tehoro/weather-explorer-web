// Both loading displays count the same current viewport, including cover data.
export function terrainReadiness(needed,tiles,failures,waterMissing){
 let elevation=0,ready=0,terrainFailed=0,coverFailed=0;
 for(const key of needed.keys()){
  const tile=tiles.get(key),complete=tile&&(tile.mesh.userData.ocean||tile.mesh.userData.water);
  if(tile)elevation++;
  if(complete)ready++;
  if(!tile&&failures.has(key))terrainFailed++;
  if(tile&&!complete&&waterMissing.has(key))coverFailed++;
 }
 return {total:needed.size,elevation,ready,terrainFailed,coverFailed,failed:terrainFailed+coverFailed};
}
