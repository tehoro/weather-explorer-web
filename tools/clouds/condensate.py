"""Illustrative optical thickness from column condensate; retain humidity heights."""
import numpy as np
from build_tiles import TOP,V
DZ=TOP/(V-1)
EXTINCTION_MAX=12.
LIQUID_COEFFICIENT=15.
ICE_COEFFICIENT=3.
def allocate(density, liquid_preference, column_liquid, column_ice, dz):
    """Return kg/m³ on the same support; each supported column conserves its mass."""
    support=np.maximum(density,0)
    result=[]
    for preference,column in [(liquid_preference,column_liquid),(1-liquid_preference,column_ice)]:
        weight=support*np.clip(preference,0,1)
        total=weight.sum(axis=1,keepdims=True)
        weight=np.where(total>1e-12,weight,support)
        total=weight.sum(axis=1,keepdims=True)
        result.append(weight/np.maximum(total,1e-12)*np.maximum(column,0)[:,None,:]/(dz*1000))
    return result

def apply_condensate(a,arrays):
    h=arrays['gh'].astype('f4')/1000
    temp=arrays['t'].astype('f4')-273.15
    preference=np.empty(a.shape[:3],dtype='f4')
    # Use actual pressure-level geopotential heights; extend endpoint temperatures.
    for iz,z in enumerate(np.linspace(0,TOP,V)):
        t=temp[0].copy()
        for k in range(11):
            w=np.clip((z-h[k])/np.maximum(h[k+1]-h[k],.001),0,1)
            t=np.where(z>=h[k],temp[k]*(1-w)+temp[k+1]*w,t)
        preference[:,iz,:]=np.clip((t+40)/35,0,1)
    liquid,ice=allocate(a[:,:,:,0].astype('f4')/255,preference,arrays['tclw'],arrays['tciw'],DZ)
    liquid*=LIQUID_COEFFICIENT*1000;ice*=ICE_COEFFICIENT*1000
    total=liquid+ice
    reduction=np.maximum(1,total/EXTINCTION_MAX)
    a[:,:,:,0]=np.rint(liquid/reduction/EXTINCTION_MAX*255).astype('u1')
    a[:,:,:,1]=np.rint(ice/reduction/EXTINCTION_MAX*255).astype('u1')
    return a
