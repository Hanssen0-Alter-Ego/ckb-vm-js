import { headerHash } from './header-hash.js';

// Candidates are calculated from header contents, never from an asserted hash.
export function headerCandidates(request){
  const context=request?.context ?? {};
  const items=[['Tip header',context.tip_header,['context','tip_header']]];
  if(context.verification?.candidate_header)items.push(['Candidate header',context.verification.candidate_header,['context','verification','candidate_header']]);
  if(Array.isArray(context.headers))context.headers.forEach((header,i)=>items.push([`Supplied header ${i+1}`,header,['context','headers',i]]));
  return items.filter(([,header])=>header&&typeof header==='object'&&!Array.isArray(header)).map(([source,header,path])=>{try{return {source,header,path,hash:headerHash(header)};}catch(error){return {source,header,path,hash:null,error:error.message};}});
}

export function linkExistingHeader(request, header){
  if(!Array.isArray(request?.transaction?.header_deps))throw new Error('Header dependencies must be an array.');
  const hash=headerHash(header);
  if(headerCandidates(request).filter(candidate=>candidate.hash===hash).length!==1)throw new Error('This header is missing or ambiguous in the supplied context.');
  const next=structuredClone(request);if(!next.transaction.header_deps.some(value=>typeof value==='string'&&value.toLowerCase()===hash))next.transaction.header_deps.push(hash);return next;
}

// Reuse matching supplied context or create a separate header. Preserve all old
// references; editing a copy only re-links the selected dependency.
export function addHeaderFromFields(request,header,{replaceIndex=null,extension='unspecified',extensionData='',addDependency=true}={}){
  if(!Array.isArray(request?.transaction?.header_deps)||!Array.isArray(request?.context?.headers))throw new Error('Header dependencies and supplied headers must be arrays.');
  if(replaceIndex!==null&&(!Number.isInteger(replaceIndex)||replaceIndex<0||replaceIndex>=request.transaction.header_deps.length))throw new Error('The selected header dependency no longer exists.');
  const hash=headerHash(header);const old=replaceIndex===null?null:request.transaction.header_deps[replaceIndex];
  const same=typeof old==='string'&&old.toLowerCase()===hash;
  if(addDependency&&replaceIndex!==null&&!same&&request.transaction.header_deps.some((value,index)=>index!==replaceIndex&&typeof value==='string'&&value.toLowerCase()===hash))throw new Error('This header is already linked at another dependency index. Remove this dependency instead, or choose different header fields; nothing was changed.');
  const matches=headerCandidates(request).filter(candidate=>candidate.hash===hash);
  if(matches.length>1)throw new Error('Multiple supplied headers share this hash. Remove the duplicate context entry before reusing it.');
  // Hash identity covers protocol fields, not arbitrary caller metadata.
  const fields=new Set(['version','compact_target','timestamp','number','epoch','parent_hash','transactions_root','proposals_hash','extra_hash','dao','nonce','hash']);
  if(matches.length){for(const [key,value] of Object.entries(header)){if(!fields.has(key)&&JSON.stringify(value)!==JSON.stringify(matches[0].header[key]))throw new Error(`This hash already exists with different ${key} metadata. Reconcile that metadata in JSON before reusing the header; nothing was changed.`);}}

  if(!['unspecified','none','bytes'].includes(extension))throw new Error('Choose an extension option.');
  if(extension==='bytes'&&!/^0x(?:[0-9a-f]{2})*$/i.test(extensionData))throw new Error('Extension data must be even-length hex bytes.');
  const next=structuredClone(request);
  if(!matches.length){const copy=structuredClone(header);if(Object.hasOwn(copy,'hash'))copy.hash=hash;next.context.headers.push(copy);}
  if(addDependency&&!same){if(replaceIndex!==null)next.transaction.header_deps[replaceIndex]=hash;else if(!next.transaction.header_deps.some(value=>typeof value==='string'&&value.toLowerCase()===hash))next.transaction.header_deps.push(hash);}
  if(extension!=='unspecified'){
    if(!Array.isArray(next.context.extensions))throw new Error('Extensions must be an array; existing data was not changed.');
    const records=next.context.extensions.filter(item=>typeof item?.block_hash==='string'&&item.block_hash.toLowerCase()===hash);
    const data=extension==='none'?null:extensionData;
    if(records.length>1||records.length===1&&(typeof data==='string'?records[0].data?.toLowerCase?.()!==data.toLowerCase():records[0].data!==data))throw new Error('Different or ambiguous extension information already exists for this hash. Use Extension information to edit it; nothing was changed.');
    if(!records.length)next.context.extensions.push({block_hash:hash,data});
  }
  return next;
}

// Explicitly set one extension record, preserving unknown fields; never merge duplicates.
export function setHeaderExtension(request,hash,kind,data=''){
  if(!/^0x[0-9a-f]{64}$/i.test(hash)||!Array.isArray(request?.context?.extensions))throw new Error('A valid header hash and extensions array are required.');
  if(!['none','bytes'].includes(kind))throw new Error('Choose whether this header has extension data.');
  if(kind==='bytes'&&!/^0x(?:[0-9a-f]{2})*$/i.test(data))throw new Error('Extension data must be even-length hex bytes.');
  const next=structuredClone(request);const matches=next.context.extensions.filter(item=>typeof item?.block_hash==='string'&&item.block_hash.toLowerCase()===hash.toLowerCase());
  if(matches.length>1)throw new Error('Multiple extension entries share this hash; existing data was not changed.');
  const value=kind==='none'?null:data;if(matches.length)matches[0].data=value;else next.context.extensions.push({block_hash:hash,data:value});return next;
}
