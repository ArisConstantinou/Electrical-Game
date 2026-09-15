export type ContinuousConstructionSound='spray'|'hose'|'drill'|'driver'|'trowel'|'mixer';
export type ConstructionSound='hammer'|'box'|'level'|'spring'|'cutter'|'mark'|'laser'|'trowel-whoosh'|'mortar-splat'|'water-pour'|'sack-tear'|'cement-scrape'|'sand-scoop'|'mixer-insert'|'mixer-rinse';

type LoopNodes={source:AudioScheduledSourceNode;gain:GainNode;filter:BiquadFilterNode};
const loopSettings:Record<ContinuousConstructionSound,{noise:boolean;frequency:number;filter:number;volume:number}>={
  spray:{noise:true,frequency:0,filter:4200,volume:.026},hose:{noise:true,frequency:0,filter:1900,volume:.032},
  drill:{noise:false,frequency:118,filter:2100,volume:.038},driver:{noise:false,frequency:92,filter:1600,volume:.035},
  trowel:{noise:true,frequency:0,filter:920,volume:.022},mixer:{noise:false,frequency:82,filter:760,volume:.042},
};

/** Small procedural construction sound bank. It has no downloaded assets and
 * starts only from a real user gesture, which keeps mobile Safari autoplay-safe. */
export class ConstructionAudio {
  private context:AudioContext|null=null;
  private noise:AudioBuffer|null=null;
  private readonly loops=new Map<ContinuousConstructionSound,LoopNodes>();
  private readonly requested=new Map<ContinuousConstructionSound,number>();
  private readonly events:Partial<Record<ConstructionSound,number>>={};
  private loopTransitions=0;
  private randomState=0x61c88647;

  private random():number{this.randomState=(Math.imul(this.randomState,1664525)+1013904223)>>>0;return this.randomState/0x100000000;}

  unlock():void{
    if(!this.context){
      this.context=new AudioContext();
      const length=Math.max(1,Math.floor(this.context.sampleRate*1.25));this.noise=this.context.createBuffer(1,length,this.context.sampleRate);
      const data=this.noise.getChannelData(0);let previous=0;for(let i=0;i<length;i++){const white=this.random()*2-1;previous=previous*.28+white*.72;data[i]=previous;}
      for(const kind of Object.keys(loopSettings) as ContinuousConstructionSound[])this.createLoop(kind);
    }
    void this.context.resume().catch(()=>{});
  }

  setContinuous(kind:ContinuousConstructionSound,active:boolean,intensity=1):void{
    const value=active?Math.max(.05,Math.min(1.4,intensity)):0,before=this.requested.get(kind)??0;
    if(Math.abs(before-value)<.01)return;
    if(Boolean(before)!==Boolean(value))this.loopTransitions++;
    this.requested.set(kind,value);this.applyLoop(kind,value);
  }

  play(kind:ConstructionSound,intensity=1):void{
    this.events[kind]=(this.events[kind]??0)+1;
    const context=this.context;if(!context||context.state==='closed')return;
    const strength=Math.max(.2,Math.min(1.5,intensity)),now=context.currentTime;
    const settings:Record<ConstructionSound,{frequency:number;filter:number;duration:number;volume:number;noise:number}>={
      hammer:{frequency:74,filter:720,duration:.09,volume:.095,noise:.085},box:{frequency:330,filter:2100,duration:.12,volume:.08,noise:.06},
      level:{frequency:1180,filter:3200,duration:.16,volume:.055,noise:.025},spring:{frequency:155,filter:1000,duration:.28,volume:.065,noise:.045},
      cutter:{frequency:240,filter:2600,duration:.13,volume:.10,noise:.11},mark:{frequency:980,filter:2500,duration:.09,volume:.035,noise:.02},
      laser:{frequency:720,filter:2400,duration:.12,volume:.035,noise:.01},'trowel-whoosh':{frequency:145,filter:1450,duration:.20,volume:.04,noise:.07},
      'mortar-splat':{frequency:92,filter:620,duration:.24,volume:.10,noise:.13},'water-pour':{frequency:210,filter:1700,duration:.42,volume:.025,noise:.07},
      'sack-tear':{frequency:360,filter:3300,duration:.30,volume:.025,noise:.10},'cement-scrape':{frequency:230,filter:1150,duration:.28,volume:.035,noise:.075},
      'sand-scoop':{frequency:170,filter:880,duration:.38,volume:.035,noise:.085},'mixer-insert':{frequency:190,filter:1200,duration:.14,volume:.075,noise:.045},
      'mixer-rinse':{frequency:260,filter:2100,duration:.35,volume:.025,noise:.075},
    };
    const s=settings[kind],destination=context.destination;
    const oscillator=context.createOscillator(),tone=context.createGain();oscillator.type=kind==='level'||kind==='laser'?'sine':'triangle';oscillator.frequency.setValueAtTime(s.frequency*(.94+this.random()*.12),now);oscillator.frequency.exponentialRampToValueAtTime(Math.max(28,s.frequency*.55),now+s.duration);tone.gain.setValueAtTime(Math.max(.0001,s.volume*strength),now);tone.gain.exponentialRampToValueAtTime(.0001,now+s.duration);oscillator.connect(tone).connect(destination);oscillator.start(now);oscillator.stop(now+s.duration+.02);
    if(this.noise&&s.noise>0){const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=this.noise;filter.type='lowpass';filter.frequency.value=s.filter;gain.gain.setValueAtTime(Math.max(.0001,s.noise*strength),now);gain.gain.exponentialRampToValueAtTime(.0001,now+s.duration);source.connect(filter).connect(gain).connect(destination);source.start(now,this.random()*.5);source.stop(now+s.duration+.02);}
  }

  private createLoop(kind:ContinuousConstructionSound):void{
    const context=this.context!,setting=loopSettings[kind],filter=context.createBiquadFilter(),gain=context.createGain();filter.type=setting.noise?'bandpass':'lowpass';filter.frequency.value=setting.filter;filter.Q.value=setting.noise?1.2:.7;gain.gain.value=0;
    let source:AudioScheduledSourceNode;
    if(setting.noise){const node=context.createBufferSource();node.buffer=this.noise;node.loop=true;source=node;}
    else{const node=context.createOscillator();node.type=kind==='driver'?'square':kind==='drill'?'sawtooth':'triangle';node.frequency.value=setting.frequency;source=node;}
    source.connect(filter).connect(gain).connect(context.destination);source.start();this.loops.set(kind,{source,gain,filter});this.applyLoop(kind,this.requested.get(kind)??0);
  }

  private applyLoop(kind:ContinuousConstructionSound,intensity:number):void{
    const context=this.context,nodes=this.loops.get(kind);if(!context||!nodes)return;const setting=loopSettings[kind],now=context.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);nodes.gain.gain.setTargetAtTime(setting.volume*intensity,now,intensity?.035:.055);
    if(nodes.source instanceof OscillatorNode)nodes.source.frequency.setTargetAtTime(setting.frequency*(.96+Math.min(1,intensity)*.08),now,.045);
  }

  get telemetry(){return{contextState:this.context?.state??'locked',activeLoops:Object.fromEntries([...this.requested].map(([key,value])=>[key,value>0])),loopTransitions:this.loopTransitions,events:{...this.events}};}
}
