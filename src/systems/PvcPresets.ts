export interface PvcPreset { cm:number; name:string; builtin?:boolean }
export const PVC_PRESET_KEY='wirehouse:pvc-presets:v1';
export const DEFAULT_PVC_PRESETS:readonly PvcPreset[]=[
  {cm:50,name:'ΠΡΙΖΑ',builtin:true},{cm:140,name:'SWITCH',builtin:true},
];
export function readPvcPresets(storage:Pick<Storage,'getItem'>):PvcPreset[]{
  try{
    const values:unknown=JSON.parse(storage.getItem(PVC_PRESET_KEY)??'[]');
    if(!Array.isArray(values))return [];
    const result:PvcPreset[]=[];
    for(const value of values){
      if(!value||typeof value.cm!=='number'||!Number.isFinite(value.cm)||value.cm<25||value.cm>260)continue;
      const cm=Math.round(value.cm*10)/10;
      if([...DEFAULT_PVC_PRESETS,...result].some(p=>Math.abs(p.cm-cm)<.05))continue;
      result.push({cm,name:'ΔΙΚΟ ΜΟΥ'});if(result.length===20)break;
    }
    return result;
  }catch{return [];}
}
