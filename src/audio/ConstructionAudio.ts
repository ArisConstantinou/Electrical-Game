export type ContinuousConstructionSound='spray'|'hose'|'drill'|'driver'|'trowel'|'mixer';
export type ConstructionSound='hammer'|'box'|'level'|'spring'|'cutter'|'mark'|'laser'|'trowel-whoosh'|'mortar-splat'|'water-pour'|'sack-tear'|'cement-scrape'|'sand-scoop'|'mixer-insert'|'mixer-rinse';

type LoopNodes={source:AudioBufferSourceNode;gain:GainNode;filter:BiquadFilterNode};
type SoundLayer={filter:number;duration:number;volume:number;attack?:number;texture?:number;delay?:number};
const loopSettings:Record<ContinuousConstructionSound,{motor:number;filter:number;volume:number}>={
  spray:{motor:0,filter:4200,volume:.038},hose:{motor:0,filter:1900,volume:.048},
  drill:{motor:146,filter:3400,volume:.046},driver:{motor:112,filter:2700,volume:.041},
  trowel:{motor:0,filter:1800,volume:.028},mixer:{motor:76,filter:1500,volume:.048},
};

// Impacts have a short contact and a quieter material tail. Moving materials
// sustain a textured noise envelope; a downward-pitched tone makes them drums.
const soundLayers:Record<ConstructionSound,readonly SoundLayer[]>={
  hammer:[{filter:4700,duration:.025,volume:.21},{filter:1350,duration:.11,volume:.10,texture:87}],
  box:[{filter:3600,duration:.022,volume:.12},{filter:2100,duration:.075,volume:.055,delay:.024}],
  level:[{filter:3900,duration:.025,volume:.075}],
  spring:[{filter:2900,duration:.26,volume:.067,attack:.012,texture:53}],
  cutter:[{filter:5600,duration:.018,volume:.14},{filter:2700,duration:.06,volume:.055,delay:.018}],
  mark:[{filter:3400,duration:.13,volume:.046,attack:.014,texture:61}],
  laser:[{filter:4200,duration:.019,volume:.047}],
  'trowel-whoosh':[{filter:2200,duration:.18,volume:.067,attack:.055}],
  'mortar-splat':[{filter:1150,duration:.055,volume:.17},{filter:2400,duration:.19,volume:.073,attack:.008,texture:43}],
  'water-pour':[{filter:2800,duration:.52,volume:.090,attack:.055,texture:19},{filter:780,duration:.42,volume:.056,attack:.035}],
  'sack-tear':[{filter:5700,duration:.35,volume:.10,attack:.016,texture:97}],
  'cement-scrape':[{filter:3300,duration:.32,volume:.083,attack:.028,texture:73}],
  'sand-scoop':[{filter:2100,duration:.40,volume:.10,attack:.04,texture:47},{filter:4500,duration:.16,volume:.024,attack:.012}],
  'mixer-insert':[{filter:3100,duration:.025,volume:.095},{filter:1300,duration:.14,volume:.065,attack:.012,texture:31}],
  'mixer-rinse':[{filter:3600,duration:.44,volume:.090,attack:.03,texture:23}],
};

/** Procedural construction textures, unlocked only by a real user gesture. */
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
      const length=Math.max(1,Math.floor(this.context.sampleRate*2));this.noise=this.context.createBuffer(1,length,this.context.sampleRate);
      const data=this.noise.getChannelData(0);for(let i=0;i<length;i++)data[i]=this.random()*2-1;
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
    const context=this.context;if(!context||context.state==='closed'||!this.noise)return;
    const strength=Math.max(.2,Math.min(1.5,intensity)),now=context.currentTime;
    for(const layer of soundLayers[kind]){
      const source=context.createBufferSource(),filter=context.createBiquadFilter(),highpass=context.createBiquadFilter(),gain=context.createGain();
      source.buffer=this.noise;source.playbackRate.value=.94+this.random()*.12;
      filter.type='lowpass';filter.frequency.value=layer.filter;filter.Q.value=.55;
      // Remove sub-bass and DC: the contact should not sound like a kick drum.
      highpass.type='highpass';highpass.frequency.value=kind==='mortar-splat'?100:180;highpass.Q.value=.55;
      const start=now+(layer.delay??0),duration=layer.duration*(.94+this.random()*.12),attack=layer.attack??.0015,peak=layer.volume*strength;
      const envelope=new Float32Array(64);
      for(let i=0;i<envelope.length;i++){
        const t=i/(envelope.length-1)*duration,p=t/duration;
        const onset=Math.min(1,t/attack),release=layer.attack?Math.pow(1-p,1.15):Math.exp(-p*6)*(1-p);
        // Uneven grains/crinkles, not a regular percussion rhythm.
        const texture=layer.texture ? .68+.32*Math.sin(t*layer.texture*6.283+Math.sin(t*137)*1.7)**2:1;
        envelope[i]=peak*onset*release*texture;
      }
      envelope[envelope.length-1]=0;gain.gain.setValueCurveAtTime(envelope,start,duration);
      source.connect(filter).connect(highpass).connect(gain).connect(context.destination);
      source.onended=()=>{source.disconnect();filter.disconnect();highpass.disconnect();gain.disconnect();};
      source.start(start,this.random()*.9);source.stop(start+duration+.005);
    }
  }

  private createLoop(kind:ContinuousConstructionSound):void{
    const context=this.context!,setting=loopSettings[kind],filter=context.createBiquadFilter(),gain=context.createGain(),source=context.createBufferSource();
    filter.type=setting.motor?'lowpass':'bandpass';filter.frequency.value=setting.filter;filter.Q.value=.55;gain.gain.value=0;
    source.buffer=setting.motor?this.createMotorBuffer(setting.motor):this.noise;source.loop=true;
    source.connect(filter).connect(gain).connect(context.destination);source.start();this.loops.set(kind,{source,gain,filter});this.applyLoop(kind,this.requested.get(kind)??0);
  }

  private createMotorBuffer(frequency:number):AudioBuffer{
    const context=this.context!,buffer=context.createBuffer(1,context.sampleRate*2,context.sampleRate),data=buffer.getChannelData(0);
    let air=0;
    for(let i=0;i<data.length;i++){
      const t=i/context.sampleRate,phase=2*Math.PI*frequency*t+.09*Math.sin(2*Math.PI*7*t);
      const white=this.random()*2-1;air=air*.42+white*.58;
      // Bearing/brush friction and several motor harmonics instead of one pure
      // bass oscillator. Integer cycles across two seconds avoid pitch seams.
      const motor=Math.sin(phase)*.12+Math.sin(phase*3)*.12+Math.sin(phase*7)*.075+Math.sin(phase*13)*.04;
      data[i]=motor+air*(.53+.08*Math.sin(2*Math.PI*13*t));
    }
    return buffer;
  }

  private applyLoop(kind:ContinuousConstructionSound,intensity:number):void{
    const context=this.context,nodes=this.loops.get(kind);if(!context||!nodes)return;const setting=loopSettings[kind],now=context.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);nodes.gain.gain.setTargetAtTime(setting.volume*intensity,now,intensity?.035:.055);
    if(setting.motor)nodes.source.playbackRate.setTargetAtTime(.96+Math.min(1,intensity)*.08,now,.045);
  }

  get telemetry(){return{contextState:this.context?.state??'locked',activeLoops:Object.fromEntries([...this.requested].map(([key,value])=>[key,value>0])),loopTransitions:this.loopTransitions,events:{...this.events}};}
}
