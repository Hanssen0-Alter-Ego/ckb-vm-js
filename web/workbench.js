import { rawNumber } from './lossless-json.js';
import { headerHash } from './header-hash.js';
import { headerCandidates, linkExistingHeader, addHeaderFromFields, setHeaderExtension } from './header-model.js';
import { ckb, ckbToHex } from './guided.js';
import { resolveCell, scriptChoices, scriptGroupCandidates, inspectRequest, diagnosticMatchesCell, mutateCellList, decimalToRpc, rpcToDecimal, addDependencyCell, changeDependencyReference, changeInputReference, scriptName } from './workbench-model.js';

// The JSON request is the source of truth. Each edit changes only its target field.
export function createWorkbench(root, { read, write, edited, capture, restore }) {
  let disabled = false;
  let selection = null;
  let sessionBaseline = null;
  const expanded = new Set();
  let restoreFocus;
  const identities={inputs:[],outputs:[]};
  let nextIdentity=1;
  const resolvedIds=new Map();
  const placeholderPoints=new Set();
  let witnessNotice='';
  const scriptIds=new Map();
  const draftNames=new Map();
  let nextDraft=0;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (label, action, parent) => { const b = el('button', label, 'secondary'); b.type = 'button'; b.disabled = disabled; b.onclick = () => { if (valid()) { try { action(); } catch (e) { error.textContent = e.message; } } }; parent.append(b); return b; };
  const commit = (fn, render = true) => { const next = structuredClone(read()); fn(next); write(next); if (render && ![...root.querySelectorAll('input,textarea,select')].some(n => !n.checkValidity())) refresh(); };
  function field(parent, label, value, apply, { area = false, options, parse = v => v } = {}) {
    const visibleLabel=label.replace(/^(?:Input|Output|Cell dep) index \d+ /,'');
    const wrap = el('label', visibleLabel, 'wb-field');
    const input = el(options ? 'select' : area ? 'textarea' : 'input');
    if (options) for (const [v, title] of options) { const o = el('option', title); o.value = v; input.append(o); }
    input.value = value ?? ''; input.disabled = disabled; input.spellcheck = false; input.setAttribute('aria-label', label);
    input.oninput = () => { edited(); try { const v=parse(input.value); input.setCustomValidity(''); commit(r=>apply(r,v),false); error.textContent=''; } catch(e) { input.setCustomValidity(e.message); error.textContent = `${label}: ${e.message}`; } updateDraftControl(); };
    input.onchange = () => {
      try { const v = parse(input.value); commit(r => apply(r, v), false); }
      catch (e) { input.setCustomValidity(e.message); error.textContent = `${label}: ${e.message}`; }
      updateDraftControl();
    };
    wrap.append(input); parent.append(wrap); return input;
  }
  function valid() { const pending=root.querySelector('.header-draft[data-pending="true"]');if(pending){error.textContent='Apply or cancel the header draft before saving.';pending.querySelector('input')?.focus();return false;}const bad = [...root.querySelectorAll('input,textarea,select')].find(n => !n.checkValidity()); if (bad) { bad.reportValidity(); return false; } return true; }
  function updateDraftControl(){}
  let error;
  function script(parent, title, value, getOutput, key, request) {
    const details = el('details'); details.append(el('summary',key==='type'&&!value?`${title} · none`:title));if(key==='lock')details.dataset.defaultOpen='true';parent.append(details);
    if (!value) { if(key==='lock')details.append(el('p','Required lock is missing.','wb-error'));button(`Add ${title}`, () => commit(r => { getOutput(r)[key] = structuredClone(scriptChoices(r)[0] ?? {code_hash:`0x${'0'.repeat(64)}`,hash_type:'data2',args:'0x'}); }), details); return; }
    const marker=scriptMarker(value);details.append(el('p',`${scriptName(value)}${marker?` · ${marker.id}`:''}`,'script-identity'));
    const reference=el('details');reference.append(el('summary',`${title} code reference`));details.append(reference);
    const choices = scriptChoices(request);
    const selector = el('select'); selector.setAttribute('aria-label', `${title} · use existing script`); selector.disabled = disabled;
    const empty = el('option','Use an existing script…'); empty.value = ''; selector.append(empty);
    choices.forEach((s,i) => {const o=el('option',`${i+1} · ${s.hash_type} · ${s.code_hash.slice(0,16)}… · args ${s.args}`);o.value=String(i);selector.append(o);});
    selector.onchange=()=>{if(selector.value!=='')commit(r=>{getOutput(r)[key]=structuredClone(choices[Number(selector.value)]);});};reference.append(selector);
    field(reference,`${title} code_hash`,value.code_hash,(r,v)=>{getOutput(r)[key].code_hash=v;});
    const hashTypes=['data','data1','data2','type'];
    const group=el('div',undefined,'hash-type-group');group.setAttribute('role','radiogroup');group.setAttribute('aria-label',`${title} hash_type`);group.dataset.scriptGroup=title;
    reference.append(el('p','Hash type','hint'),group);
    hashTypes.forEach((option,index)=>{const b=el('button',option,'secondary');b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(value.hash_type===option));b.tabIndex=value.hash_type===option||(!hashTypes.includes(value.hash_type)&&index===0)?0:-1;b.dataset.choice=option;b.disabled=disabled;
      const choose=()=>{if(!valid())return;commit(q=>{getOutput(q)[key].hash_type=option;});root.querySelector(`[data-script-group="${title}"] [data-choice="${option}"]`)?.focus();};b.onclick=choose;
      b.onkeydown=e=>{if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();const next=(index+(['ArrowRight','ArrowDown'].includes(e.key)?1:3))%4;group.querySelectorAll('button')[next].click();}};group.append(b);
    });
    if(!hashTypes.includes(value.hash_type))details.append(el('p',`Unrecognized hash type: ${String(value.hash_type)}. Retained until you select a value.`,'wb-error'));
    field(details,`${title} args`,value.args,(r,v)=>{getOutput(r)[key].args=v;});
    if(key==='type')button('Remove type script',()=>commit(r=>{getOutput(r).type=null;}),details);
  }
  function cellFields(parent,title,cell,getOutput,setData,request){
    if(!cell?.output){parent.append(el('p','Missing or ambiguous resolved cell. Supply a unique context.cells entry in JSON.','wb-error'));return;}
    let capacity;try{capacity=ckb(cell.output.capacity);}catch{capacity='';}
    field(parent,`${title} capacity (CKB)`,capacity,(q,v)=>{getOutput(q).capacity=v;},{parse:ckbToHex});
    script(parent,`${title} lock`,cell.output.lock,getOutput,'lock',request);
    script(parent,`${title} type`,cell.output.type,getOutput,'type',request);
    field(parent,`${title} data (hex)`,cell.data,setData,{area:true});
  }
  function identityKey(point){return point&&typeof point.tx_hash==='string'&&typeof point.index==='string'?`${point.tx_hash.toLowerCase()}:${point.index.toLowerCase()}`:null;}
  function resolvedIdentity(point){
    const key=identityKey(point);
    if(!key)return 'Unresolved';if(!resolvedIds.has(key))resolvedIds.set(key,`C${nextIdentity++}`);return resolvedIds.get(key);
  }
  function scriptMarker(value){
    if(!value||typeof value.code_hash!=='string'||typeof value.hash_type!=='string'||typeof value.args!=='string')return null;
    const key=[value.code_hash.toLowerCase(),value.hash_type,value.args.toLowerCase()].join(':');
    if(!scriptIds.has(key))scriptIds.set(key,scriptIds.size+1);const n=scriptIds.get(key);
    return {id:`Script ${n}`,short:value.code_hash.slice(2,8),color:['#a8d98d','#9db7ff','#ffcb86','#dca8eb','#82d5ca','#eea1ad'][(n-1)%6]};
  }
  function draftName(identity){
    if(!draftNames.has(identity)){let n=nextDraft++, label='';do{label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26)-1;}while(n>=0);draftNames.set(identity,`Draft output ${label}`);}
    return draftNames.get(identity);
  }
  function outpointName(point,request){
    const hash=typeof point?.tx_hash==='string'?point.tx_hash:'';const index=typeof point?.index==='string'?point.index:'';
    if(!/^0x[0-9a-f]{64}$/i.test(hash)||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(index))return 'Outpoint unavailable or invalid';
    const refs=[...(Array.isArray(request?.transaction?.inputs)?request.transaction.inputs.map(x=>x?.previous_output):[]),...(Array.isArray(request?.transaction?.cell_deps)?request.transaction.cell_deps.map(x=>x?.out_point):[]),...(Array.isArray(request?.context?.cells)?request.context.cells.map(x=>x?.out_point):[])];
    let n=6;const signature=(h)=>`${h.slice(0,n+2).toLowerCase()}…${h.slice(-n).toLowerCase()}`;
    while(n<32&&refs.some(x=>typeof x?.tx_hash==='string'&&typeof x?.index==='string'&&x.index.toLowerCase()===index.toLowerCase()&&x.tx_hash.toLowerCase()!==hash.toLowerCase()&&signature(x.tx_hash)===signature(hash)))n+=2;
    const short=n>=32?hash:`${hash.slice(0,n+2)}…${hash.slice(-n)}`;
    return `${placeholderPoints.has(identityKey(point))?'Local placeholder outpoint':'Outpoint'} ${short}:${index}`;
  }
  function cellPreview(cell,description,index,kind,onClick,point){
    const b=el('button',undefined,'cell-preview');b.type='button';b.disabled=disabled;b.onclick=onClick;
    b.append(el('span',`${kind} index ${index}`,'cell-number'),el('span',description,'cell-identity'));
    if(description.startsWith('Draft output '))b.querySelector('.cell-identity').title='Local label for this editing session; this output does not yet have an outpoint.';else if(point&&typeof point.tx_hash==='string'&&typeof point.index==='string')b.querySelector('.cell-identity').title=`${point.tx_hash}:${point.index}`;
    let capacity='Invalid capacity';try{capacity=`${ckb(cell.output.capacity)} CKB`;}catch{}
    b.append(el('strong',capacity,capacity.length>17?'capacity-long':undefined));const meta=el('span',undefined,'cell-meta');
    for(const kind of ['lock','type']){
      const value=cell?.output?.[kind], marker=scriptMarker(value), name=kind==='lock'?'Lock':'Type script', absent=kind==='type'&&value===null;
      const chip=el('span',marker?`${name} ${scriptName(value)} · ${marker.id}`:absent?'Type script · none':`${name} ?`,absent?'script-chip no-type':'script-chip');
      if(marker){chip.style.setProperty('--script',marker.color);if(kind==='lock')b.style.setProperty('--script',marker.color);}
      meta.append(chip);
    }
    const data=cell?.data;meta.append(el('span',typeof data==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(data)?`${(data.length-2)/2} B data`:'Invalid data'));b.append(meta);return b;
  }
  function changeCells(kind,action,index=0){
    const next=mutateCellList(read(),kind,action,index);
    const ids=identities[kind];
    if(action==='add'||action==='duplicate')ids.push(kind==='inputs'?resolvedIdentity(next.transaction.inputs.at(-1).previous_output):`C${nextIdentity++}`);
    else if(action==='remove')ids.splice(index,1);
    else {const to=index+(action==='up'?-1:1);[ids[index],ids[to]]=[ids[to],ids[index]];}
    write(next);
    if(kind==='inputs'){
      if(action==='add'||action==='duplicate')placeholderPoints.add(identityKey(next.transaction.inputs.at(-1).previous_output));
      if(Array.isArray(next.transaction.witnesses)&&next.transaction.witnesses.length){
        const witnesses=next.transaction.witnesses;const moved=action==='up'||action==='down';const to=index+(action==='up'?-1:1);
        const positions=moved?[Math.min(index,to),Math.max(index,to)]:[];
        const detail=positions.map(i=>{const point=next.transaction.inputs[i]?.previous_output;const witness=witnesses[i];const value=typeof witness==='string'?(witness.length>18?`${witness.slice(0,18)}…`:witness):'invalid value';return `Input index ${i}: ${outpointName(point,next)}; witness index ${i}: ${i<witnesses.length?value:'not supplied'}.`;}).join(' ');
        witnessNotice=`${moved?`Input moved from index ${index} to ${to}. `:'Input list changed. '}Witnesses stayed in their original positions and were not edited. ${detail} Same-position entries are not guaranteed pairs; script-group relationships may differ.`;
      } else witnessNotice='';
    }
    if(action==='up')selection=selection?`${kind}:${index-1}`:null;
    else if(action==='down')selection=selection?`${kind}:${index+1}`:null;
    else if(action==='remove')selection=null;
    refresh();
  }
  function referenceFields(parent,label,point,cell,index,kind){
    const ref=el('details');ref.append(el('summary','Reference & origin'));parent.append(ref);
    ref.append(el('p',cell?'Changing this reference updates the resolved cell and every input or cell dep that refers to it.':'No unique resolved cell matches. Applying a reference changes only this entry.','hint'));
    ref.append(el('p','Changing the reference does not fetch or authenticate the cell or its origin. Review the supplied cell data.','hint'));
    if(cell?.transaction_info===null)ref.append(el('p','The supplied origin remains unconfirmed (null).','hint'));
    if(point && typeof point==='object' && !Array.isArray(point)) {
      const refField=(name,value)=>{const wrap=el('label',name.replace(/^(?:Input|Output|Cell dep) index \d+ /,''),'wb-field');const input=el('input');input.value=typeof value==='string'?value:'';input.setAttribute('aria-label',name);input.spellcheck=false;wrap.append(input);ref.append(wrap);return input;};
      const hash=refField(`${label} transaction hash`,point.tx_hash);const outputIndex=refField(`${label} output index (RPC hex)`,point.index);
      const initialHash=hash.value, initialIndex=outputIndex.value;const pending=()=>{const message=hash.value!==initialHash||outputIndex.value!==initialIndex?'Apply the reference or cancel changes before saving.':'';hash.setCustomValidity(message);outputIndex.setCustomValidity(message);};hash.oninput=pending;outputIndex.oninput=pending;
      const apply=el('button','Apply reference','secondary');apply.type='button';apply.onclick=()=>{const bad=[...root.querySelectorAll('input,textarea,select')].find(n=>n!==hash&&n!==outputIndex&&!n.checkValidity());if(bad){bad.reportValidity();return;}try{const nextPoint={tx_hash:hash.value,index:outputIndex.value};const identity=cell?resolvedIdentity(point):null;const oldKey=identityKey(point),newKey=identityKey(nextPoint);write((kind==='input'?changeInputReference:changeDependencyReference)(read(),index,nextPoint));if(identity){resolvedIds.delete(oldKey);resolvedIds.set(newKey,identity);}if(oldKey!==newKey)placeholderPoints.delete(oldKey);refresh();}catch(e){error.textContent=e.message;}};ref.append(apply);
    } else ref.append(el('p','Reference is not an object; repair this malformed value in JSON.','wb-error'));
    return ref;
  }
  function refresh(resetIdentity=false) {
    if(resetIdentity){identities.inputs=[];identities.outputs=[];resolvedIds.clear();draftNames.clear();placeholderPoints.clear();witnessNotice='';nextDraft=0;selection=null;sessionBaseline=null;}
    const opened = new Set([...root.querySelectorAll('details[open]')].map(d => d.querySelector('summary')?.textContent));
    const activeLabel = root.querySelector('dialog[open]')?.contains(document.activeElement) ? document.activeElement.closest('label')?.firstChild?.textContent : null;
    root.querySelector('dialog')?.close();
    root.replaceChildren(); error=el('p','','wb-error');error.setAttribute('role','alert');root.append(error);
    let r;
    try {r=read(); if(!r.transaction || !r.context || !Array.isArray(r.context.cells))throw new Error('Expected transaction and context.cells. Edit JSON to supply this structure.');}
    catch(e){error.textContent=`Structured editor unavailable: ${e.message}. Your JSON is retained unchanged.`;return;}
    const report=inspectRequest(r);
    root.append(el('p',`Inputs ${report.inputTotal ?? 'unknown'} CKB → Outputs ${report.outputTotal ?? 'unknown'} CKB`, 'wb-totals'));
    if(report.inputTotal!==null && report.outputTotal!==null) {
      try {const difference=BigInt(ckbToHex(report.inputTotal))-BigInt(ckbToHex(report.outputTotal));root.append(el('p',`Capacity difference: ${ckb(difference)} CKB (not a verified fee).`,'hint'));}catch{}
    }
    const messages=el('ul',undefined,'wb-diagnostics');
    for(const d of report.diagnostics)messages.append(el('li',`${d.path}: ${d.message}`));root.append(messages);
    root.append(el('p','Preflight hints are not VM results. Invalid byte strings and deliberately broken references remain unchanged until you edit them.','hint'));
    field(root,'Maximum cycles (decimal)',rpcToDecimal(r.max_cycles),(q,v)=>{q.max_cycles=v;},{parse:decimalToRpc});
    for(const kind of ['inputs','outputs']) {
      const section=el('section',undefined,'wb-section');section.append(el('h3',kind==='inputs'?'Input cells':'Output cells'));root.append(section);
      if(!Array.isArray(r.transaction[kind])) {section.append(el('p',`${kind} is not an array. Correct it in JSON.`));continue;}
      r.transaction[kind].forEach((item,i)=>{
        const card=el('article',undefined,'wb-card');card.append(el('h4',`${kind==='inputs'?'Input':'Output'} index ${i}`));section.append(card);
        const tools=el('div',undefined,'wb-tools');card.append(tools);
        for(const [action,label] of [['duplicate','Copy'],['remove','Remove']])button(label,()=>{try{changeCells(kind,action,i);}catch(e){error.textContent=e.message;}},tools);
        if (!item || typeof item !== 'object' || Array.isArray(item)) { card.append(el('p','Invalid cell entry. Correct this entry in JSON.','wb-error')); return; }
        const input=kind==='inputs';
        const cell=input?resolveCell(r,item?.previous_output):{output:item,data:r.transaction.outputs_data?.[i]};
        const getCell=q=>input?resolveCell(q,q.transaction.inputs[i].previous_output):null;
        const getOutput=q=>input?getCell(q).output:q.transaction.outputs[i];
        cellFields(card,`${input?'Input':'Output'} index ${i}`,cell,getOutput,(q,v)=>{if(input)getCell(q).data=v;else q.transaction.outputs_data[i]=v;},r);
        if(input){const advanced=el('details');advanced.append(el('summary','Advanced · since & reference'));card.append(advanced);field(advanced,`Input index ${i} since (RPC hex)`,item.since,(q,v)=>{q.transaction.inputs[i].since=v;});referenceFields(advanced,`Input index ${i}`,item.previous_output,cell,i,'input');}
      });
      button(`Add ${kind==='inputs'?'input':'output'}`,()=>{try{changeCells(kind,'add');}catch(e){error.textContent=e.message;}},section);
      if(kind==='inputs')section.append(el('p','Adding or copying creates a synthetic, unconfirmed cell with a unique outpoint. Existing cells and witness positions are not rewritten.','hint'));
    }
    const witnesses=el('section',undefined,'wb-section');witnesses.append(el('h3','Witnesses'),el('p','Witnesses hold extra script data, such as signatures. Their positions do not always pair one-to-one with inputs.','hint'));root.append(witnesses);
    if(Array.isArray(r.transaction.witnesses)) {
      r.transaction.witnesses.forEach((v,i)=>{const row=el('article',undefined,'witness-editor');witnesses.append(row);field(row,`Witness index ${i} (hex)`,v,(q,x)=>{q.transaction.witnesses[i]=x;},{area:true});button(`Remove witness index ${i}`,()=>commit(q=>{q.transaction.witnesses.splice(i,1);selection='witnesses';}),row);});
      button('Add witness',()=>commit(q=>{q.transaction.witnesses.push('0x');}),witnesses);
    } else witnesses.append(el('p','witnesses must be an array; edit JSON.','wb-error'));
    const deps=el('section',undefined,'wb-section');deps.append(el('h3','Cell deps'));root.append(deps);
    if(Array.isArray(r.transaction.cell_deps)) {
      r.transaction.cell_deps.forEach((dep,i)=>{
        const row=el('article',undefined,'wb-card');deps.append(row);
        if(!dep||typeof dep!=='object'||Array.isArray(dep)){row.append(el('p','Invalid cell dep. Correct this entry in JSON.','wb-error'));return;}
        field(row,`Cell dep index ${i} kind`,dep.dep_type,(q,v)=>{q.transaction.cell_deps[i].dep_type=v;},{options:[['code','Code'],['dep_group','Dep group']]});
        const cell=resolveCell(r,dep.out_point);const get=q=>resolveCell(q,q.transaction.cell_deps[i].out_point);
        cellFields(row,`Cell dep index ${i}`,cell,q=>get(q).output,(q,v)=>{get(q).data=v;},r);
        const ref=referenceFields(row,`Cell dep index ${i}`,dep.out_point,cell,i,'dep');
        if(cell)structuredFields(ref,cell.transaction_info,['context','cells',String(r.context.cells.indexOf(cell)),'transaction_info'],'Origin');
        row.append(el('p','Edits affect this shared resolved cell wherever referenced. Removing a dep does not delete context. Dep-group membership bytes are never rewritten automatically.','hint'));
        button(`Remove cell dep index ${i}`,()=>commit(q=>{q.transaction.cell_deps.splice(i,1);selection='deps';}),row);
      });
      button('New resolved cell',()=>{const next=addDependencyCell(read());write(next);placeholderPoints.add(identityKey(next.transaction.cell_deps.at(-1).out_point));selection=`dep:${next.transaction.cell_deps.length-1}`;refresh();},deps);
      const select=el('select');select.disabled=disabled;select.setAttribute('aria-label','Resolved cell to add as dependency');r.context.cells.forEach((c,i)=>{const o=el('option',`${i+1} · ${c?.out_point?.tx_hash}:${c?.out_point?.index}`);o.value=String(i);select.append(o);});deps.append(select);
      button('Add selected cell as code dependency',()=>commit(q=>{const c=q.context.cells[Number(select.value)];if(!c?.out_point)throw new Error('Select a resolved cell with an outpoint.');q.transaction.cell_deps.push({out_point:structuredClone(c.out_point),dep_type:'code'});}),deps);
    }
    deps.append(el('p','Only supplied resolved cells are listed. This does not infer code hashes or expand dep groups. JSON remains available for custom binaries, hashes and context.','hint'));
    const group=el('details');group.append(el('summary','Verification scope'));root.append(group);
    group.append(el('p','Choose a script group to verify, or verify the full transaction. A script hash identifies the complete script: code hash, hash type and args. It is different from the code hash.','hint'));
    const candidates=scriptGroupCandidates(r);const chooserLabel=el('label','Script group from this snapshot','wb-field');const chooser=el('select');chooser.setAttribute('aria-label','Script group from this snapshot');const empty=el('option','Choose a group…');empty.value='';chooser.append(empty);
    const list=indices=>indices.length?indices.map(i=>`index ${i}`).join(', '):'none';
    candidates.forEach((candidate,i)=>{const marker=scriptMarker(candidate.script);const option=el('option',`${candidate.group_type==='lock'?'Lock':'Type'} · inputs ${list(candidate.input_indices)} · outputs ${list(candidate.output_indices)} · ${marker?.id??'script'}`);option.value=String(i);chooser.append(option);});
    chooser.disabled=disabled||!candidates.length;chooser.dataset.boundary=String(!candidates.length);chooserLabel.append(chooser);group.append(chooserLabel);
    const candidateInfo=el('p',candidates.length?'Select a group to see its calculated script hash. The request changes only after you use it.':'No group could be derived from the supplied cells and scripts. You can enter a script hash manually.','hint');group.append(candidateInfo);
    group.append(el('p','Candidates come from supplied inputs and outputs. Missing or invalid cells and scripts are excluded; the engine makes the final decision.','hint'));
    const use=button('Use selected group',()=>{const candidate=candidates[Number(chooser.value)];if(chooser.value===''||!candidate)throw new Error('Choose a script group first.');commit(q=>{const prior=q.script_group&&typeof q.script_group==='object'&&!Array.isArray(q.script_group)?q.script_group:{};q.script_group={...prior,group_type:candidate.group_type,script_hash:candidate.script_hash};});},group);use.disabled=true;use.dataset.boundary='true';
    chooser.onchange=()=>{const candidate=chooser.value===''?null:candidates[Number(chooser.value)];use.dataset.boundary=String(!candidate);use.disabled=disabled||!candidate;candidateInfo.textContent=candidate?`Calculated script hash: ${candidate.script_hash}. ${candidate.group_type==='lock'?'Lock':'Type'} group; inputs ${list(candidate.input_indices)}; outputs ${list(candidate.output_indices)}.`:'Select a group to see its calculated script hash. The request changes only after you use it.';};
    const existing=r.script_group&&typeof r.script_group==='object'&&!Array.isArray(r.script_group);
    if(existing){
      if(!['lock','type'].includes(r.script_group.group_type))group.append(el('p','The stored group kind is invalid; choose Lock or Type or edit JSON.','wb-error'));
      const kindOptions=[['lock','Lock'],['type','Type']];if(typeof r.script_group.group_type==='string'&&!['lock','type'].includes(r.script_group.group_type))kindOptions.unshift([r.script_group.group_type,`Unrecognized: ${r.script_group.group_type}`]);
      const kind=field(group,'Group kind',r.script_group.group_type,(q,v)=>{q.script_group.group_type=v;},{options:kindOptions});const hash=field(group,'Script hash',r.script_group.script_hash,(q,v)=>{q.script_group.script_hash=v;});const status=el('p','','hint');group.append(status);
      const showStatus=()=>{const value=hash.value,validHash=/^0x[0-9a-f]{64}$/i.test(value),known=candidates.some(c=>c.group_type===kind.value&&c.script_hash.toLowerCase()===value.toLowerCase());status.className=validHash?'hint':'wb-error';status.textContent=!validHash?'Script hash must be 32 bytes of hex. This is not the code hash; invalid text remains in the request.':known?'This hash matches a candidate from the supplied snapshot.':'No matching group was derived from the supplied snapshot. Check the group kind, full script hash and supplied cells; the value is retained.';};
      const priorHashInput=hash.oninput;hash.oninput=e=>{priorHashInput(e);showStatus();};const priorKindChange=kind.onchange;kind.onchange=e=>{priorKindChange(e);showStatus();};showStatus();button('Verify full transaction instead',()=>commit(q=>{delete q.script_group;}),group);
    }else{
      if(r.script_group!==undefined)group.append(el('p','The stored script group is malformed. Using a candidate or manual group will explicitly replace it.','wb-error'));
      const manual=el('details');manual.append(el('summary','Enter a script hash manually'));group.append(manual);const kindLabel=el('label','Group kind','wb-field');const kind=el('select');kind.setAttribute('aria-label','Manual group kind');for(const [v,label] of [['lock','Lock'],['type','Type']]){const option=el('option',label);option.value=v;kind.append(option);}kindLabel.append(kind);manual.append(kindLabel);const hashLabel=el('label','Script hash','wb-field');const hash=el('input');hash.setAttribute('aria-label','Manual script hash');hash.spellcheck=false;hashLabel.append(hash);manual.append(hashLabel);const status=el('p','Enter a 32-byte script hash, not a code hash. The request changes only after you use it.','hint');manual.append(status);hash.oninput=()=>{status.className=/^0x[0-9a-f]{64}$/i.test(hash.value)?'hint':'wb-error';status.textContent=/^0x[0-9a-f]{64}$/i.test(hash.value)?'This value will be used as the script hash.':'Script hash must be 32-byte hex. You may still use this value to test an invalid request.';};button('Use manual group',()=>commit(q=>{q.script_group={group_type:kind.value,script_hash:hash.value};}),manual);
      if(r.script_group!==undefined)button('Verify full transaction instead',()=>commit(q=>{delete q.script_group;}),group);
    }
    overview(r, report);
    if(activeLabel) [...root.querySelectorAll('dialog label')].find(n=>n.firstChild?.textContent===activeLabel)?.querySelector('input,select,textarea')?.focus();
    root.querySelectorAll('details').forEach(d => { d.open = opened.has(d.querySelector('summary')?.textContent)||d.dataset.defaultOpen==='true'; });
  }
  function structuredFields(parent,value,path,label) {
    const raw = rawNumber(value);
    if (raw !== null) { parent.append(el('p', `${label}: ${raw} (edit this exact JSON number in JSON)`, 'hint')); return; }
    const set=(q,v)=>{let target=q;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]=v;};
    if(value===undefined||value===null){parent.append(el('p',`${label}: ${value===null?'null (explicit absence)':'not supplied'}`,'hint'));if(value===null&&path.at(-1)==='data')button('Supply extension bytes',()=>commit(q=>set(q,'0x')),parent);return;}
    if(typeof value==='object'){
      const entries=Object.entries(value);
      if(!entries.length)parent.append(el('p',Array.isArray(value)?'No entries':'No fields','hint'));
      entries.forEach(([key,v])=>{
        const name=Array.isArray(value)?`${label} ${Number(key)+1}`:key.replaceAll('_',' ');
        if(v!==null&&typeof v==='object'){const details=el('details');details.append(el('summary',name));parent.append(details);structuredFields(details,v,[...path,key],name);}
        else structuredFields(parent,v,[...path,key],name);
      });
      if(Array.isArray(value)&&path.join('.')==='context.headers')button('Add header from tip template',()=>commit(q=>{if(!q.context.tip_header||typeof q.context.tip_header!=='object'||Array.isArray(q.context.tip_header))throw new Error('Supply a valid tip-header template first.');q.context.headers.push(structuredClone(q.context.tip_header));}),parent);
      if(Array.isArray(value)&&path.join('.')==='context.extensions')button('Add extension entry',()=>commit(q=>{q.context.extensions.push({block_hash:`0x${'0'.repeat(64)}`,data:null});}),parent);
      if(path.length===3&&['headers','extensions'].includes(path[1]))button(`Remove ${label}`,()=>commit(q=>{q.context[path[1]].splice(Number(path[2]),1);}),parent);
      return;
    }
    const key=path.at(-1);
    const decimalKeys=new Set(['max_block_bytes','max_block_cycles','median_time_block_count','starting_block_limiting_dao_withdrawing_lock','closest','farthest','tx_version','version','number','timestamp','nonce','compact_target','transaction_index']);
    const numeric=typeof value==='string'&&(decimalKeys.has(key)||/^rfc[0-9]+_epoch$/.test(key));
    const bits=key==='nonce'?128:['version','tx_version','compact_target','transaction_index'].includes(key)?32:64;
    if(numeric)field(parent,`${label} (decimal)`,rpcToDecimal(value),set,{parse:v=>decimalToRpc(v,bits)});
    else if(typeof value==='boolean')field(parent,label,String(value),set,{options:[['true','true'],['false','false']],parse:v=>v==='true'});
    else if(typeof value==='number')field(parent,label,String(value),set,{parse:v=>{const n=Number(v);if(v.trim()===''||!Number.isFinite(n)||!Number.isSafeInteger(n))throw new Error('Use a safe whole JSON number; large quantities must be RPC hex strings.');return n;}});
    else field(parent,label,value,set,{area:typeof value==='string'&&value.length>130});
    if(path[1]==='extensions'&&key==='data')button('Set no extension (null)',()=>commit(q=>set(q,null)),parent);
  }
  function overview(r, report) {
    const source = [...root.children];
    const sections = [...root.querySelectorAll(':scope > .wb-section')];
    const [inputs, outputs, witnesses, deps] = sections;
    const scope = source.find(n => n.tagName === 'DETAILS');
    const cycles = source.find(n => n.classList.contains('wb-field'));
    const diagnostics = source.find(n => n.classList.contains('wb-diagnostics'));
    const total = source.find(n => n.classList.contains('wb-totals'));
    const delta = source.find(n => n.classList.contains('hint'));
    const editors = new Map();
    const snapshot = el('div',undefined,'snapshot');
    const heading = el('div',undefined,'snapshot-heading');
    heading.append(total, el('span',r.script_group ? 'Selected group' : 'Full transaction','scope-badge'));
    snapshot.append(heading);
    if(delta) snapshot.append(delta);
    snapshot.append(el('p','Script numbers identify matching scripts; colors help distinguish them and may repeat. Neither indicates verification or chain validity. Outpoint chain status is not checked.','hint script-legend'));
    const columns = el('div',undefined,'cell-columns'); snapshot.append(columns);
    const choices = scriptChoices(r);
    const scriptId = value => { const index=choices.findIndex(s=>String(s.code_hash).toLowerCase()===String(value?.code_hash).toLowerCase()&&s.hash_type===value?.hash_type&&String(s.args).toLowerCase()===String(value?.args).toLowerCase()); return index<0?'?':String(index+1); };
    for (const [kind, section] of [['inputs',inputs],['outputs',outputs]]) {
      const column = el('section',undefined,'cell-column'); columns.append(column);
      const list = r.transaction[kind];
      column.append(el('h2',`${kind==='inputs'?'Inputs':'Outputs'} · ${Array.isArray(list)?list.length:'invalid'}`));
      if(kind==='inputs'&&witnessNotice){const notice=el('p',witnessNotice,'hint witness-notice');notice.setAttribute('role','status');column.append(notice);}
      const cards=[...section.querySelectorAll(':scope > .wb-card')];
      while(identities[kind].length<cards.length){const i=identities[kind].length;let identity=kind==='inputs'?resolvedIdentity(r.transaction.inputs[i]?.previous_output):`C${nextIdentity++}`;if(identities[kind].includes(identity))identity=`C${nextIdentity++}`;identities[kind].push(identity);}
      identities[kind].length=cards.length;
      if(!Array.isArray(list)) column.append(el('p',`${kind} must be an array. Open JSON to repair.`, 'wb-error'));
      const items=Array.isArray(list)?list:[];
      cards.forEach((editor,i)=> {
        const key=`${kind}:${i}`, name=kind==='inputs'?'Input':'Output', identity=identities[kind][i];
        const description=kind==='inputs'?outpointName(items[i]?.previous_output,r):draftName(identity);
        editors.set(key,[`${name} index ${i}`,editor,description,kind==='inputs'?items[i]?.previous_output:null]);
        const cell=kind==='inputs'?resolveCell(r,items[i]?.previous_output):{output:items[i],data:r.transaction.outputs_data?.[i]};
        const b=cellPreview(cell,description,i,name,()=>open(key,b),kind==='inputs'?items[i]?.previous_output:null);
        b.setAttribute('aria-label',`Edit ${name.toLowerCase()} index ${i} · ${description}`);
        if(!cell?.output || report.diagnostics.some(d=>diagnosticMatchesCell(d.path,kind,i,r))){b.append(el('span','⚠ Needs attention','cell-warning'));b.setAttribute('aria-label',`${b.getAttribute('aria-label')} · Needs attention`);}
        const row=el('div',undefined,'cell-row');row.dataset.cellId=identities[kind][i];if(b.style.getPropertyValue('--script'))row.style.setProperty('--script',b.style.getPropertyValue('--script'));row.append(b);
        const tools=el('div',undefined,'list-tools');row.append(tools);
        for(const [action,label] of [['up','↑'],['down','↓']]){
          const move=button(label,()=>{const identity=identities[kind][i];if(action==='down'&&i>=3)expanded.add(kind);changeCells(kind,action,i);const row=root.querySelector(`[data-cell-id="${identity}"]`);const target=row?.querySelector(`[data-move="${action}"]`);(target&&!target.disabled?target:row?.querySelector('.cell-preview'))?.focus();},tools);
          move.dataset.move=action;move.setAttribute('aria-label',`Move ${description} ${action} · ${name.toLowerCase()} index ${i}`);move.dataset.boundary=String(action==='up'?i===0:i===items.length-1);move.disabled=disabled||move.dataset.boundary==='true';
        }
        if(i>=4 && !expanded.has(kind))row.hidden=true;
        column.append(row);
      });
      if(items.length>4){const show=el('button',expanded.has(kind)?'Show first 4':`Browse all ${items.length} cells`,'secondary browse-cells');show.type='button';show.onclick=()=>{if(!valid())return;expanded.has(kind)?expanded.delete(kind):expanded.add(kind);refresh();};column.append(show);}
      const add=section.querySelector(':scope > button');if(add)column.append(add);
      if(kind==='inputs'){const help=el('details',undefined,'input-help');help.append(el('summary','About adding an input'),el('p','Each input points to a cell. Adding one creates a sample cell and placeholder outpoint with unconfirmed origin; it does not fetch a live cell. Existing witnesses are not changed. Placeholder labels last for this editing session; importing or editing JSON clears them because origin is not known.','hint'));column.append(help);}
    }
    const rail=el('div',undefined,'object-rail'); snapshot.append(rail);
    const depRail=el('div',undefined,'dep-rail'); depRail.append(el('span','Cell dependencies','rail-label'));rail.append(depRail);
    const depCards=[...deps.querySelectorAll(':scope > .wb-card')];
    const manage=button('Manage',()=>open('deps',manage),depRail);manage.setAttribute('aria-label','Manage cell deps');
    depCards.forEach((editor,i)=>{
      const point=r.transaction.cell_deps[i]?.out_point;const description=outpointName(point,r);const key=`dep:${i}`;editors.set(key,[`Cell dep index ${i}`,editor,description,point]);
      const kind=r.transaction.cell_deps[i]?.dep_type;const kindLabel=kind==='code'?'Code':kind==='dep_group'?'Dep group':'Invalid type';const b=el('button',`#${i} · ${kindLabel} · ${description}${description.startsWith('Local placeholder')?' · local snapshot only':''}`,'dep-dot dep-kind');b.type='button';b.disabled=disabled;
      if(kind==='dep_group')b.classList.add('dep-group');
      b.setAttribute('aria-label',`Cell dep index ${i} · ${kind??'invalid'} · ${description}${description.startsWith('Local placeholder')?' · local snapshot only':''} · open details`);
      b.title=`${b.getAttribute('aria-label')} · ${point?.tx_hash??''}:${point?.index??''}`;b.onclick=()=>open(key,b);depRail.append(b);
    });
    if(!depCards.length)depRail.append(el('span','None','hint'));
    const depManager=el('section');depManager.append(el('p','Cell dependencies are cells scripts can use. A dep group contains references to other cells.','hint'));
    depCards.forEach((editor,i)=>{const dep=r.transaction.cell_deps[i];const cell=resolveCell(r,dep?.out_point);const b=cellPreview(cell,outpointName(dep?.out_point,r),i,'Cell dep',()=>open(`dep:${i}`,b),dep?.out_point);const kind=dep?.dep_type==='code'?'Code':dep?.dep_type==='dep_group'?'Dep group':'Invalid type';b.querySelector('.cell-number').append(` · ${kind}`);b.setAttribute('aria-label',`Edit cell dep index ${i} · ${kind} · ${outpointName(dep?.out_point,r)}`);depManager.append(b);});
    [...deps.children].filter(n=>!depCards.includes(n)&&n.tagName!=='H3').forEach(n=>depManager.append(n));
    editors.set('deps',['Manage cell deps',depManager]);
    const witnessCards=[...witnesses.querySelectorAll(':scope > .witness-editor')];
    objectDots('Witnesses','witnesses',r.transaction.witnesses,witnesses,witnessCards.map((card,i)=>[`Witness index ${i}`,card]),'Witness');
    const headerManager=el('section');const headerEditors=[];const candidates=headerCandidates(r);
    function headerDraft(parent,template,path,replaceIndex=null){
      if(dialog.querySelector('.header-draft'))return;
      const trigger=document.activeElement;const previousScroll=dialog.scrollTop;const oldLabel=dialog.getAttribute('aria-labelledby');const hidden=[...dialog.children].map(node=>[node,node.hidden]);hidden.forEach(([node])=>{node.hidden=true;});
      const form=el('section',undefined,'header-draft');dialog.append(form);const bar=el('div',undefined,'inspector-heading header-draft-heading');const title=el('h2',replaceIndex===null?'Create a header':`Edit a copy · header dep index ${replaceIndex}`);title.id='header-draft-title';title.tabIndex=-1;bar.append(title);const apply=el('button','Save header','secondary');apply.type='button';bar.append(apply);const cancel=el('button','Back','secondary');cancel.type='button';bar.append(cancel);form.append(bar);dialog.setAttribute('aria-labelledby',title.id);
      const back=()=>{form.remove();hidden.forEach(([node,wasHidden])=>{node.hidden=wasHidden;});dialog.setAttribute('aria-labelledby',oldLabel);dialog.scrollTop=previousScroll;trigger?.focus({preventScroll:true});};cancel.onclick=back;form.back=back;
      form.append(el('p',replaceIndex===null?'Start with a copy of the tip header. Saving creates a dependency.':'Saving creates a separate header and replaces only this dependency. The original header and other references remain unchanged.','hint'),el('p','Saving also keeps changes made earlier in this editor.','hint'));
      form.append(el('p','RPC hex is a 0x-prefixed hexadecimal integer; for example, 0x2 means 2.','hint'));
      const names=[['version','Version'],['compact_target','Compact target'],['timestamp','Timestamp'],['number','Block number'],['epoch','Packed epoch'],['parent_hash','Parent hash'],['transactions_root','Transactions root'],['proposals_hash','Proposals hash'],['extra_hash','Extra hash'],['dao','DAO'],['nonce','Nonce']];
      const advanced=el('details',undefined,'header-advanced');advanced.append(el('summary','More header fields'));const controls=new Map();const fieldErrors=new Map();const common=['number','timestamp','parent_hash','epoch'];const ordered=[...names].sort((a,b)=>{const ai=common.indexOf(a[0]),bi=common.indexOf(b[0]);return (ai<0?100:ai)-(bi<0?100:bi);});for(const [key,label] of ordered){const wrap=el('label',`${label} (RPC hex)`,'wb-field');const input=el('input');input.value=typeof template?.[key]==='string'?template[key]:'';input.setAttribute('aria-label',`Header ${label} (RPC hex)`);input.spellcheck=false;const message=el('span','','wb-error field-error');message.id=`header-error-${key}`;message.setAttribute('role','alert');input.setAttribute('aria-describedby',message.id);wrap.append(input,message);if(key==='number'){const decimal=el('span','','hint');decimal.dataset.headerNumber='';wrap.append(decimal);}if(key==='epoch')wrap.append(el('span','Packed epoch combines an epoch number, position and length.','hint'));(common.includes(key)?form:advanced).append(wrap);controls.set(key,input);fieldErrors.set(key,message);}form.append(advanced);
      const extensionLabel=el('label','Extension for this header','wb-field');const extension=el('select');extension.setAttribute('aria-label','Extension for this header');for(const [value,title] of [['unspecified','Keep existing or leave unspecified'],['none','No extension (explicit null)'],['bytes','Supply extension bytes']]){const option=el('option',title);option.value=value;extension.append(option);}extensionLabel.append(extension);form.append(extensionLabel);const extensionHelp=el('p','','hint');extensionHelp.setAttribute('aria-live','polite');form.append(extensionHelp);
      const extensionWrap=el('label','Extension data (hex)','wb-field');const extensionData=el('input');extensionData.value='0x';extensionData.setAttribute('aria-label','Extension data (hex)');extensionData.setAttribute('aria-describedby','header-extension-error');const extensionError=el('span','','wb-error field-error');extensionError.id='header-extension-error';extensionError.setAttribute('role','alert');extensionWrap.append(extensionData,extensionError);extensionWrap.hidden=true;form.append(extensionWrap);
      const hashLabel=el('label','Computed header hash · read only','wb-field');const hashValue=el('textarea');hashValue.readOnly=true;hashValue.setAttribute('aria-label','Computed header hash (read only)');hashLabel.append(hashValue);const preview=el('p','','hint');const problem=el('p','','wb-error');problem.setAttribute('role','alert');problem.tabIndex=-1;form.append(hashLabel,preview,problem);
      let pending=replaceIndex===null;
      function draftValues(base){const header=structuredClone(base&&typeof base==='object'&&!Array.isArray(base)?base:{});for(const [key,input] of controls)header[key]=input.value;return header;}
      function updatePreview(){
        const number=form.querySelector('[data-header-number]');try{number.textContent=`Block ${rpcToDecimal(controls.get('number').value)}`;}catch{number.textContent='';}
        try{const hash=headerHash(draftValues(template));hashValue.value=hash;preview.textContent='Calculated locally; the header has not been authenticated.';const context=read()?.context;const entries=Array.isArray(context?.extensions)?context.extensions.filter(x=>typeof x?.block_hash==='string'&&x.block_hash.toLowerCase()===hash.toLowerCase()):null;const old=replaceIndex===null?null:read()?.transaction?.header_deps?.[replaceIndex];const same=typeof old==='string'&&old.toLowerCase()===hash.toLowerCase();
          if(!entries||entries.length>1){extensionHelp.className='wb-error';extensionHelp.textContent='Extension records are missing or ambiguous; check the supplied context.';}
          else if(entries.length===1){const data=entries[0]?.data;const validData=data===null||(typeof data==='string'&&/^0x(?:[0-9a-f]{2})*$/i.test(data));extensionHelp.className=extension.value==='unspecified'&&validData?'hint':'wb-error';extensionHelp.textContent=!validData?'An extension record exists for this hash but its data is missing or invalid. The record will be retained; inspect Extension information.':extension.value==='unspecified'?`${same?'The header hash is unchanged.':'This hash already has extension information.'} Its existing extension information will be retained.`:'Extension information already exists for this hash. Use Extension information to edit it; this form will not overwrite it.';}
          else {extensionHelp.className=extension.value==='unspecified'?'wb-error':'hint';extensionHelp.textContent=extension.value==='unspecified'?`${replaceIndex!==null&&!same?'The changed hash has no extension record. ':'No extension information is supplied for this hash. '}Verification requires the actual extension bytes or an explicit assertion that none exists (null). Unspecified leaves it missing.`:'The selected option supplies extension information for this hash.';}
        }catch(e){hashValue.value='';preview.textContent='Cannot calculate the hash until the header fields are valid.';extensionHelp.className='hint';extensionHelp.textContent='Fix the header fields to check extension information.';}form.dataset.pending=String(pending);
      }
      for(const [key,input] of controls)input.oninput=()=>{pending=true;fieldErrors.get(key).textContent='';input.removeAttribute('aria-invalid');problem.textContent='';updatePreview();};extension.onchange=()=>{pending=true;extensionWrap.hidden=extension.value!=='bytes';extensionError.textContent='';extensionData.removeAttribute('aria-invalid');updatePreview();};extensionData.oninput=()=>{pending=true;extensionError.textContent='';extensionData.removeAttribute('aria-invalid');updatePreview();};updatePreview();
      form.append(el('p',Object.hasOwn(template??{},'hash')?'The copy’s supplied hash will be updated to the calculated value. Other fields are retained.':'Other fields are retained.','hint'));
      apply.onclick=()=>{const ignored=new Set([...controls.values(),extension,extensionData,hashValue]);const bad=[...root.querySelectorAll('input,textarea,select')].find(n=>!ignored.has(n)&&!n.checkValidity());if(bad){bad.reportValidity();return;}try{const current=read();let base=current;for(const part of path)base=base?.[part];const header=draftValues(base);headerHash(header);if(extension.value==='bytes'&&!/^0x(?:[0-9a-f]{2})*$/i.test(extensionData.value)){extensionError.textContent='Enter an even number of hex digits after 0x.';extensionData.setAttribute('aria-invalid','true');extensionData.focus();extensionData.scrollIntoView({block:'center'});return;}const next=addHeaderFromFields(current,header,{replaceIndex,extension:extension.value,extensionData:extensionData.value});write(next);form.dataset.pending='false';form.remove();finish();}catch(e){const found=names.find(([key])=>e.message.startsWith(`${key} `));if(found){const [key,label]=found;const input=controls.get(key);fieldErrors.get(key).textContent=`${label}${e.message.slice(key.length)}`;input.setAttribute('aria-invalid','true');problem.textContent='';if(advanced.contains(input))advanced.open=true;input.focus();input.scrollIntoView({block:'center'});}else{problem.textContent=e.message;problem.focus();problem.scrollIntoView({block:'center'});}}};
      dialog.scrollTop=0;title.focus({preventScroll:true});
    }
    if(Array.isArray(r.transaction.header_deps)) {
      r.transaction.header_deps.forEach((hash,i)=>{const row=el('article',undefined,'header-entry');const listRow=el('article',undefined,'header-list-row');headerManager.append(listRow);
        const matching=typeof hash==='string'?candidates.filter(c=>c.hash&&c.hash.toLowerCase()===hash.toLowerCase()):[];
        const backToHeaders=button('Back to header dependencies',()=>{open('headers');headerManager.querySelector(`[aria-label="Open header dep index ${i}"]`)?.focus();},row);backToHeaders.classList.add('header-back');row.append(el('p',`Header dependency index ${i}`, 'hint'));const listInfo=el('div',undefined,'header-list-info');listInfo.append(el('strong',`Header dep index ${i}`));let block='unknown';if(matching.length===1){try{block=rpcToDecimal(matching[0].header.number);}catch{} }listInfo.append(el('span',matching.length===1?`${matching[0].source} · block ${block}`:'No unique matching header','hint'));listInfo.append(el('span',typeof hash==='string'?`${hash.slice(0,14)}…${hash.slice(-8)}`:'Invalid hash','header-list-hash'));listRow.append(listInfo);const inspect=button('Open',()=>open(`headers:${i}`,inspect),listRow);inspect.setAttribute('aria-label',`Open header dep index ${i}`);
        if(matching.length===1){const candidate=matching[0];row.append(el('p',`${candidate.source} · block ${block}`, 'hint'));button('Edit a copy',()=>headerDraft(row,candidate.header,candidate.path,i),row);}
        else row.append(el('p',matching.length?'Multiple supplied headers share this hash; resolve the ambiguity before editing.':'No uniquely matching supplied header. Edit this hash below, or remove this dependency and add an existing header from the list.','wb-error'));
        if(matching.length===1){
          const ext=el('details');ext.append(el('summary','Extension information'));row.append(ext);const records=Array.isArray(r.context.extensions)?r.context.extensions.filter(x=>typeof x?.block_hash==='string'&&x.block_hash.toLowerCase()===hash.toLowerCase()):[];
          if(Array.isArray(r.context.extensions)&&records.length===0)row.insertBefore(el('p','Extension information is missing. Verification requires actual bytes or an explicit assertion of no extension (null). Open Extension information to supply it.','wb-error'),ext);
          if(!Array.isArray(r.context.extensions)||records.length>1)ext.append(el('p','Extensions are missing or ambiguous; existing data was not changed.','wb-error'));
          else {const current=records[0];ext.append(el('p',current?'Existing extension information is shown below.':'No extension information supplied; verification may require it.','hint'));const label=el('label','Extension status','wb-field');const choice=el('select');choice.setAttribute('aria-label','Extension status');for(const [value,title] of [['','Choose an option'],['none','No extension (explicit null)'],['bytes','Supply extension bytes']]){const option=el('option',title);option.value=value;choice.append(option);}choice.value=current?.data===null?'none':typeof current?.data==='string'?'bytes':'';label.append(choice);ext.append(label);const dataWrap=el('label','Extension bytes (hex)','wb-field');const data=el('input');data.setAttribute('aria-label','Extension bytes (hex)');data.setAttribute('aria-describedby',`header-dep-extension-error-${i}`);data.value=typeof current?.data==='string'?current.data:'0x';const dataError=el('span','','wb-error field-error');dataError.id=`header-dep-extension-error-${i}`;dataError.setAttribute('role','alert');dataWrap.hidden=choice.value!=='bytes';dataWrap.append(data,dataError);ext.append(dataWrap);const originalChoice=choice.value,originalData=data.value;const changed=()=>{dataWrap.hidden=choice.value!=='bytes';dataError.textContent='';data.removeAttribute('aria-invalid');choice.setCustomValidity(choice.value!==originalChoice||data.value!==originalData?'Apply extension information or cancel changes before saving.':'');};choice.onchange=changed;data.oninput=changed;const apply=el('button','Apply extension information','secondary');apply.type='button';apply.onclick=()=>{const bad=[...root.querySelectorAll('input,textarea,select')].find(n=>n!==choice&&n!==data&&!n.checkValidity());if(bad){bad.reportValidity();return;}if(choice.value==='bytes'&&!/^0x(?:[0-9a-f]{2})*$/i.test(data.value)){dataError.textContent='Enter an even number of hex digits after 0x.';data.setAttribute('aria-invalid','true');data.focus();data.scrollIntoView({block:'center'});return;}try{write(setHeaderExtension(read(),hash,choice.value,data.value));selection=`headers:${i}`;refresh();}catch(e){error.textContent=e.message;error.tabIndex=-1;error.focus();error.scrollIntoView({block:'center'});}};ext.append(apply);}
        }
        const raw=el('details');raw.append(el('summary','Advanced · dependency hash'));row.append(raw);field(raw,`Header dep index ${i} hash`,typeof hash==='string'?hash:'',(q,v)=>{q.transaction.header_deps[i]=v;});raw.append(el('p','The hash must match a supplied header. Editing it here does not change header fields.','hint'));
        button(`Remove header dep index ${i}`,()=>commit(q=>{q.transaction.header_deps.splice(i,1);selection='headers';}),row);
        headerEditors.push([`Header dep index ${i}`,row]);
      });
      const existing=candidates.filter(c=>c.hash&&candidates.filter(other=>other.hash===c.hash).length===1);const chooseLabel=el('label','Existing header','wb-field');const choose=el('select');choose.setAttribute('aria-label','Existing header');existing.forEach((candidate,i)=>{const option=el('option',`${candidate.source} · block ${rpcToDecimal(candidate.header.number)||'?'} · ${candidate.hash.slice(0,12)}…`);option.value=String(i);choose.append(option);});choose.disabled=disabled||!existing.length;chooseLabel.append(choose);headerManager.append(chooseLabel);
      const link=button('Add existing header',()=>{const candidate=existing[Number(choose.value)];if(!candidate)throw new Error('No valid supplied header is available.');write(linkExistingHeader(read(),candidate.header));refresh();},headerManager);if(!existing.length){link.disabled=true;link.dataset.boundary='true';headerManager.append(el('p','No unique supplied header is available.','hint'));}
      const excluded=candidates.filter(c=>!c.hash||candidates.filter(other=>other.hash===c.hash).length>1);if(excluded.length)headerManager.append(el('p',`Unavailable headers: ${excluded.map(c=>c.source).join(', ')}. Invalid fields or duplicate hashes were left unchanged.`, 'wb-error'));
      button('Create header',()=>headerDraft(headerManager,r.context.tip_header,['context','tip_header']),headerManager);
      const advancedAdd=el('details');advancedAdd.append(el('summary','Advanced · add a hash only'),el('p','This adds a zero placeholder, not a computed header hash. Replace it with the intended hash.','hint'));headerManager.append(advancedAdd);button('Add unresolved hash',()=>commit(q=>{q.transaction.header_deps.push(`0x${'0'.repeat(64)}`);}),advancedAdd);
      headerManager.append(el('p','Hashes are computed locally from header fields. This does not authenticate the chain. A header dependency also requires explicit extension information; no extension is assumed.','hint'));
    }else headerManager.append(el('p','header_deps must be an array. Correct it in JSON.','wb-error'));
    objectDots('Header dependencies','headers',r.transaction.header_deps,headerManager,headerEditors,'Header dep');
    const terms=el('details',undefined,'rail-help');terms.append(el('summary','About dependencies and witnesses'),el('p','Cell dependencies supply cells used by scripts. A dependency refers to one cell or a group of cell references.','hint'),el('p','Header dependencies identify block headers that scripts may use; supplied headers are not fetched or authenticated here.','hint'),el('p','Witnesses contain extra script data, often signatures. #0, #1 and so on are positions in the witness list; they do not necessarily map one-to-one to inputs.','hint'),el('p','On cell cards, the left border follows the Lock script. Script numbers identify matching scripts; colors can repeat and do not indicate verification or chain validity. Dependency and witness controls use neutral colors.','hint'));rail.append(terms);
    const settings=el('section'); settings.append(cycles,scope);
    editors.set('settings',['Verification settings',settings]);
    const context=el('section');context.append(el('p','Explicit supplied context, not authenticated chain data. Numeric quantities are decimal; hashes, bytes and packed epochs remain hex. Unknown fields are retained.','hint'));
    for(const [key,label] of [['consensus','Consensus'],['tip_header','Tip header'],['headers','Supplied headers'],['extensions','Extensions']]){
      const section=el('details');section.append(el('summary',label));context.append(section);structuredFields(section,r.context[key],['context',key],label);
    }
    const verification=el('details');verification.append(el('summary','Verification environment'));context.append(verification);
    if(r.context.verification===undefined) verification.append(el('p','Submitted mode (verification omitted). To use committed mode, import an explicit candidate header and transaction index.','hint'));
    else structuredFields(verification,r.context.verification,['context','verification'],'Verification');
    editors.set('context',['Context',context]);
    const controls=el('div',undefined,'context-controls');rail.append(controls);
    const contextButton=button('Context',()=>open('context',contextButton),controls);contextButton.setAttribute('aria-label','Context');
    const settingsButton=button('Settings',()=>open('settings',settingsButton),controls);settingsButton.setAttribute('aria-label','Settings');
    function objectDots(label,key,items,manager,entries,itemLabel){
      const row=el('div',undefined,'dep-rail');row.append(el('span',label,'rail-label'));rail.append(row);
      entries.forEach(([title,editor],i)=>{const id=`${key}:${i}`;editors.set(id,[title,editor]);const b=el('button',`#${i}`,'dep-dot reference-dot');b.type='button';b.disabled=disabled;b.setAttribute('aria-label',`${itemLabel} index ${i} · open details`);b.title=b.getAttribute('aria-label');b.onclick=()=>open(id,b);row.append(b);});
      if(!entries.length)row.append(el('span',Array.isArray(items)?'None':'Invalid array','hint'));
      editors.set(key,[label,manager]);const manage=button('Manage',()=>open(key,manage),row);manage.setAttribute('aria-label',`Manage ${key==='headers'?'header deps':label.toLowerCase()}`);
    }
    root.replaceChildren(error,snapshot);
    if(diagnostics?.children.length){const alert=el('details',undefined,'diagnostic-summary');alert.open=true;alert.append(el('summary',`${diagnostics.children.length} preflight warning${diagnostics.children.length===1?'':'s'} · not VM results`),diagnostics);root.append(alert);}
    const dialog=el('dialog',undefined,'inspector');dialog.setAttribute('aria-labelledby','inspector-title');root.append(dialog);
    function open(key,trigger) {
      if(!valid())return;
      if(trigger)restoreFocus=trigger.getAttribute('aria-label');
      if(sessionBaseline===null)sessionBaseline={request:capture(),inputs:[...identities.inputs],outputs:[...identities.outputs],resolved:new Map(resolvedIds),drafts:new Map(draftNames),placeholders:new Set(placeholderPoints),witnessNotice,nextDraft};
      selection=key;
      const entry=editors.get(key);if(!entry){selection=null;return;}
      // Return dependency editors to their management container before switching.

      witnessCards.forEach(card=>witnesses.insertBefore(card,witnesses.querySelector(':scope > button')));

      dialog.replaceChildren();
      const top=el('div',undefined,'inspector-heading');const title=el('h2',entry[0]);title.id='inspector-title';top.append(title);
      const close=el('button','Save','secondary');close.type='button';close.onclick=()=>finish();top.append(close);const discard=el('button','Cancel changes','secondary discard-draft');discard.type='button';discard.onclick=()=>finish(true);top.append(discard);dialog.append(top);if(entry[2]){const identity=el('p',entry[2],'inspector-identity');identity.id='inspector-identity';dialog.append(identity);if(entry[2].startsWith('Local placeholder'))dialog.append(el('p','Local snapshot only.','hint'));dialog.setAttribute('aria-describedby',identity.id);}else dialog.removeAttribute('aria-describedby');
      const point=entry[3];if(point&&typeof point==='object'&&!Array.isArray(point)&&typeof point.tx_hash==='string'&&typeof point.index==='string'){const full=el('details',undefined,'outpoint-details');full.append(el('summary','Full outpoint · select to copy'),el('p','An outpoint identifies a cell by its creating transaction hash and output index. RPC hex uses a 0x prefix, for example 0x2 means 2.','hint'));const hashLabel=el('label','Transaction hash','wb-field');const hash=el('textarea');hash.readOnly=true;hash.value=point.tx_hash;hash.setAttribute('aria-label','Transaction hash (read only)');hashLabel.append(hash);const indexLabel=el('label','Output index (RPC hex)','wb-field');const index=el('input');index.readOnly=true;index.value=point.index;index.setAttribute('aria-label','Output index (read only)');indexLabel.append(index);full.append(hashLabel,indexLabel);dialog.append(full);}
      dialog.append(el('p','Save keeps changes. Cancel restores the request from when this editor was opened.','hint'),error,entry[1]);
      dialog.querySelectorAll('[data-default-open]').forEach(d=>{d.open=true;});
      dialog.querySelectorAll('input,select,textarea,button').forEach(n=>{n.disabled=disabled||n.dataset.boundary==='true';});
      if(!dialog.open)dialog.showModal();
      if(trigger&&/^headers:[0-9]+$/.test(key)){title.tabIndex=-1;title.focus({preventScroll:true});}
    }
    function returnFocus(){
      if(!restoreFocus)return;const nodes=[...root.querySelectorAll('[aria-label]')];let target=nodes.find(n=>n.getAttribute('aria-label')===restoreFocus);
      const cell=/^Edit (input|output) index ([0-9]+) ·/.exec(restoreFocus);if(!target&&cell)target=nodes.find(n=>n.getAttribute('aria-label').startsWith(`Edit ${cell[1]} index ${cell[2]} ·`));
      const dep=/^Edit cell dep index ([0-9]+) ·/.exec(restoreFocus);if(!target&&dep)target=nodes.find(n=>n.getAttribute('aria-label').startsWith(`Cell dep index ${dep[1]} ·`));
      const header=/^(?:Open header dep index ([0-9]+)|Header dep index ([0-9]+) · open details)$/.exec(restoreFocus);if(!target&&header){const index=header[1]??header[2];target=nodes.find(n=>n.getAttribute('aria-label')===`Header dep index ${index} · open details`)??nodes.find(n=>n.getAttribute('aria-label')==='Manage header deps');}
      if(!target)target=nodes.find(n=>n.getAttribute('aria-label')==='Manage cell deps');target?.focus();
    }
    function finish(discard=false){if(!discard&&!valid())return;selection=null;dialog.close();if(discard&&sessionBaseline!==null){restore(sessionBaseline.request);identities.inputs=sessionBaseline.inputs;identities.outputs=sessionBaseline.outputs;resolvedIds.clear();for(const [key,value] of sessionBaseline.resolved)resolvedIds.set(key,value);draftNames.clear();for(const [key,value] of sessionBaseline.drafts)draftNames.set(key,value);placeholderPoints.clear();for(const key of sessionBaseline.placeholders)placeholderPoints.add(key);witnessNotice=sessionBaseline.witnessNotice;nextDraft=sessionBaseline.nextDraft;}sessionBaseline=null;refresh();returnFocus();}
    dialog.addEventListener('cancel',e=>{e.preventDefault();const draft=dialog.querySelector('.header-draft');if(draft)draft.back();else finish(true);});
    if(selection)open(selection);
  }
  return {refresh,setBusy(v){disabled=v;root.querySelectorAll('input,select,textarea,button').forEach(n=>{n.disabled=v||n.dataset.boundary==='true';});},valid};
}
