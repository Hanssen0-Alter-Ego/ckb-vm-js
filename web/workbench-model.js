import { ckb } from './guided.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const quantity = (value) => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const bytes = (value) => typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value);
const hash = (value) => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const key = (point) => object(point) && hash(point.tx_hash) && quantity(point.index)
  ? `${point.tx_hash.toLowerCase()}:${BigInt(point.index)}` : null;

/** Resolve only an unambiguous supplied cell. Never invent chain context. */
export function resolveCell(request, outpoint) {
  const wanted = key(outpoint);
  if (wanted === null || !Array.isArray(request?.context?.cells)) return undefined;
  const matches = request.context.cells.filter(cell => key(cell?.out_point) === wanted);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Existing script values, cloned so selecting one cannot alias another cell. */
export function scriptChoices(request) {
  const scripts = [];
  const seen = new Set();
  const outputs = [
    ...(Array.isArray(request?.transaction?.outputs) ? request.transaction.outputs : []),
    ...(Array.isArray(request?.context?.cells) ? request.context.cells.map(cell => cell?.output) : []),
  ];
  for (const output of outputs) for (const script of [output?.lock, output?.type]) {
    if (!object(script) || !hash(script.code_hash) || !['data', 'data1', 'data2', 'type'].includes(script.hash_type) || !bytes(script.args)) continue;
    const identity = JSON.stringify([script.code_hash.toLowerCase(), script.hash_type, script.args.toLowerCase()]);
    if (!seen.has(identity)) { seen.add(identity); scripts.push(structuredClone(script)); }
  }
  return scripts;
}

/** Editing assistance only. Not a substitute for schema, consensus or VM validation. */
export function inspectRequest(request) {
  const diagnostics = [];
  const issue = (path, message) => diagnostics.push({ path, message });
  const tx = request?.transaction;
  const context = request?.context;
  if (!object(tx)) issue('transaction', 'Expected a transaction object.');
  if (!object(context)) issue('context', 'Expected an explicit context object.');
  if (!object(context?.consensus)) issue('context.consensus', 'Consensus parameters are missing.');
  if (!object(context?.tip_header)) issue('context.tip_header', 'Tip header is missing.');
  if (!quantity(request?.max_cycles)) issue('max_cycles', 'Use an RPC hex integer for the cycle budget.');
  for (const name of ['inputs', 'outputs', 'outputs_data', 'cell_deps', 'header_deps', 'witnesses']) {
    if (!Array.isArray(tx?.[name])) issue(`transaction.${name}`, 'Expected an array.');
  }
  if (!Array.isArray(context?.cells)) issue('context.cells', 'Resolved cells are missing.');
  const cells = Array.isArray(context?.cells) ? context.cells : [];
  const counts = new Map();
  cells.forEach((cell, index) => {
    const identity = key(cell?.out_point);
    if (identity === null) issue(`context.cells[${index}].out_point`, 'Expected a 32-byte transaction hash and RPC hex index.');
    else { counts.set(identity, (counts.get(identity) ?? 0) + 1); }
  });
  for (const [identity, count] of counts) if (count > 1) issue('context.cells', `Multiple resolved cells share ${identity}; references are ambiguous.`);
  const inspectOutput = (output, path) => {
    if (!object(output)) { issue(path, 'Cell output is missing.'); return null; }
    let capacity = null;
    if (!quantity(output.capacity) || BigInt(output.capacity) > 0xffffffffffffffffn) issue(`${path}.capacity`, 'Expected an unsigned 64-bit RPC hex capacity.');
    else capacity = BigInt(output.capacity);
    for (const kind of ['lock', 'type']) {
      const script = output[kind];
      if (kind === 'type' && script == null) continue;
      if (!object(script)) { issue(`${path}.${kind}`, 'Expected a script object.'); continue; }
      if (!hash(script.code_hash)) issue(`${path}.${kind}.code_hash`, 'Expected a 32-byte code hash.');
      if (!['data', 'data1', 'data2', 'type'].includes(script.hash_type)) issue(`${path}.${kind}.hash_type`, 'Choose data, data1, data2 or type.');
      if (!bytes(script.args)) issue(`${path}.${kind}.args`, 'Expected even-length hex bytes beginning with 0x.');
    }
    return capacity;
  };
  let inputTotal = Array.isArray(tx?.inputs) ? 0n : null;
  const inputKeys = new Set();
  (Array.isArray(tx?.inputs) ? tx.inputs : []).forEach((input, index) => {
    const path = `transaction.inputs[${index}]`;
    const identity = key(input?.previous_output);
    if (identity === null) issue(`${path}.previous_output`, 'Expected a 32-byte transaction hash and RPC hex index.');
    else if (inputKeys.has(identity)) issue(`${path}.previous_output`, 'This input is already spent elsewhere in the request.');
    else inputKeys.add(identity);
    if (!quantity(input?.since) || BigInt(input.since) > 0xffffffffffffffffn) issue(`${path}.since`, 'Expected an unsigned 64-bit RPC hex since value.');
    const cell = resolveCell(request, input?.previous_output);
    if (!cell) { issue(`${path}.previous_output`, 'Missing or ambiguous resolved cell in context.cells.'); inputTotal = null; return; }
    const capacity = inspectOutput(cell.output, `context.cells[${cells.indexOf(cell)}].output`);
    if (!bytes(cell.data)) issue(`context.cells[${cells.indexOf(cell)}].data`, 'Expected even-length hex bytes beginning with 0x.');
    if (!Object.hasOwn(cell, 'transaction_info')) issue(`context.cells[${cells.indexOf(cell)}].transaction_info`, 'Explicit origin metadata or null is required.');
    if (capacity === null) inputTotal = null;
    else if (inputTotal !== null) inputTotal += capacity;
  });
  let outputTotal = Array.isArray(tx?.outputs) ? 0n : null;
  (Array.isArray(tx?.outputs) ? tx.outputs : []).forEach((output, index) => {
    const capacity = inspectOutput(output, `transaction.outputs[${index}]`);
    if (capacity === null) outputTotal = null;
    else if (outputTotal !== null) outputTotal += capacity;
  });
  if (Array.isArray(tx?.outputs) && Array.isArray(tx?.outputs_data) && tx.outputs.length !== tx.outputs_data.length) issue('transaction.outputs_data', 'One data entry is required per output. No entries were added or removed automatically.');
  for (const name of ['outputs_data', 'witnesses']) (Array.isArray(tx?.[name]) ? tx[name] : []).forEach((data, index) => {
    if (!bytes(data)) issue(`transaction.${name}[${index}]`, 'Expected even-length hex bytes beginning with 0x.');
  });
  (Array.isArray(tx?.cell_deps) ? tx.cell_deps : []).forEach((dep, index) => {
    if (!['code', 'dep_group'].includes(dep?.dep_type)) issue(`transaction.cell_deps[${index}].dep_type`, 'Choose code or dep_group.');
    if (!resolveCell(request, dep?.out_point)) issue(`transaction.cell_deps[${index}].out_point`, 'Missing or ambiguous dependency cell in context.cells.');
  });
  if (inputTotal !== null && outputTotal !== null && outputTotal > inputTotal) issue('transaction.outputs', 'Output capacity exceeds input capacity. The engine will decide validity.');
  return { diagnostics, inputTotal: inputTotal === null ? null : ckb(inputTotal), outputTotal: outputTotal === null ? null : ckb(outputTotal) };
}

function assertLists(request, kind) {
  if (!object(request) || !object(request.transaction) || !Array.isArray(request.transaction[kind])) throw new Error(`transaction.${kind} must be an array; edit the JSON to restore its structure.`);
  if (kind === 'outputs' && (!Array.isArray(request.transaction.outputs_data) || request.transaction.outputs_data.length !== request.transaction.outputs.length)) throw new Error('Output and output-data counts differ. Edit the JSON first; the editor will not silently repair them.');
  if (kind === 'inputs' && !Array.isArray(request.context?.cells)) throw new Error('context.cells must be an array before adding or rearranging inputs.');
}
function freshOutPoint(request) {
  const used = new Set();
  for (const cell of request.context.cells) if (key(cell?.out_point)) used.add(key(cell.out_point));
  for (const input of request.transaction.inputs) if (key(input?.previous_output)) used.add(key(input.previous_output));
  for (const dep of request.transaction.cell_deps ?? []) if (key(dep?.out_point)) used.add(key(dep.out_point));
  // A deterministic, visibly synthetic ID; this is not a transaction hash calculation.
  for (let value = 1n; ; value++) {
    const point = { tx_hash: `0x${value.toString(16).padStart(64, '0')}`, index: '0x0' };
    if (!used.has(key(point))) return point;
  }
}

/** Explicit cell-list changes. Unrelated context, unknown fields and witnesses are retained. */
export function mutateCellList(request, kind, action, index = 0) {
  if (!['inputs', 'outputs'].includes(kind)) throw new Error('Choose inputs or outputs.');
  if (!['add', 'duplicate', 'remove', 'up', 'down'].includes(action)) throw new Error('Unknown cell-list action.');
  assertLists(request, kind);
  const result = structuredClone(request);
  const list = result.transaction[kind];
  if (action !== 'add' && (!Number.isInteger(index) || index < 0 || index >= list.length)) throw new Error('The selected cell no longer exists.');
  if (action === 'remove') {
    list.splice(index, 1);
    if (kind === 'outputs') result.transaction.outputs_data.splice(index, 1);
  } else if (action === 'up' || action === 'down') {
    const next = index + (action === 'up' ? -1 : 1);
    if (next < 0 || next >= list.length) throw new Error('The cell cannot move further in that direction.');
    [list[index], list[next]] = [list[next], list[index]];
    if (kind === 'outputs') [result.transaction.outputs_data[index], result.transaction.outputs_data[next]] = [result.transaction.outputs_data[next], result.transaction.outputs_data[index]];
  } else if (kind === 'outputs') {
    const source = list[action === 'duplicate' ? index : 0] ?? result.context?.cells?.find(cell => object(cell?.output))?.output;
    if (!object(source)) throw new Error('No output template is available. Import a sample or define the first output in JSON.');
    list.push(structuredClone(source));
    result.transaction.outputs_data.push(action === 'duplicate' ? result.transaction.outputs_data[index] : '0x');
  } else {
    const input = list[action === 'duplicate' ? index : 0];
    const cell = input ? resolveCell(result, input.previous_output) : undefined;
    if (input && !cell) throw new Error('The source input has no unique resolved cell. Supply its context before copying it.');
    const template = cell ?? (object(result.transaction.outputs?.[0]) ? { output: result.transaction.outputs[0], data: result.transaction.outputs_data?.[0] ?? '0x' } : undefined);
    if (!template) throw new Error('No cell template is available. Import a sample or define a cell in JSON.');
    const outpoint = freshOutPoint(result);
    result.context.cells.push({ ...structuredClone(template), out_point: outpoint, transaction_info: null });
    list.push({ ...structuredClone(input ?? {}), previous_output: structuredClone(outpoint), since: '0x0' });
  }
  return result;
}

/** UI-only decimal editing: never round RPC quantities through Number. */
export function decimalToRpc(value, bits = 64) {
  if(typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error('Enter a non-negative whole decimal number.');
  const n=BigInt(value);
  if(n >= (1n << BigInt(bits))) throw new Error(`Value exceeds unsigned ${bits}-bit range.`);
  return `0x${n.toString(16)}`;
}
export function rpcToDecimal(value) {
  return typeof value==='string' && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value).toString(10) : typeof value==='string' ? value : '';
}

/** Create an independent, explicitly synthetic resolved code cell; never add an input. */
export function addDependencyCell(request) {
  if(!Array.isArray(request?.context?.cells)||!Array.isArray(request?.transaction?.cell_deps)||!Array.isArray(request?.transaction?.inputs)) throw new Error('Resolved cells, cell deps and inputs must be arrays; repair malformed structure in JSON.');
  const next=structuredClone(request);const out_point=freshOutPoint(next);
  const cell={out_point,output:{capacity:'0x0',lock:{code_hash:`0x${'0'.repeat(64)}`,hash_type:'data2',args:'0x'},type:null},data:'0x',transaction_info:null};
  next.context.cells.push(cell);next.transaction.cell_deps.push({out_point:structuredClone(out_point),dep_type:'code'});return next;
}

/** Names are pinned to code hashes generated from upstream fixture binaries.
 * See crates/verifier/src/test_support.rs; this names a reference, not a verified execution. */
export function scriptName(script){
  const known={
    '0x28e83a1277d48add8e72fadaa9248559e1b632bab2bd60b27955ebc4c03800a5':'Always success',
    '0x342083c9f5e8f9bb866cb0ff1eafed2e29cfc7edd81e3e274c7b3b86a0fc519f':'Always failure',
  };
  const hash=typeof script?.code_hash==='string'?script.code_hash.toLowerCase():'';
  return script?.hash_type==='data2'&&known[hash]?known[hash]:`Custom / Unknown ${hash?hash.slice(2,8):'?'}`;
}
