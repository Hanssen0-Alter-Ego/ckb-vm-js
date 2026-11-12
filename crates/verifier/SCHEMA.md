# Offline verifier request (v0.1)

`verify_json(json: &str) -> String` is the native API. WASM exports `verify(json: string): string`. Both return JSON, including on ordinary input/verification errors. No networking is performed.

```json
{
  "transaction": { "version":"0x0", "cell_deps":[], "header_deps":[], "inputs":[], "outputs":[], "outputs_data":[], "witnesses":[] },
  "context": {
    "network":"mainnet",
    "tip_header": "CKB RPC Header object for the candidate block",
    "headers": ["CKB RPC Header objects, without hash field"],
    "cells": [{
      "out_point": {"tx_hash":"0x...32 bytes", "index":"0x0"},
      "output": {"capacity":"0x...", "lock":"CKB RPC Script object", "type":null},
      "data":"0x...",
      "transaction_info": {"block_hash":"0x...32 bytes", "block_number":"0x...", "block_epoch":"0x...", "index":"0x1"}
    }],
    "extensions": [{"block_hash":"0x...32 bytes", "data":null}]
  },
  "max_cycles":"0x989680"
}
```

The snippets describing RPC objects above are placeholders, not runnable fixtures. Use `ckb-jsonrpc-types` Transaction, Header, OutPoint, CellOutput, and Script shapes. All integer quantities use canonical RPC `0x` strings; byte fields use even-length `0x` strings. `network` is exactly `mainnet` or `testnet` and uses the pinned upstream bundled consensus. The wrapper rejects unknown fields on its own request/context/cell/selector objects. Upstream RPC objects follow upstream serde parsing.

Optional `script_group: {"group_type":"lock"|"type", "script_hash":"0x...32 bytes"}` selects only that group. Its successful result has `scope: "script_group"`, never `transaction`. This mode still parses/resolves the complete snapshot and runs noncontextual checks but does not prove capacity, maturity, since, DAO rules, or other groups.

`tip_header` is a **candidate committed block header**, not the latest existing chain tip. Its parent must be present, with a matching block number. Genesis candidates and standalone cellbase transactions are rejected. All cells must originate strictly before the candidate block; same-block ancestors and uncommitted cells are currently unsupported.

Include every input, code dependency, dep-group cell and expanded member. Creation metadata is required, including transaction index (0 means cellbase), and must agree with a supplied creation header. Headers are keyed by their recomputed hashes. Duplicate cells, headers or extension entries are rejected. Do not repeat the candidate header in `headers`.

Include declared header deps, all cell creation headers, the candidate parent, and sufficient ancestor chains for timestamp-based since median time. Include explicit extension entries for declared header deps and each resolved input/dependency creation block; null means the developer asserts that no extension exists. Missing extension entries are errors, not implicit absence.

The result is either:

```json
{"ok":true,"scope":"transaction","cycles":"0x...","fee":"0x...","groups":[{"group_type":"lock","script_hash":"0x...","input_indices":[0],"output_indices":[]}],"chain_state_verified":false}
```

or:

```json
{"ok":false,"error":{"code":"MissingContext","message":"..."}}
```

Script-group success omits `fee`. Error codes include InvalidRequest, UnsupportedNetwork, UnsupportedCellbase, UnsupportedContext, InvalidContext, MissingContext, Resolution, InvalidTransaction, Script and Consensus. Messages are diagnostic and may change with upstream releases.

## Scope and trust

Full mode runs upstream resolution, noncontextual verification, contextual maturity/since/capacity/scripts/DAO fee validation, and the separately activated DAO script-size rule. Max cycles cannot exceed the network block limit. Scripts execute on the upstream CKB-VM interpreter, including TYPE_ID and native CKB syscalls supplied by ckb-script.

Success is relative to caller-supplied facts. It does not authenticate cell contents against transaction hashes, prove transaction inclusion, validate proof-of-work, authenticate extensions against block commitments, establish header ancestry/fork choice beyond local consistency checks, check cell liveness/double spends elsewhere, prove proposal-window inclusion, or verify block aggregate limits and rewards. The caller is responsible for the truth and completeness of that external state. Some chain consistency checks are intentionally outside a transaction verifier.

Run synchronous WASM verification in a Web Worker to avoid blocking the browser UI. Set an appropriate cycle limit and enforce application-level limits on JSON/snapshot sizes; cycle limits do not bound JSON parsing or snapshot memory.
