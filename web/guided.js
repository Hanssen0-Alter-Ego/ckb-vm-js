export function ckbToHex(value) {
  if (!/^\d{1,11}(\.\d{1,8})?$/.test(value)) throw new Error('Enter a non-negative CKB amount with up to 8 decimal places.');
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
export function explain(result) {
  if (result.ok) return result.scope === 'script_group'
    ? 'The selected script accepted this snapshot. Other scripts and the complete transaction were not checked.'
    : `The supplied transaction passed. Its inputs, outputs and scripts satisfied the supplied rules.${result.fee !== undefined ? `\nFee in this snapshot: ${ckb(result.fee)} CKB.` : ''}\nThis does not check whether the cells really exist or are unspent on a network.`;
  const error = `${result.error?.code ?? ''} ${result.error?.message ?? ''}`;
  if (/OutputsSumOverflow|OutputsCapacity|CapacityOverflow|outputs capacity.*inputs|outputs sum/i.test(error)) return 'The new cells contain more CKB than the inputs provide. A transaction cannot create extra CKB. Lower the new cell capacity and run again.';
  if (/ExceededMaximumCycles|CyclesExceeded|cycles.*exceed|exceed.*cycles/i.test(error)) return 'The computation budget ran out. The VM could not finish within this limit. Try the normal cycle budget; this does not change the transaction fee.';
  if (/Script.*ValidationFailure|ValidationFailure|script_failure/i.test(error)) return 'A script rejected the transaction. In the “Lock says no” experiment, the toy lock intentionally returns a failure. A valid balance alone is not enough.';
  if (/OccupiedCapacity|InsufficientCellCapacity/i.test(error)) return 'The new cell is too small to hold its data and scripts. Increase its capacity and run again.';
  return 'The engine rejected this snapshot. Open Technical details for its exact reason. A failure can come from a transaction rule, a script, or incomplete supplied context.';
}
