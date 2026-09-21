import {PVC} from './PvcBend';
import {PVC_BUNDLE_COUNT} from './PvcModels';

export type ApprenticePipeKind='socket'|'switch';
export const APPRENTICE_PIPE_LENGTH_M:Readonly<Record<ApprenticePipeKind,number>>={socket:.5,switch:1.4};
export const APPRENTICE_PIPE_TARGET=20;
export const APPRENTICE_PIPE_KERF_M=.003;
export interface ApprenticeCutReceipt {bundle:number;kind:ApprenticePipeKind;lengthM:number;remainingM:number;rawClaimed:boolean;source:number}

/** Finite three-metre stock, including retained offcuts and blade loss. */
export class ApprenticePipeBatch {
  readonly remnants:number[][]=Array.from({length:PVC_BUNDLE_COUNT},()=>[]);
  readonly finished:ApprenticeCutReceipt[]=[];
  claimedRaw=0;
  kerfM=0;
  cut(bundle:number,kind:ApprenticePipeKind,takeRaw:()=>boolean):ApprenticeCutReceipt|null{
    if(!Number.isInteger(bundle)||bundle<0||bundle>=this.remnants.length)throw new RangeError('Unknown PVC bundle');
    const needed=APPRENTICE_PIPE_LENGTH_M[kind]+APPRENTICE_PIPE_KERF_M;
    const pipes=this.remnants[bundle];let source=pipes.findIndex(length=>length+1e-9>=needed),rawClaimed=false;
    if(source<0){if(!takeRaw())return null;pipes.push(PVC.length);source=pipes.length-1;this.claimedRaw++;rawClaimed=true;}
    pipes[source]=Math.max(0,pipes[source]-needed);this.kerfM+=APPRENTICE_PIPE_KERF_M;
    const receipt={bundle,kind,lengthM:APPRENTICE_PIPE_LENGTH_M[kind],remainingM:pipes[source],rawClaimed,source};this.finished.push(receipt);return receipt;
  }
  get telemetry(){return{claimedRaw:this.claimedRaw,finishedSocket:this.finished.filter(piece=>piece.kind==='socket').length,finishedSwitch:this.finished.filter(piece=>piece.kind==='switch').length,finishedM:this.finished.reduce((sum,piece)=>sum+piece.lengthM,0),kerfM:this.kerfM,remnantM:this.remnants.flat().reduce((sum,length)=>sum+length,0),remnants:this.remnants.map(pipes=>[...pipes])};}
}
