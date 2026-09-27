import type {PvcBend} from '../systems/PvcBend';
import {PVC} from '../systems/PvcBend';
import './PvcBendHUD.css';

const paths={
  back:'<path d="m11 7-6 5 6 5M5 12h14"/>',
  forward:'<path d="m13 7 6 5-6 5M5 12h14"/>',
  bend:'<path d="M3 18h6a9 9 0 0 0 9-9V3M3 21h6A12 12 0 0 0 21 9V3"/><path d="m8 8 4 4-4 4M4 12h8"/>',
  insert:'<path d="M3 7h18M3 17h18M4 12h14m-4-4 4 4-4 4"/>',
  undo:'<path d="M7 8h8a6 6 0 0 1 0 12h-3M7 8l4-4M7 8l4 4"/>',
  transparent:'<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  confirm:'<path d="m5 12 4 4 10-10"/>',
  pause:'<path d="M11 4H5v16h6m3-12 4 4-4 4M9 12h10"/>',
  pipe:'<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z"/>',
  radius:'<path d="M4 20A16 16 0 0 1 20 4M4 20l12-12m-5 1 5-1-1 5"/><circle cx="4" cy="20" r="1"/>',
};
const icon=(name:keyof typeof paths)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
function action(command:string,name:keyof typeof paths,label:string,key:string):string{
  return `<button type="button" data-bend-action="${command}" aria-label="${label}" title="${label}${key?' · '+key:''}">${icon(name)}<span>${label}</span>${key?`<kbd>${key}</kbd>`:''}</button>`;
}
export class PvcBendHUD {
  readonly root=document.createElement('section');
  private readonly dial:SVGElement;
  private readonly angle:HTMLElement;
  private readonly radius:HTMLElement;
  private readonly progress:HTMLElement;
  private readonly position:HTMLElement;
  private readonly cells:HTMLElement[];
  private readonly quantity:HTMLElement;
  private readonly notice:HTMLElement;
  private readonly use:HTMLButtonElement;
  private readonly confirm:HTMLButtonElement;
  private readonly buttons:HTMLButtonElement[];
  private readonly quantityPanel:HTMLElement;
  private lastKey='';

  constructor(shell:HTMLElement,command:(action:string)=>void,hold:(held:boolean)=>void){
    this.root.id='pvc-bend-hud';this.root.hidden=true;this.root.setAttribute('aria-label','Κάμψη σωλήνας με ελατήριο');
    this.root.innerHTML=`<aside class="pvc-bend-metrics" aria-label="Μετρήσεις κάμψης">
      <div class="pvc-angle-gauge"><svg viewBox="0 0 100 100" aria-hidden="true"><path class="pvc-gauge-track" d="M16 79A63 63 0 0 1 79 16"/><path class="pvc-gauge-fill" pathLength="90" d="M16 79A63 63 0 0 1 79 16"/><path class="pvc-gauge-pipe" d="M27 79V62a35 35 0 0 1 35-35h17"/></svg><div><small>ΓΩΝΙΑ</small><output data-bend-angle>0.0°</output><span>στόχος 90°</span></div></div>
      <div class="pvc-radius">${icon('radius')}<div><small>ΑΚΤΙΝΑ</small><output data-bend-radius>—</output></div></div>
      <div class="pvc-bend-progress"><i></i></div>
      <div class="pvc-quantity" hidden><div class="pvc-quantity-title">${icon('pipe')}<small>ΠΟΣΟΤΗΤΑ</small></div><div class="pvc-quantity-stepper"><button type="button" data-bend-action="qty-less" aria-label="Μείωσε την ποσότητα">−</button><output data-bend-quantity>1</output><button type="button" data-bend-action="qty-more" aria-label="Αύξησε την ποσότητα">+</button></div><div class="pvc-quantity-presets"><button type="button" data-bend-action="qty-1" aria-label="Ετοίμασε μία σωλήνα">1</button><button type="button" data-bend-action="qty-5" aria-label="Ετοίμασε πέντε σωλήνες">5</button><button type="button" data-bend-action="qty-all" aria-label="Ετοίμασε όλες τις σωλήνες">ΟΛΕΣ</button></div></div>
    </aside><div class="pvc-bend-dock"><div class="pvc-bend-position"><span>ΖΩΝΗ ΚΑΜΨΗΣ</span><output data-bend-position></output><div class="pvc-bend-cells">${Array.from({length:PVC.cells},()=>'<i></i>').join('')}</div></div><div class="pvc-bend-actions">
      ${action('back','back','ΠΙΣΩ','A')}${action('forward','forward','ΜΠΡΟΣΤΑ','D')}${action('use','bend','ΛΥΓΙΣΕ','LMB')}${action('undo','undo','ΔΙΟΡΘΩΣΗ','Z')}${action('transparent','transparent','ΔΙΑΦΑΝΕΙΑ','R')}${action('confirm','confirm','ΕΛΕΓΧΟΣ','E')}${action('pause','pause','ΕΞΟΔΟΣ','ESC')}
    </div><p class="pvc-bend-notice" role="status" hidden></p></div>`;
    shell.append(this.root);
    const find=<T extends Element>(selector:string)=>this.root.querySelector<T>(selector)!;
    this.dial=find('.pvc-gauge-fill');this.angle=find('[data-bend-angle]');this.radius=find('[data-bend-radius]');this.progress=find('.pvc-bend-progress i');this.position=find('[data-bend-position]');this.quantity=find('[data-bend-quantity]');this.notice=find('.pvc-bend-notice');this.quantityPanel=find('.pvc-quantity');
    this.cells=[...this.root.querySelectorAll<HTMLElement>('.pvc-bend-cells i')];
    this.buttons=[...this.root.querySelectorAll<HTMLButtonElement>('[data-bend-action]')];
    this.use=find('[data-bend-action="use"]');this.confirm=find('[data-bend-action="confirm"]');
    for(const button of this.buttons){
      const name=button.dataset.bendAction!;
      if(name==='use'){
        button.addEventListener('pointerdown',event=>{if(button.disabled||event.button!==0)return;event.preventDefault();button.setPointerCapture(event.pointerId);hold(true);command('use');});
        for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>hold(false));
        button.addEventListener('keydown',event=>{if(!event.repeat&&['Space','Enter'].includes(event.code)){event.preventDefault();hold(true);command('use');}});
        button.addEventListener('keyup',event=>{if(['Space','Enter'].includes(event.code)){event.preventDefault();hold(false);}});
        button.addEventListener('blur',()=>hold(false));
      }else button.addEventListener('click',()=>command(name));
    }
  }
  update(show:boolean,phase:string,bend:PvcBend,quantity:number,raw:number,transparent:boolean,held:boolean,message:string):void{
    const active=show&&['spring','inserting','bending','review','extracting'].includes(phase);
    if(this.root.hidden!==!active)this.root.hidden=!active;
    if(!active){this.lastKey='';return;}
    const key=[phase,bend.revision,bend.mark,bend.grip,bend.angle,quantity,raw,transparent,held,message].join(':');
    if(key===this.lastKey)return;this.lastKey=key;this.root.dataset.phase=phase;this.root.dataset.ready=String(bend.ready);
    const review=phase==='review',bending=phase==='bending',spring=phase==='spring',animating=['inserting','extracting'].includes(phase);
    this.angle.textContent=`${bend.angle.toFixed(1)}°`;this.radius.textContent=bend.radius?`${Math.round(bend.radius*1000)} mm`:'— mm';
    this.dial.style.strokeDasharray=`${Math.min(90,bend.angle)} 90`;this.progress.style.width=`${Math.min(100,bend.angle/90*100)}%`;
    this.position.textContent=bending?`ΘΕΣΗ ${bend.grip+1} / ${PVC.cells}`:review?'ΕΤΟΙΜΗ ΓΩΝΙΑ':phase==='extracting'?'ΕΞΑΓΩΓΗ ΕΛΑΤΗΡΙΟΥ':'ΕΛΑΤΗΡΙΟ · 40 cm';
    this.cells.forEach((cell,i)=>{cell.classList.toggle('is-active',bending&&bend.grip===i);cell.classList.toggle('is-bent',bend.angles[i]>1);});
    this.quantityPanel.hidden=!review;this.quantity.textContent=String(quantity);
    for(const button of this.buttons){
      const name=button.dataset.bendAction!;
      button.hidden=['back','forward','undo'].includes(name)?!bending:name==='use'?!(spring||bending):name==='confirm'?!(bending||review):name.startsWith('qty-')?!review:false;
      button.disabled=animating&&name!=='pause'||name==='back'&&bend.grip===0||name==='forward'&&bend.grip===PVC.cells-1||name==='qty-less'&&quantity<=1||name==='qty-more'&&quantity>=raw;
      if(['qty-1','qty-5','qty-all'].includes(name))button.setAttribute('aria-pressed',String(quantity===Math.min(raw,name==='qty-all'?raw:Number(name.slice(4)))));
    }
    this.use.classList.toggle('is-held',held);this.use.setAttribute('aria-label',spring?'Κράτα για εισαγωγή ελατηρίου':'Κράτα για κάμψη στη φωτισμένη θέση');
    this.use.title=spring?'Κράτα · εισαγωγή ελατηρίου':'Κράτα · κάμψη στη φωτισμένη θέση';
    this.use.querySelector('svg')!.innerHTML=spring?paths.insert:paths.bend;
    this.use.querySelector('span')!.textContent=spring?'ΒΑΛΕ ΕΛΑΤΗΡΙΟ':'ΛΥΓΙΣΕ';
    this.confirm.querySelector('span')!.textContent=review?`ΕΤΟΙΜΑΣΕ ×${quantity}`:'ΕΛΕΓΧΟΣ';this.confirm.classList.toggle('is-primary',review||bend.ready);
    this.confirm.setAttribute('aria-label',review?`Ετοίμασε ${quantity} σωλήνες και κράτα μία`:'Έλεγξε τη γωνία κάμψης');
    this.confirm.title=review?`Ετοίμασε ${quantity} σωλήνες και κράτα μία · E`:'Έλεγχος γωνίας · E';
    const visibility=this.buttons.find(button=>button.dataset.bendAction==='transparent')!;visibility.setAttribute('aria-pressed',String(transparent));
    this.notice.hidden=!message||phase==='extracting';this.notice.textContent=message;
  }
}
