import { rawNumber } from './lossless-json.js';
import { ckb, ckbToHex } from './guided.js';
import { resolveCell, scriptChoices, inspectRequest, mutateCellList, decimalToRpc, rpcToDecimal, addDependencyCell, scriptName } from './workbench-model.js';

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
  const scriptIds=new Map();
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (label, action, parent) => { const b = el('button', label, 'secondary'); b.type = 'button'; b.disabled = disabled; b.onclick = () => { if (valid()) { try { action(); } catch (e) { error.textContent = e.message; } } }; parent.append(b); return b; };
  const commit = (fn, render = true) => { const next = structuredClone(read()); fn(next); write(next); if (render && ![...root.querySelectorAll('input,textarea,select')].some(n => !n.checkValidity())) refresh(); };
  function field(parent, label, value, apply, { area = false, options, parse = v => v } = {}) {
    const wrap = el('label', label, 'wb-field');
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
  function valid() { const bad = [...root.querySelectorAll('input,textarea,select')].find(n => !n.checkValidity()); if (bad) { bad.reportValidity(); return false; } return true; }
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
  function resolvedIdentity(point){
    const key=point&&typeof point.tx_hash==='string'&&typeof point.index==='string'?`${point.tx_hash.toLowerCase()}:${point.index.toLowerCase()}`:null;
    if(!key)return 'Unresolved';if(!resolvedIds.has(key))resolvedIds.set(key,`C${nextIdentity++}`);return resolvedIds.get(key);
  }
  function scriptMarker(value){
    if(!value||typeof value.code_hash!=='string'||typeof value.hash_type!=='string'||typeof value.args!=='string')return null;
    const key=[value.code_hash.toLowerCase(),value.hash_type,value.args.toLowerCase()].join(':');
    if(!scriptIds.has(key))scriptIds.set(key,scriptIds.size+1);const n=scriptIds.get(key);
    return {id:`S${n}`,short:value.code_hash.slice(2,8),color:['#a8d98d','#9db7ff','#ffcb86','#dca8eb','#82d5ca','#eea1ad'][(n-1)%6]};
  }
  function cellPreview(cell,identity,index,kind,request,onClick){
    const b=el('button',undefined,'cell-preview');b.type='button';b.disabled=disabled;b.onclick=onClick;
    b.append(el('span',`${identity} · ${kind} index ${index}`,'cell-number'));
    let capacity='Invalid capacity';try{capacity=`${ckb(cell.output.capacity)} CKB`;}catch{}
    b.append(el('strong',capacity,capacity.length>17?'capacity-long':undefined));const meta=el('span',undefined,'cell-meta');
    for(const kind of ['lock','type']){
      const marker=scriptMarker(cell?.output?.[kind]);const name=kind==='lock'?'Lock':'Type';
      const chip=el('span',marker?`${name} ${scriptName(cell.output[kind])} · ${marker.id}`:`${name} ${kind==='type'&&!cell?.output?.type?'—':'?'}`,'script-chip');
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
    if(action==='up')selection=selection?`${kind}:${index-1}`:null;
    else if(action==='down')selection=selection?`${kind}:${index+1}`:null;
    else if(action==='remove')selection=null;
    refresh();
  }
  function refresh(resetIdentity=false) {
    if(resetIdentity){identities.inputs=[];identities.outputs=[];resolvedIds.clear();selection=null;sessionBaseline=null;}
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
        const card=el('article',undefined,'wb-card');card.append(el('h4',`${kind==='inputs'?'Input':'Output'} ${i+1}`));section.append(card);
        const tools=el('div',undefined,'wb-tools');card.append(tools);
        for(const [action,label] of [['duplicate','Copy'],['up','↑'],['down','↓'],['remove','Remove']])button(label,()=>{try{changeCells(kind,action,i);}catch(e){error.textContent=e.message;}},tools);
        if (!item || typeof item !== 'object' || Array.isArray(item)) { card.append(el('p','Invalid cell entry. Correct this entry in JSON.','wb-error')); return; }
        const input=kind==='inputs';
        const cell=input?resolveCell(r,item?.previous_output):{output:item,data:r.transaction.outputs_data?.[i]};
        const getCell=q=>input?resolveCell(q,q.transaction.inputs[i].previous_output):null;
        const getOutput=q=>input?getCell(q).output:q.transaction.outputs[i];
        cellFields(card,`${input?'Input':'Output'} ${i+1}`,cell,getOutput,(q,v)=>{if(input)getCell(q).data=v;else q.transaction.outputs_data[i]=v;},r);
        if(input){const advanced=el('details');advanced.append(el('summary','Advanced · since & reference'));card.append(advanced);field(advanced,`Input ${i+1} since (RPC hex)`,item.since,(q,v)=>{q.transaction.inputs[i].since=v;});advanced.append(el('p',`Outpoint: ${item.previous_output?.tx_hash}:${item.previous_output?.index}`,'hint'));}
      });
      button(`Add ${kind==='inputs'?'synthetic input':'output'}`,()=>{try{changeCells(kind,'add');}catch(e){error.textContent=e.message;}},section);
      if(kind==='inputs')section.append(el('p','Adding or copying creates a synthetic, unconfirmed cell with a unique outpoint. Existing cells and witness positions are not rewritten.','hint'));
    }
    const witnesses=el('section',undefined,'wb-section');witnesses.append(el('h3','Witnesses'));root.append(witnesses);
    if(Array.isArray(r.transaction.witnesses)) {
      r.transaction.witnesses.forEach((v,i)=>{const row=el('article',undefined,'witness-editor');witnesses.append(row);field(row,`Witness ${i} (hex)`,v,(q,x)=>{q.transaction.witnesses[i]=x;},{area:true});button(`Remove witness ${i}`,()=>commit(q=>{q.transaction.witnesses.splice(i,1);selection='witnesses';}),row);});
      button('Add witness',()=>commit(q=>{q.transaction.witnesses.push('0x');}),witnesses);
    } else witnesses.append(el('p','witnesses must be an array; edit JSON.','wb-error'));
    const deps=el('section',undefined,'wb-section');deps.append(el('h3','Cell deps'));root.append(deps);
    if(Array.isArray(r.transaction.cell_deps)) {
      r.transaction.cell_deps.forEach((dep,i)=>{
        const row=el('article',undefined,'wb-card');deps.append(row);
        if(!dep||typeof dep!=='object'||Array.isArray(dep)){row.append(el('p','Invalid cell dep. Correct this entry in JSON.','wb-error'));return;}
        field(row,`Cell dep ${i+1} kind`,dep.dep_type,(q,v)=>{q.transaction.cell_deps[i].dep_type=v;},{options:[['code','Code'],['dep_group','Dep group']]});
        const cell=resolveCell(r,dep.out_point);const get=q=>resolveCell(q,q.transaction.cell_deps[i].out_point);
        cellFields(row,`Cell dep ${i+1}`,cell,q=>get(q).output,(q,v)=>{get(q).data=v;},r);
        const ref=el('details');ref.append(el('summary','Reference & origin'),el('p',`${dep.out_point?.tx_hash}:${dep.out_point?.index}`,'hint'));row.append(ref);
        if(cell)structuredFields(ref,cell.transaction_info,['context','cells',String(r.context.cells.indexOf(cell)),'transaction_info'],'Origin');
        row.append(el('p','Edits affect this shared resolved cell wherever referenced. Removing a dep does not delete context. Dep-group membership bytes are never rewritten automatically.','hint'));
        button(`Remove cell dep ${i+1}`,()=>commit(q=>{q.transaction.cell_deps.splice(i,1);selection='deps';}),row);
      });
      button('New resolved cell',()=>{const next=addDependencyCell(read());write(next);selection=`dep:${next.transaction.cell_deps.length-1}`;refresh();},deps);
      const select=el('select');select.disabled=disabled;select.setAttribute('aria-label','Resolved cell to add as dependency');r.context.cells.forEach((c,i)=>{const o=el('option',`${i+1} · ${c?.out_point?.tx_hash}:${c?.out_point?.index}`);o.value=String(i);select.append(o);});deps.append(select);
      button('Add selected cell as code dependency',()=>commit(q=>{const c=q.context.cells[Number(select.value)];if(!c?.out_point)throw new Error('Select a resolved cell with an outpoint.');q.transaction.cell_deps.push({out_point:structuredClone(c.out_point),dep_type:'code'});}),deps);
    }
    deps.append(el('p','Only supplied resolved cells are listed. This does not infer code hashes or expand dep groups. JSON remains available for custom binaries, hashes and context.','hint'));
    const group=el('details');group.append(el('summary','Verification scope'));root.append(group);
    if(r.script_group){field(group,'Group kind',r.script_group.group_type,(q,v)=>{q.script_group.group_type=v;},{options:[['lock','Lock'],['type','Type']]});field(group,'Script hash',r.script_group.script_hash,(q,v)=>{q.script_group.script_hash=v;});button('Verify full transaction instead',()=>commit(q=>{delete q.script_group;}),group);}
    else button('Select a script group',()=>commit(q=>{q.script_group={group_type:'lock',script_hash:`0x${'0'.repeat(64)}`};}),group);
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
    const columns = el('div',undefined,'cell-columns'); snapshot.append(columns);
    const choices = scriptChoices(r);
    const scriptId = value => { const index=choices.findIndex(s=>String(s.code_hash).toLowerCase()===String(value?.code_hash).toLowerCase()&&s.hash_type===value?.hash_type&&String(s.args).toLowerCase()===String(value?.args).toLowerCase()); return index<0?'?':String(index+1); };
    for (const [kind, section] of [['inputs',inputs],['outputs',outputs]]) {
      const column = el('section',undefined,'cell-column'); columns.append(column);
      const list = r.transaction[kind];
      column.append(el('h2',`${kind==='inputs'?'Inputs':'Outputs'} · ${Array.isArray(list)?list.length:'invalid'}`));
      const cards=[...section.querySelectorAll(':scope > .wb-card')];
      while(identities[kind].length<cards.length){const i=identities[kind].length;identities[kind].push(kind==='inputs'?resolvedIdentity(r.transaction.inputs[i]?.previous_output):`C${nextIdentity++}`);}
      identities[kind].length=cards.length;
      if(!Array.isArray(list)) column.append(el('p',`${kind} must be an array. Open JSON to repair.`, 'wb-error'));
      const items=Array.isArray(list)?list:[];
      cards.forEach((editor,i)=> {
        const key=`${kind}:${i}`; editors.set(key,[`${kind==='inputs'?'Input':'Output'} ${i+1}`,editor]);
        const cell=kind==='inputs'?resolveCell(r,items[i]?.previous_output):{output:items[i],data:r.transaction.outputs_data?.[i]};
        const b=cellPreview(cell,identities[kind][i],i,kind==='inputs'?'IN':'OUT',r,()=>open(key,b));
        b.setAttribute('aria-label',`Edit ${kind==='inputs'?'input':'output'} ${i+1}`);
        if(!cell?.output || report.diagnostics.some(d=>d.path.includes(`${kind}[${i}]`) || d.path.includes(`outputs_data[${i}]`))) b.append(el('span','⚠ Needs attention','cell-warning'));
        const row=el('div',undefined,'cell-row');row.dataset.cellId=identities[kind][i];row.append(b);
        const tools=el('div',undefined,'list-tools');row.append(tools);
        for(const [action,label] of [['up','↑'],['down','↓']]){
          const move=button(label,()=>{const identity=identities[kind][i];if(action==='down'&&i>=3)expanded.add(kind);changeCells(kind,action,i);const row=root.querySelector(`[data-cell-id="${identity}"]`);const target=row?.querySelector(`[data-move="${action}"]`);(target&&!target.disabled?target:row?.querySelector('.cell-preview'))?.focus();},tools);
          move.dataset.move=action;move.setAttribute('aria-label',`Move ${identities[kind][i]} ${action}`);move.dataset.boundary=String(action==='up'?i===0:i===items.length-1);move.disabled=disabled||move.dataset.boundary==='true';
        }
        if(i>=4 && !expanded.has(kind))row.hidden=true;
        column.append(row);
      });
      if(items.length>4){const show=el('button',expanded.has(kind)?'Show first 4':`Browse all ${items.length} cells`,'secondary browse-cells');show.type='button';show.onclick=()=>{if(!valid())return;expanded.has(kind)?expanded.delete(kind):expanded.add(kind);refresh();};column.append(show);}
      const add=section.querySelector(':scope > button');if(add)column.append(add);
    }
    const rail=el('div',undefined,'object-rail'); snapshot.append(rail);
    const depRail=el('div',undefined,'dep-rail'); depRail.append(el('span','Cell deps','rail-label'));rail.append(depRail);
    const depCards=[...deps.querySelectorAll(':scope > .wb-card')];
    depCards.forEach((editor,i)=>{
      const key=`dep:${i}`;editors.set(key,[`Cell dep ${i+1}`,editor]);
      const kind=r.transaction.cell_deps[i]?.dep_type;const b=el('button',`${i+1} · ${kind??'invalid'}`,'dep-dot dep-kind'); b.type='button';b.disabled=disabled;
      const identity=JSON.stringify(r.transaction.cell_deps[i]?.out_point??i);const color=[...identity].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%6;
      b.style.setProperty('--dot', ['#a8d98d','#9db7ff','#ffcb86','#dca8eb','#82d5ca','#eea1ad'][color]);if(r.transaction.cell_deps[i]?.dep_type==='dep_group')b.classList.add('dep-group');
      b.setAttribute('aria-label',`Cell dep ${i+1} · ${r.transaction.cell_deps[i]?.dep_type??'invalid'} · open details`);
      b.title=b.getAttribute('aria-label');b.onclick=()=>open(key,b);depRail.append(b);
    });
    if(!depCards.length)depRail.append(el('span','None','hint'));
    const depManager=el('section');
    depCards.forEach((editor,i)=>{const cell=resolveCell(r,r.transaction.cell_deps[i]?.out_point);const b=cellPreview(cell,resolvedIdentity(r.transaction.cell_deps[i]?.out_point),i,'DEP',r,()=>open(`dep:${i}`,b));b.setAttribute('aria-label',`Edit cell dep ${i+1}`);depManager.append(b);});
    [...deps.children].filter(n=>!depCards.includes(n)&&n.tagName!=='H3').forEach(n=>depManager.append(n));
    editors.set('deps',['Manage cell deps',depManager]);
    const manage=button('Manage',()=>open('deps',manage),depRail);manage.setAttribute('aria-label','Manage cell deps');
    const witnessCards=[...witnesses.querySelectorAll(':scope > .witness-editor')];
    objectDots('Witnesses','witnesses',r.transaction.witnesses,witnesses,witnessCards.map((card,i)=>[`Witness ${i}`,card]),'Witness');
    const headerManager=el('section');const headerEditors=[];
    if(Array.isArray(r.transaction.header_deps)) {
      r.transaction.header_deps.forEach((hash,i)=>{const row=el('article');headerManager.append(row);
        field(row,`Header dep ${i+1} hash`,typeof hash==='string'?hash:'',(q,v)=>{q.transaction.header_deps[i]=v;});
        row.append(el('p','The verifier matches this hash against recomputed supplied headers. No network data is fetched.','hint'));
        button(`Remove header dep ${i+1}`,()=>commit(q=>{q.transaction.header_deps.splice(i,1);selection='headers';}),row);
        headerEditors.push([`Header dep ${i+1}`,row]);
      });
      button('Add header dep',()=>commit(q=>{q.transaction.header_deps.push(`0x${'0'.repeat(64)}`);}),headerManager);
    }else headerManager.append(el('p','header_deps must be an array. Correct it in JSON.','wb-error'));
    objectDots('Header deps','headers',r.transaction.header_deps,headerManager,headerEditors,'Header dep');
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
      const row=el('div',undefined,'dep-rail');row.append(el('span',key==='witnesses'?'Witness index':label,'rail-label'));rail.append(row);
      entries.forEach(([title,editor],i)=>{const id=`${key}:${i}`;editors.set(id,[title,editor]);const b=el('button',String(key==='witnesses'?i:i+1),'dep-dot');b.type='button';b.disabled=disabled;b.style.setProperty('--dot',['#a8d98d','#9db7ff','#ffcb86','#dca8eb','#82d5ca','#eea1ad'][i%6]);b.setAttribute('aria-label',`${itemLabel} ${itemLabel==='Witness'?i:i+1} · open details`);b.title=b.getAttribute('aria-label');b.onclick=()=>open(id,b);row.append(b);});
      if(!entries.length)row.append(el('span',Array.isArray(items)?'None':'Invalid array','hint'));
      editors.set(key,[label,manager]);const manage=button('Manage',()=>open(key,manage),row);manage.setAttribute('aria-label',`Manage ${label.toLowerCase()}`);
    }
    root.replaceChildren(error,snapshot);
    if(diagnostics?.children.length){const alert=el('details',undefined,'diagnostic-summary');alert.open=true;alert.append(el('summary',`${diagnostics.children.length} preflight warning${diagnostics.children.length===1?'':'s'} · not VM results`),diagnostics);root.append(alert);}
    const dialog=el('dialog',undefined,'inspector');dialog.setAttribute('aria-labelledby','inspector-title');root.append(dialog);
    function open(key,trigger) {
      if(!valid())return;
      if(trigger)restoreFocus=trigger.getAttribute('aria-label');
      if(sessionBaseline===null)sessionBaseline={request:capture(),inputs:[...identities.inputs],outputs:[...identities.outputs],resolved:new Map(resolvedIds)};
      selection=key;
      const entry=editors.get(key);if(!entry){selection=null;return;}
      // Return dependency editors to their management container before switching.

      witnessCards.forEach(card=>witnesses.insertBefore(card,witnesses.querySelector(':scope > button')));
      headerEditors.forEach(([,card])=>headerManager.insertBefore(card,headerManager.querySelector(':scope > button')));
      dialog.replaceChildren();
      const top=el('div',undefined,'inspector-heading');const title=el('h2',entry[0]);title.id='inspector-title';top.append(title);
      const close=el('button','Save','secondary');close.type='button';close.onclick=()=>finish();top.append(close);const discard=el('button','Cancel changes','secondary discard-draft');discard.type='button';discard.onclick=()=>finish(true);top.append(discard);dialog.append(top,el('p','Save keeps changes. Cancel restores the request from when this editor was opened.','hint'),error,entry[1]);
      dialog.querySelectorAll('[data-default-open]').forEach(d=>{d.open=true;});
      dialog.querySelectorAll('input,select,textarea,button').forEach(n=>{n.disabled=disabled;});
      if(!dialog.open)dialog.showModal();
    }
    function returnFocus(){
      if(!restoreFocus)return;const nodes=[...root.querySelectorAll('[aria-label]')];let target=nodes.find(n=>n.getAttribute('aria-label')===restoreFocus);
      const dep=/^Edit cell dep ([0-9]+)$/.exec(restoreFocus);if(!target&&dep)target=nodes.find(n=>n.getAttribute('aria-label').startsWith(`Cell dep ${dep[1]} ·`));
      if(!target)target=nodes.find(n=>n.getAttribute('aria-label')==='Manage cell deps');target?.focus();
    }
    function finish(discard=false){if(!discard&&!valid())return;selection=null;dialog.close();if(discard&&sessionBaseline!==null){restore(sessionBaseline.request);identities.inputs=sessionBaseline.inputs;identities.outputs=sessionBaseline.outputs;resolvedIds.clear();for(const [key,value] of sessionBaseline.resolved)resolvedIds.set(key,value);}sessionBaseline=null;refresh();returnFocus();}
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(true);});
    if(selection)open(selection);
  }
  return {refresh,setBusy(v){disabled=v;root.querySelectorAll('input,select,textarea,button').forEach(n=>{n.disabled=v||n.dataset.boundary==='true';});},valid};
}
