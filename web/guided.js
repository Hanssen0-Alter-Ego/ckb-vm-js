export function ckbToHex(value) {
  if (!/^\d{1,12}(\.\d{1,8})?$/.test(value)) throw new Error('Enter a non-negative CKB amount with up to 8 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const shannons = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
  if (shannons > 0xffffffffffffffffn) throw new Error('This amount is too large.');
  return `0x${shannons.toString(16)}`;
}
export function ckb(value) {
  const amount = BigInt(value);
  const sign = amount < 0n ? '-' : '';
  const abs = amount < 0n ? -amount : amount;
  const decimal = (abs % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
  return `${sign}${abs / 100000000n}${decimal ? '.' + decimal : ''}`;
}
export function guidedRequest(base, amount, budget) {
  if (!['100', '10000000'].includes(budget)) throw new Error('Choose one of the available cycle budgets.');
  const request = structuredClone(base);
  request.transaction.outputs[0].capacity = ckbToHex(amount);
  request.max_cycles = `0x${BigInt(budget).toString(16)}`;
  return request;
}
/** Describe only groups confirmed by a successful engine result. */
export function verifiedGroupSummary(result, request) {
  if (result?.ok !== true || !['script_group','transaction'].includes(result.scope)) return null;
  const selected=result.scope==='script_group';
  const unavailable={title:'Script group membership',text:'Group membership is unavailable in this engine response. See Full engine response.',selected};
  const inputs=request?.transaction?.inputs,outputs=request?.transaction?.outputs;
  if(!Array.isArray(result.groups)||!Array.isArray(inputs)||!Array.isArray(outputs))return unavailable;
  let groups=result.groups;
  if(selected){const choice=request?.script_group;if(!['lock','type'].includes(choice?.group_type)||typeof choice?.script_hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(choice.script_hash))return unavailable;groups=groups.filter(g=>g?.group_type===choice.group_type&&typeof g.script_hash==='string'&&g.script_hash.toLowerCase()===choice.script_hash.toLowerCase());if(groups.length!==1)return unavailable;}
  const valid=(g)=>['lock','type'].includes(g?.group_type)&&typeof g.script_hash==='string'&&/^0x[0-9a-f]{64}$/i.test(g.script_hash)&&Array.isArray(g.input_indices)&&Array.isArray(g.output_indices)&&g.input_indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<inputs.length)&&g.output_indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<outputs.length);
  if(!groups.every(valid))return unavailable;
  const members=indices=>indices.length?indices.map(i=>`index ${i}`).join(', '):'none';
  const lines=groups.map(g=>`${g.group_type==='lock'?'Lock':'Type'} group — Inputs: ${members(g.input_indices)}; Outputs: ${members(g.output_indices)}.`);
  return {title:selected?'Selected script group members':`Verified script groups (${groups.length})`,text:lines.length?lines.join('\n'):'The engine reported no script groups.',selected};
}

export function explain(result, request) {
  if (result.ok) {
    if(result.scope==='script_group')return 'Other script groups and the complete transaction were not checked. Chain state was not checked.';
    if(result.scope==='transaction')return `Inputs, outputs and scripts satisfied the supplied rules.${result.fee !== undefined ? `\nFee in this snapshot: ${ckb(result.fee)} CKB.` : ''}\nThis does not check whether cells exist or are unspent on a network.`;
    return 'The engine did not report the verification scope. See Full engine response.';
  }
  const error = `${result.error?.code ?? ''} ${result.error?.message ?? ''}`;
  const missingExtension=result.error?.code==='MissingContext' && /^explicit extension data or null required for (0x[0-9a-f]{64})$/i.exec(result.error?.message ?? '');
  if(missingExtension){
    const hash=missingExtension[1];const refs=Array.isArray(request?.transaction?.header_deps)?request.transaction.header_deps.flatMap((h,i)=>typeof h==='string'&&h.toLowerCase()===hash.toLowerCase()?[`Header dep index ${i}`]:[]):[];
    const where=refs.length?`${refs.join(', ')} (${hash})`:`block ${hash} (a header dependency or supplied cell origin)`;
    return `Missing extension information for ${where}. The snapshot must explicitly supply extension bytes or assert no extension (null). For a header dependency, open its details and choose Extension information. Unspecified does not mean no extension.`;
  }
  const invalidGroup=result.error?.code==='Resolution' && /^InvalidDepGroup\(OutPoint\(0x([0-9a-f]{64})([0-9a-f]{8})\)\)$/i.exec(result.error?.message ?? '');
  if(invalidGroup){
    const hash=`0x${invalidGroup[1]}`;const encoded=invalidGroup[2];const index=parseInt(encoded.match(/../g).reverse().join(''),16);
    const matches=Array.isArray(request?.transaction?.cell_deps)?request.transaction.cell_deps.flatMap((dep,i)=>{const point=dep?.out_point;try{return dep?.dep_type==='dep_group'&&typeof point?.tx_hash==='string'&&point.tx_hash.toLowerCase()===hash.toLowerCase()&&typeof point?.index==='string'&&/^0x[0-9a-f]+$/i.test(point.index)&&BigInt(point.index)===BigInt(index)?[i]:[];}catch{return [];}}):[];
    const location=matches.length?matches.map(i=>`Cell dep index ${i}`).join(', '):`outpoint ${hash}:0x${index.toString(16)}`;
    return `The engine could not resolve the dependency group at ${location}. Check the group cell's encoded member outpoints and supplied cells. Open Full engine response for the exact error.`;
  }
  if (/OutputsSumOverflow|OutputsCapacity|CapacityOverflow|outputs capacity.*inputs|outputs sum/i.test(error)) return 'The new cells contain more CKB than the inputs provide. A transaction cannot create extra CKB. Lower the new cell capacity and run again.';
  if (/ExceededMaximumCycles|CyclesExceeded|cycles.*exceed|exceed.*cycles/i.test(error)) return 'The computation budget ran out. The VM could not finish within this limit. Try the normal cycle budget; this does not change the transaction fee.';
  const scriptFailure=result.error?.code==='InvalidTransaction' && /^Script\(TransactionScriptError \{ source: (Inputs|Outputs)\[([0-9]+)\]\.(Lock|Type), cause: ValidationFailure: see error code (-?[0-9]+) on page \S+ \}\)$/.exec(result.error?.message ?? '');
  if(scriptFailure){const [,side,index,kind,code]=scriptFailure;return `A script rejected this snapshot: ${side}[${index}].${kind}, error code ${code}. Open Full engine response for the original error.`;}
  if (/Script.*ValidationFailure|ValidationFailure|script_failure/i.test(error)) return 'A script rejected this snapshot. Open Full engine response for its exact reason.';
  if (/OccupiedCapacity|InsufficientCellCapacity/i.test(error)) return 'The new cell is too small to hold its data and scripts. Increase its capacity and run again.';
  return 'The engine rejected this snapshot. Open Full engine response for its exact reason. A failure can come from a transaction rule, a script, or incomplete supplied context.';
}

