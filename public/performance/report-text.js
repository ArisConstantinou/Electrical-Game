// Share diagnosis without raw frame histories or embedded screenshots.
function bounded(value,depth=0){
 if(depth>8)return '[περιορισμός βάθους]';
 if(typeof value==='string')return value.startsWith('data:')?'[εικόνα στην πλήρη αναφορά]':value.slice(0,2400);
 if(Array.isArray(value))return value.slice(0,100).map(v=>bounded(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='dataURL').slice(0,80).map(([k,v])=>[k,bounded(v,depth+1)]));
 return value;
}
export function reportText(report,summary=''){
 const json=v=>JSON.stringify(bounded(v))??'μη διαθέσιμο',device=report.device??{};
 const lines=[`Electrical-Game benchmark · ${report.recorderVersion??'προηγούμενη έκδοση'}`,`Ημερομηνία: ${report.createdAt??'μη διαθέσιμη'}`,device.userAgent??'Συσκευή: μη διαθέσιμη',`${device.backend??'μη διαθέσιμο'} · ${device.canvas?.width??'?'}×${device.canvas?.height??'?'}`,`Έκδοση παιχνιδιού: ${(report.buildScripts??[]).join(', ')}`,summary,`Διαδρομή: ${report.outcome} · ${report.tour?.reached??0}/${report.tour?.total??0}`,`Κάλυψη: ${json(report.coverage)}`,`Δυνατότητες μετρήσεων: ${json(report.support)}`,'Περιοχές:'];
 for(const [label,s] of Object.entries(report.byArea??{}).slice(0,80))lines.push(`${label}: ${s.fps} FPS, ελάχιστο ${s.minInstantFPS}, P95 ${s.p95Ms} ms, max ${s.maxMs} ms`);
 lines.push('Πρώτο / δεύτερο πέρασμα (ίδιος χώρος και σάρωση κάμερας):');
 for(const visit of (report.visitComparison??[]).slice(0,40))lines.push(`${visit.label}: ${(visit.passes??[]).map(p=>`${p.pass}: ${p.frames?`${p.frames.fps} FPS, P95 ${p.frames.p95Ms} ms, max ${p.frames.maxMs} ms, CPU P95 ${p.cpu?.p95Ms??'?'} ms, υποβολή P95 ${p.renderSubmission?.p95Ms??'?'} ms`:'δεν μετρήθηκε'}`).join(' / ')} · ΔP95 ${visit.p95ChangeMs??'?'} ms`);
 lines.push(`Επιβάρυνση καταγραφέα: ${json(report.overhead)}`,`Λήψεις: ${json(report.capture)}`,`Φόρτωση: ${json(report.loading)}`,`Ρυθμίσεις: ${json(report.settings)}`,`Χειρότερα παράθυρα: ${json({ms500:report.worst500ms,ms1000:report.worst1000ms,longestGapMs:report.longestPresentationGapMs})}`,`Λειτουργικοί έλεγχοι: ${json(report.functional)}`,`Διάγνωση: ${json(report.finalState)}`,`Σφάλματα: ${json(report.errors)}`,`Αλλαγές ορατότητας: ${json((report.events??[]).filter(e=>['hidden','visible','freeze','resume'].includes(e.type)))}`,`Κενά καρέ: ${json([...(report.diagnostics??[])].filter(d=>d.gapMs>=100).sort((a,b)=>b.gapMs-a.gapMs).slice(0,8))}`,`Πόροι στα άκρα περασμάτων: ${json((report.resourceSamples??[]).filter(s=>s.kind!=='periodic'))}`,`Αργότερα καρέ: ${json((report.slowestFrames??[]).slice(0,20))}`,`Ευρήματα: ${json(report.findings)}`,'Συνοπτικό κείμενο: χωρίς πλήρες ιστορικό καρέ ή εικόνες. Η πλήρης αναφορά παραμένει αποθηκευμένη στη συσκευή.');
 const text=lines.join('\n');
 return text.length<=96000?text:text.slice(0,95000)+'\n[Το συνοπτικό κείμενο έφτασε το όριο. Τα υπόλοιπα στοιχεία βρίσκονται στην πλήρη αναφορά.]';
}
