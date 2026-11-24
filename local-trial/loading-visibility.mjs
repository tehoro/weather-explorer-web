// Brief refinement during camera movement should not flash a status label.
const pending=new WeakMap();
export function setLoadingVisible(element,visible){
 if(!visible){
  if(pending.has(element)){clearTimeout(pending.get(element));pending.delete(element);}
  element.hidden=true;return;
 }
 if(!element.hidden||pending.has(element))return;
 pending.set(element,setTimeout(()=>{pending.delete(element);element.hidden=false;},1000));
}
