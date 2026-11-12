# Offline verifier request (foundation API)

`verify_json(json: &str) -> String` is the native API. WASM exports `verify(json: string): string`. Both return JSON, including on ordinary input/verification errors. No networking or chain-state maintenance is performed.

```js
{
  transaction: { /* CKB RPC Transaction, including witnesses */ },
  context: {
    tip_header: { /* current chain tip RPC Header */ },
    consensus: {
      tx_version: '0x...', max_block_bytes: '0x...', max_block_cycles: '0x...',
      cellbase_maturity: '0x...', median_time_block_count: '0x...',
      tx_proposal_window: { closest: '0x...', farthest: '0x...' },
      dao_type_hash: '0x...',
      hardforks: {
        rfc0028_epoch: '0x...', rfc0032_epoch: '0x...',
        rfc0049_epoch: '0x...', rfc0044_epoch: '0x...',
      },
      starting_block_limiting_dao_withdrawing_lock: '0x...',
    },
    // Optional; omitting it selects submitted mode.
    verification: { phase: 'submitted' },
    headers: [ /* RPC Header objects */ ],
    cells: [{
      out_point: { tx_hash: '0x...32 bytes', index: '0x0' },
      output: { capacity: '0x...', lock: { /* RPC Script */ }, type: null },
      data: '0x...',
      transaction_info: {
        block_hash: '0x...32 bytes', block_number: '0x...',
        block_epoch: '0x...', index: '0x1',
      },
    }],
    extensions: [{ block_hash: '0x...32 bytes', data: null }],
  },
  max_cycles: '0x989680',
}
```

This is a shape illustration, not runnable JSON or a network preset. Use `ckb-jsonrpc-types` Transaction, Header, OutPoint, CellOutput, and Script shapes. Integer quantities use canonical RPC `0x` strings; byte fields use even-length `0x` strings. Own wrapper objects reject unknown fields. Upstream RPC objects follow upstream serde parsing. Headers are keyed by their recomputed hashes rather than a separately asserted hash.

## Explicit consensus parameters

There is no `network` field, bundled-network selection, or remote lookup. The caller must supply the transaction-relevant parameters for its intended chain and rules:

| Field | Meaning |
| --- | --- |
| `tx_version` | Required transaction version, RPC uint32 |
| `max_block_bytes` | Upstream transaction size-check limit |
| `max_block_cycles` | Ceiling for the request's `max_cycles` |
| `cellbase_maturity` | Packed CKB epoch-with-fraction duration |
| `median_time_block_count` | Positive median-time window length |
| `tx_proposal_window` | `closest` and `farthest` block distances |
| `dao_type_hash` | 32-byte DAO type-script code hash |
| `hardforks.rfc0028_epoch` | Relative timestamp-since start rule activation |
| `hardforks.rfc0032_epoch` | VM version 1 / syscall-version activation |
| `hardforks.rfc0049_epoch` | VM version 2 activation |
| `hardforks.rfc0044_epoch` | Committed-block DAO lock-size rule activation |
| `starting_block_limiting_dao_withdrawing_lock` | Creation-block threshold used by the DAO lock-size verifier |

Except `tx_version` and the hash, these are RPC uint64 hex strings; epoch activation fields are epoch **numbers**, not packed fractions. Byte/cycle limits must be positive; the median count is in `1..=u32::MAX`, maturity must be a well-formed epoch fraction, and `closest <= farthest`. The parameter set covers the audited transaction paths in the pinned upstream, not every full-node consensus setting. TYPE_ID is upstream's protocol constant. PoW, rewards and genesis configuration are not transaction-verifier inputs here. Several historical rules are unconditional in this upstream revision: configurable activation epochs are **not** a promise of arbitrary historical consensus replay.

## Verification environment

`tip_header` always means the caller's **current existing tip**.

- **Submitted (default):** `verification: { phase: 'submitted' }` uses `TxVerifyEnv::new_submit(tip_header)`. Block-number `since` uses the earliest commitment height `tip.number + 1 + closest`. Timestamp median ancestry starts at the tip itself. Maturity and epoch-fraction comparisons use the tip epoch as upstream does; hardfork projections follow upstream's separate rules. This is not equivalent to fabricating a candidate header or promising pool acceptance.
- **Committed:** `verification: { phase: 'committed', candidate_header: { /* RPC Header */ }, transaction_index: '0x1' }` uses `TxVerifyEnv::new_commit(candidate_header)`. The candidate's parent hash must equal the supplied tip hash and its number must be tip number plus one. The target transaction index is in `1..=u32::MAX` because index zero is cellbase. This mode checks exact proposed placement, not proof the candidate has been mined or accepted. Timestamp median ancestry starts at the candidate parent, i.e. the supplied tip.

The upstream pool applies the DAO script-size check unconditionally in submitted mode. Committed mode applies it when the **parent's epoch number** reaches `rfc0044_epoch`; it does not use the candidate's projected activation epoch for this gate.

Standalone cellbase transactions are rejected because reward and block-level structure verification is outside this API. The separate upstream already-proposed pool phase is not exposed.

## Cells, headers and extensions

Include every input, code dependency, dep-group cell and expanded dep-group member. Duplicate cells, headers and extension entries are rejected. Do not repeat `tip_header` or an explicit candidate header in `headers`.

`transaction_info` is required but nullable:

- An object asserts a known creation block. The block number and packed epoch must agree with its supplied creation header. `index` is the creating transaction's index within that block, **not** the output index; zero means cellbase, and the index must fit uint32. A known creation block cannot be beyond the supplied verification environment. At its latest height, its hash must match the supplied tip or candidate, respectively. In committed mode, a same-block ancestor is allowed when its creation hash is the candidate hash and its transaction index is less than the target `transaction_index`.
- `null` explicitly asserts an **unconfirmed, non-cellbase** origin. It is not an abbreviation for forgotten creation metadata. Upstream skips cellbase-maturity classification for such origins; supplying null for an actually confirmed/cellbase cell can therefore misrepresent the context. Relative `since` cannot mature without creation metadata, and header/extension syscalls cannot obtain a creation block for it. Final DAO withdrawal also requires the appropriate known origin. Ordinary zero-since spending can be checked against this asserted unconfirmed cell.

Include declared header deps, known cell creation headers and sufficient linked ancestors for timestamp-based `since`. Pre-RFC0028 relative timestamp checks can additionally require ancestors starting at the creation header's parent. The configured median window ends early at genesis. Missing required context is an error, not a successful check.

Include an explicit extension entry for every declared header dep and each known creation block of resolved inputs/expanded dependencies. `data: null` asserts that no extension exists; omitting `data` or a required entry does not imply absence. A dep-group container needs its cell bytes and known creation metadata, but is not itself an executable expanded dependency unless separately referenced as one.

## Results and selected groups

Optional top-level `script_group: { group_type: 'lock' | 'type', script_hash: '0x...32 bytes' }` selects only one group. Successful group verification does **not** establish capacity, maturity, since, DAO rules or correctness of other groups. The complete snapshot is still parsed/resolved and noncontextual checks still run.

Success:

```json
{"ok":true,"scope":"transaction","cycles":"0x...","fee":"0x...","groups":[{"group_type":"lock","script_hash":"0x...","input_indices":[0],"output_indices":[]}],"chain_state_verified":false}
```

Failure:

```json
{"ok":false,"error":{"code":"MissingContext","message":"..."}}
```

Script-group success uses `scope: "script_group"` and omits `fee`. Group order is not contractual. Error messages are diagnostic and may change with upstream releases.

## Scope and trust

Full mode runs upstream resolution, noncontextual verification, contextual maturity/since/capacity/scripts/DAO fee validation, and the supplemental DAO script-size rule. Max cycles cannot exceed the supplied consensus ceiling. Scripts use upstream CKB-VM, TYPE_ID and CKB syscalls.

Success is conditional on caller-supplied facts **and parameters**. It does not authenticate cell contents against outpoint transaction hashes, prove transaction inclusion, verify PoW, authenticate extensions against commitments, establish canonical ancestry/fork choice, check liveness or double spends elsewhere, prove proposal inclusion, or verify block aggregate limits/rewards. Known same-block index checks do not validate the rest of the candidate block. The caller remains responsible for truth, completeness and consistency of external state beyond the local checks.

Use a Web Worker to avoid blocking the browser UI. Enforce application-level JSON/snapshot-size limits; VM cycle limits do not bound parsing or snapshot memory.

## Migrating from v0.1

Remove `context.network` and supply explicit consensus parameters. The old `tip_header` meant a candidate block: move it to `verification.candidate_header`, set `phase: 'committed'`, add the target `transaction_index`, and put its actual parent into the new `tip_header`. Remove that parent from the separate headers array to avoid duplication. Omitting `verification` now means submitted mode, intentionally not an automatic compatibility alias. JS methods and result shapes remain unchanged.
