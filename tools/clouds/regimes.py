import numpy as np
def morphology(t,z,sp,cp,tp):
 levels=np.array([1000,925,850,700,600,500,400,300,250,200,150,100])[:,None,None]
 valid=(levels<=sp[None]/100)
 dz=np.diff(z,axis=0)/1000
 lapse=-np.diff(t,axis=0)/np.maximum(dz,.1)
 eligible=valid[:-1]&valid[1:]&(levels[1:]>=500)&(dz>.15)
 unstable=np.clip((lapse-5)/3,0,1)
 stability=np.max(np.where(eligible,unstable,0),axis=0)
 wet=tp>.05 # mm over the three-hour interval
 fraction=np.clip(cp/np.maximum(tp,.05),0,1)
 # Dry shallow cumulus remains possible. Rain ratio is a clue, not cloud coverage.
 return np.clip(np.where(wet,.65*fraction+.35*stability,.65*stability),0,1)
