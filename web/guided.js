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
export function explain(result, request) {
  if (result.ok) return result.scope === 'script_group'
    ? 'The selected script accepted this snapshot. Other scripts and the complete transaction were not checked.'
    : `The supplied transaction passed. Its inputs, outputs and scripts satisfied the supplied rules.${result.fee !== undefined ? `\nFee in this snapshot: ${ckb(result.fee)} CKB.` : ''}\nThis does not check whether the cells really exist or are unspent on a network.`;
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
  if (/Script.*ValidationFailure|ValidationFailure|script_failure/i.test(error)) return 'A script rejected the transaction. In the “Rejecting lock” example, the toy lock intentionally returns a failure. A valid balance alone is not enough.';
  if (/OccupiedCapacity|InsufficientCellCapacity/i.test(error)) return 'The new cell is too small to hold its data and scripts. Increase its capacity and run again.';
  return 'The engine rejected this snapshot. Open Full engine response for its exact reason. A failure can come from a transaction rule, a script, or incomplete supplied context.';
}

