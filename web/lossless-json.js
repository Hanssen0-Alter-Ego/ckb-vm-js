// The workbench retains JSON number tokens that JavaScript cannot safely round-trip.
// Markers are chosen outside the imported document and survive structuredClone.
let marker = '';
let sequence = 0;

export function parseLossless(text) {
  const original = JSON.parse(text); // Validate before transforming any tokens.
  const serialized = JSON.stringify(original);
  do { marker = `__ckb_workbench_number_${sequence++}__`; } while (serialized.includes(marker));
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const transformed = text.replace(tokens, token => {
    if (token[0] === '"') return token;
    const number = Number(token);
    if (/^-?(?:0|[1-9]\d*)$/.test(token) && token !== '-0' && Number.isSafeInteger(number)) return token;
    return `{${JSON.stringify(marker)}:${JSON.stringify(token)}}`;
  });
  return JSON.parse(transformed);
}

export function rawNumber(value) {
  return !!marker && value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 1 && typeof value[marker] === 'string' ? value[marker] : null;
}

export function stringifyLossless(value, space = 2) {
  // Find a placeholder absent from every ordinary string and key so replacement
  // cannot change imported data, even when it resembles an internal marker.
  let snapshot = JSON.stringify(value);
  let prefix;
  do { prefix = `__ckb_workbench_placeholder_${sequence++}__`; } while (snapshot.includes(prefix));
  const numbers = [];
  let result = JSON.stringify(value, (_key, item) => {
    const raw = rawNumber(item);
    if (raw === null) return item;
    numbers.push(raw);
    return `${prefix}${numbers.length - 1}__`;
  }, space);
  numbers.forEach((raw, index) => { result = result.split(JSON.stringify(`${prefix}${index}__`)).join(raw); });
  return result;
}
