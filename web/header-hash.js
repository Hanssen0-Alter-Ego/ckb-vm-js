// CKB RFC 0027: Header is the fixed-width RawHeader followed by uint128 nonce.
// Hash with 32-byte BLAKE2b and the CKB personalization; this does not verify PoW.
import { blake2b } from './vendor/noble-hashes/blake2.js';
const fields=[['version',4],['compact_target',4],['timestamp',8],['number',8],['epoch',8],['parent_hash',32],['transactions_root',32],['proposals_hash',32],['extra_hash',32],['dao',32],['nonce',16]];
export function headerHash(header){
  if(!header||typeof header!=='object'||Array.isArray(header))throw new Error('A complete header object is required.');
  const bytes=new Uint8Array(208);let offset=0;
  for(const [name,width] of fields){
    const value=header[name];
    if(width===32){if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/i.test(value))throw new Error(`${name} must be a 32-byte hex value.`);for(let i=0;i<32;i++)bytes[offset+i]=parseInt(value.slice(2+i*2,4+i*2),16);}
    else {if(typeof value!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))throw new Error(`${name} must be a canonical RPC hex integer.`);let n=BigInt(value);if(n >= (1n<<BigInt(width*8)))throw new Error(`${name} exceeds ${width*8} bits.`);for(let i=0;i<width;i++){bytes[offset+i]=Number(n&255n);n>>=8n;}}
    offset+=width;
  }
  return '0x'+Array.from(blake2b(bytes,{dkLen:32,personalization:new TextEncoder().encode('ckb-default-hash')}),x=>x.toString(16).padStart(2,'0')).join('');
}
