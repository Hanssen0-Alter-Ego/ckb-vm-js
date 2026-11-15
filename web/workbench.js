import { ckb, ckbToHex } from './guided.js';
import { resolveCell, scriptChoices, inspectRequest, mutateCellList } from './workbench-model.js';

// The JSON request is the source of truth. Each edit changes only its target field.
export function createWorkbench(root, { read, write, edited }) {
  let disabled = false;
  let selection = null;
  const expanded = new Set();
  let restoreFocus;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (label, action, parent) => { const b = el('button', label, 'secondary'); b.type = 'button'; b.disabled = disabled; b.onclick = () => { if (valid()) { try { action(); } catch (e) { error.textContent = e.message; } } }; parent.append(b); return b; };
  const commit = (fn, render = true) => { const next = structuredClone(read()); fn(next); write(next); if (render && ![...root.querySelectorAll('input,textarea,select')].some(n => !n.checkValidity())) refresh(); };
  function field(parent, label, value, apply, { area = false, options, parse = v => v } = {}) {
    const wrap = el('label', label, 'wb-field');
    const input = el(options ? 'select' : area ? 'textarea' : 'input');
    if (options) for (const [v, title] of options) { const o = el('option', title); o.value = v; input.append(o); }
    input.value = value ?? ''; input.disabled = disabled; input.spellcheck = false;
    input.oninput = () => { edited(); try { parse(input.value); input.setCustomValidity(''); } catch(e) { input.setCustomValidity(e.message); } };
    input.onchange = () => {
      try { const v = parse(input.value); commit(r => apply(r, v), false); }
      catch (e) { input.setCustomValidity(e.message); error.textContent = `${label}: ${e.message}`; input.reportValidity(); }
    };
    wrap.append(input); parent.append(wrap); return input;
  }
  function valid() { const bad = [...root.querySelectorAll('input,textarea,select')].find(n => !n.checkValidity()); if (bad) { bad.reportValidity(); return false; } return true; }
  let error;
  function script(parent, title, value, getOutput, key, request) {
    const details = el('details'); details.append(el('summary', title)); parent.append(details);
    if (!value) { button(`Add ${title}`, () => commit(r => { getOutput(r)[key] = structuredClone(scriptChoices(r)[0] ?? {code_hash:`0x${'0'.repeat(64)}`,hash_type:'data2',args:'0x'}); }), details); return; }
    const choices = scriptChoices(request);
    const selector = el('select'); selector.setAttribute('aria-label', `${title} · use existing script`); selector.disabled = disabled;
    const empty = el('option','Use an existing script…'); empty.value = ''; selector.append(empty);
    choices.forEach((s,i) => {const o=el('option',`${i+1} · ${s.hash_type} · ${s.code_hash.slice(0,16)}… · args ${s.args}`);o.value=String(i);selector.append(o);});
    selector.onchange=()=>{if(selector.value!=='')commit(r=>{getOutput(r)[key]=structuredClone(choices[Number(selector.value)]);});};details.append(selector);
    for(const name of ['code_hash','hash_type','args']) field(details, `${title} ${name}`, value[name], (r,v)=>{getOutput(r)[key][name]=v;}, name==='hash_type'?{options:['data','data1','data2','type'].map(v=>[v,v])}:{});
    if(key==='type')button('Remove type script',()=>commit(r=>{getOutput(r).type=null;}),details);
  }
  function refresh() {
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
    field(root,'Maximum cycles (RPC hex)',r.max_cycles,(q,v)=>{q.max_cycles=v;});
    for(const kind of ['inputs','outputs']) {
      const section=el('section',undefined,'wb-section');section.append(el('h3',kind==='inputs'?'Input cells':'Output cells'));root.append(section);
      if(!Array.isArray(r.transaction[kind])) {section.append(el('p',`${kind} is not an array. Correct it in JSON.`));continue;}
      r.transaction[kind].forEach((item,i)=>{
        const card=el('article',undefined,'wb-card');card.append(el('h4',`${kind==='inputs'?'Input':'Output'} ${i+1}`));section.append(card);
        const tools=el('div',undefined,'wb-tools');card.append(tools);
        for(const [action,label] of [['duplicate','Copy'],['up','↑'],['down','↓'],['remove','Remove']])button(label,()=>{try{write(mutateCellList(read(),kind,action,i));if(action==='up'&&i>0)selection=`${kind}:${i-1}`;else if(action==='down'&&i<read().transaction[kind].length-1)selection=`${kind}:${i+1}`;else if(action==='remove')selection=null;refresh();}catch(e){error.textContent=e.message;}},tools);
        if (!item || typeof item !== 'object' || Array.isArray(item)) { card.append(el('p','Invalid cell entry. Correct this entry in JSON.','wb-error')); return; }
        const input=kind==='inputs';
        const cell=input?resolveCell(r,item?.previous_output):{output:item,data:r.transaction.outputs_data?.[i]};
        const getCell=q=>input?resolveCell(q,q.transaction.inputs[i].previous_output):null;
        const getOutput=q=>input?getCell(q).output:q.transaction.outputs[i];
        if(input){
          field(card,`Input ${i+1} since (RPC hex)`,item.since,(q,v)=>{q.transaction.inputs[i].since=v;});
          card.append(el('p',`Outpoint: ${item.previous_output?.tx_hash}:${item.previous_output?.index}`,'hint'));
        }
        if(!cell?.output){card.append(el('p','Missing resolved cell. Add the matching context.cells entry in JSON.','wb-error'));return;}
        let capacity;try{capacity=ckb(cell.output.capacity);}catch{capacity='';}
        field(card,`${input?'Input':'Output'} ${i+1} capacity (CKB)`,capacity,(q,v)=>{getOutput(q).capacity=v;},{parse:ckbToHex});
        field(card,`${input?'Input':'Output'} ${i+1} data (hex)`,cell.data,(q,v)=>{if(input)getCell(q).data=v;else q.transaction.outputs_data[i]=v;});
        script(card,`${input?'Input':'Output'} ${i+1} lock`,cell.output.lock,getOutput,'lock',r);
        script(card,`${input?'Input':'Output'} ${i+1} type`,cell.output.type,getOutput,'type',r);
      });
      button(`Add ${kind==='inputs'?'synthetic input':'output'}`,()=>{try{write(mutateCellList(read(),kind,'add'));refresh();}catch(e){error.textContent=e.message;}},section);
      if(kind==='inputs')section.append(el('p','Adding or copying creates a synthetic, unconfirmed cell with a unique outpoint. Existing cells and witness positions are not rewritten.','hint'));
    }
    const witnesses=el('section',undefined,'wb-section');witnesses.append(el('h3','Witnesses'));root.append(witnesses);
    if(Array.isArray(r.transaction.witnesses)) {
      r.transaction.witnesses.forEach((v,i)=>{field(witnesses,`Witness ${i} (hex)`,v,(q,x)=>{q.transaction.witnesses[i]=x;},{area:true});button(`Remove witness ${i}`,()=>commit(q=>{q.transaction.witnesses.splice(i,1);}),witnesses);});
      button('Add witness',()=>commit(q=>{q.transaction.witnesses.push('0x');}),witnesses);
    } else witnesses.append(el('p','witnesses must be an array; edit JSON.','wb-error'));
    const deps=el('section',undefined,'wb-section');deps.append(el('h3','Cell dependencies'));root.append(deps);
    if(Array.isArray(r.transaction.cell_deps)) {
      r.transaction.cell_deps.forEach((dep,i)=>{const row=el('div',undefined,'wb-card');deps.append(row);if (!dep || typeof dep !== 'object' || Array.isArray(dep)) { row.append(el('p','Invalid dependency entry. Correct it in JSON.','wb-error')); return; }row.append(el('p',`${dep.out_point?.tx_hash}:${dep.out_point?.index}`,'hint'));field(row,`Dependency ${i+1} kind`,dep.dep_type,(q,v)=>{q.transaction.cell_deps[i].dep_type=v;},{options:[['code','Code'],['dep_group','Dep group']]});button(`Remove dependency ${i+1}`,()=>commit(q=>{q.transaction.cell_deps.splice(i,1);selection='deps';}),row);});
      const select=el('select');select.disabled=disabled;select.setAttribute('aria-label','Resolved cell to add as dependency');r.context.cells.forEach((c,i)=>{const o=el('option',`${i+1} · ${c?.out_point?.tx_hash}:${c?.out_point?.index}`);o.value=String(i);select.append(o);});deps.append(select);
      button('Add selected cell as code dependency',()=>commit(q=>{const c=q.context.cells[Number(select.value)];if(!c?.out_point)throw new Error('Select a resolved cell with an outpoint.');q.transaction.cell_deps.push({out_point:structuredClone(c.out_point),dep_type:'code'});}),deps);
    }
    deps.append(el('p','Only supplied resolved cells are listed. This does not infer code hashes or expand dep groups. JSON remains available for custom binaries, hashes and context.','hint'));
    const group=el('details');group.append(el('summary','Verification scope'));root.append(group);
    if(r.script_group){field(group,'Group kind',r.script_group.group_type,(q,v)=>{q.script_group.group_type=v;},{options:[['lock','Lock'],['type','Type']]});field(group,'Script hash',r.script_group.script_hash,(q,v)=>{q.script_group.script_hash=v;});button('Verify full transaction instead',()=>commit(q=>{delete q.script_group;}),group);}
    else button('Select a script group',()=>commit(q=>{q.script_group={group_type:'lock',script_hash:`0x${'0'.repeat(64)}`};}),group);
    overview(r, report);
    if(activeLabel) [...root.querySelectorAll('dialog label')].find(n=>n.firstChild?.textContent===activeLabel)?.querySelector('input,select,textarea')?.focus();
    root.querySelectorAll('details').forEach(d => { d.open = opened.has(d.querySelector('summary')?.textContent); });
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
    const scriptId = value => { const index=choices.findIndex(s=>s.code_hash?.toLowerCase()===value?.code_hash?.toLowerCase()&&s.hash_type===value?.hash_type&&s.args?.toLowerCase()===value?.args?.toLowerCase()); return index<0?'?':String(index+1); };
    for (const [kind, section] of [['inputs',inputs],['outputs',outputs]]) {
      const column = el('section',undefined,'cell-column'); columns.append(column);
      const list = r.transaction[kind];
      column.append(el('h2',`${kind==='inputs'?'Inputs':'Outputs'} · ${Array.isArray(list)?list.length:'invalid'}`));
      const cards=[...section.querySelectorAll(':scope > .wb-card')];
      if(!Array.isArray(list)) column.append(el('p',`${kind} must be an array. Open JSON to repair.`, 'wb-error'));
      const items=Array.isArray(list)?list:[];
      cards.forEach((editor,i)=> {
        const key=`${kind}:${i}`; editors.set(key,[`${kind==='inputs'?'Input':'Output'} ${i+1}`,editor]);
        const cell=kind==='inputs'?resolveCell(r,items[i]?.previous_output):{output:items[i],data:r.transaction.outputs_data?.[i]};
        const b=el('button',undefined,'cell-preview'); b.type='button'; b.disabled=disabled;
        b.setAttribute('aria-label',`Edit ${kind==='inputs'?'input':'output'} ${i+1}`);
        b.onclick=()=>open(key,b);
        b.append(el('span',`${kind==='inputs'?'IN':'OUT'} ${i+1}`,'cell-number'));
        let capacity='Invalid capacity'; try{capacity=`${ckb(cell.output.capacity)} CKB`;}catch{}
        b.append(el('strong',capacity));
        const meta=el('span',undefined,'cell-meta');
        const script=cell?.output?.lock;
        meta.append(el('span',script?`Lock ${scriptId(script)}`:'Unresolved lock','script-chip'));
        if(cell?.output?.type)meta.append(el('span',`Type ${scriptId(cell.output.type)}`,'script-chip'));
        const data=cell?.data;meta.append(el('span',typeof data==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(data)?`${(data.length-2)/2} B data`:'Invalid data'));
        b.append(meta);
        if(!cell?.output || report.diagnostics.some(d=>d.path.includes(`${kind}[${i}]`) || d.path.includes(`outputs_data[${i}]`))) b.append(el('span','⚠ Needs attention','cell-warning'));
        if(i>=4 && !expanded.has(kind)) b.hidden=true;
        column.append(b);
      });
      if(items.length>4){const show=el('button',expanded.has(kind)?'Show first 4':`Browse all ${items.length} cells`,'secondary browse-cells');show.type='button';show.onclick=()=>{if(!valid())return;expanded.has(kind)?expanded.delete(kind):expanded.add(kind);refresh();};column.append(show);}
      const add=section.querySelector(':scope > button');if(add)column.append(add);
    }
    const rail=el('div',undefined,'object-rail'); snapshot.append(rail);
    const depRail=el('div',undefined,'dep-rail'); depRail.append(el('span','Dependencies','rail-label'));rail.append(depRail);
    const depCards=[...deps.querySelectorAll(':scope > .wb-card')];
    depCards.forEach((editor,i)=>{
      const key=`dep:${i}`;editors.set(key,[`Dependency ${i+1}`,editor]);
      const b=el('button',String(i+1),'dep-dot'); b.type='button';b.disabled=disabled;
      b.style.setProperty('--dot', ['#a8d98d','#9db7ff','#ffcb86','#dca8eb','#82d5ca','#eea1ad'][i%6]);
      b.setAttribute('aria-label',`Dependency ${i+1} · ${r.transaction.cell_deps[i]?.dep_type??'invalid'} · open details`);
      b.title=b.getAttribute('aria-label');b.onclick=()=>open(key,b);depRail.append(b);
    });
    if(!depCards.length)depRail.append(el('span','None','hint'));
    editors.set('deps',['Manage dependencies',deps]);
    const manage=button('Manage',()=>open('deps',manage),depRail);manage.setAttribute('aria-label','Manage dependencies');
    editors.set('witnesses',['Witnesses',witnesses]);
    const witnessButton=button(`Witnesses · ${Array.isArray(r.transaction.witnesses)?r.transaction.witnesses.length:'invalid'}`,()=>open('witnesses',witnessButton),rail);witnessButton.setAttribute('aria-label',witnessButton.textContent);
    const settings=el('section'); settings.append(cycles,scope);
    settings.append(el('p','Consensus, headers and full context remain editable in JSON. Cells added here are synthetic. No chain data is fetched.','hint'));
    editors.set('settings',['Verification settings',settings]);
    const settingsButton=button('Settings',()=>open('settings',settingsButton),rail);settingsButton.setAttribute('aria-label','Settings');
    root.replaceChildren(error,snapshot);
    if(diagnostics?.children.length){const alert=el('details',undefined,'diagnostic-summary');alert.open=true;alert.append(el('summary',`${diagnostics.children.length} preflight warning${diagnostics.children.length===1?'':'s'} · not VM results`),diagnostics);root.append(alert);}
    const dialog=el('dialog',undefined,'inspector');dialog.setAttribute('aria-labelledby','inspector-title');root.append(dialog);
    function open(key,trigger) {
      if(!valid())return;
      if(trigger)restoreFocus=trigger.getAttribute('aria-label');
      selection=key;
      const entry=editors.get(key);if(!entry){selection=null;return;}
      // Return dependency editors to their management container before switching.
      depCards.forEach(card=>deps.insertBefore(card,deps.querySelector(':scope > select')));
      dialog.replaceChildren();
      const top=el('div',undefined,'inspector-heading');const title=el('h2',entry[0]);title.id='inspector-title';top.append(title);
      const close=el('button','Done','secondary');close.type='button';close.onclick=finish;top.append(close);dialog.append(top,error,entry[1]);
      dialog.querySelectorAll('input,select,textarea,button').forEach(n=>{n.disabled=disabled;});
      if(!dialog.open)dialog.showModal();
    }
    function finish(){if(!valid())return;selection=null;dialog.close();refresh();if(restoreFocus)[...root.querySelectorAll('[aria-label]')].find(n=>n.getAttribute('aria-label')===restoreFocus)?.focus();}
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
    dialog.addEventListener('close',()=>{if(!selection&&restoreFocus)[...root.querySelectorAll('[aria-label]')].find(n=>n.getAttribute('aria-label')===restoreFocus)?.focus();});
    if(selection)open(selection);
  }
  return {refresh,setBusy(v){disabled=v;root.querySelectorAll('input,select,textarea,button').forEach(n=>{n.disabled=v;});},valid};
}
