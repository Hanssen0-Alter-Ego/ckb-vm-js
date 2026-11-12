//! Offline, snapshot-relative CKB verification. No chain authenticity or liveness claims.
use ckb_chain_spec::{ChainSpec, consensus::Consensus};
use ckb_jsonrpc_types as rpc;
use ckb_resource::Resource;
use ckb_script::{ScriptGroupType, TransactionScriptsVerifier, TxVerifyEnv};
use ckb_traits::{
    CellDataProvider, EpochProvider, ExtensionProvider, HeaderFields, HeaderFieldsProvider,
    HeaderProvider,
};
use ckb_types::{
    bytes::Bytes,
    core::{
        self, EpochNumberWithFraction, HeaderView, TransactionInfo,
        cell::{
            CellMeta, CellMetaBuilder, CellProvider, CellStatus, HeaderChecker, resolve_transaction,
        },
        error::OutPointError,
    },
    packed,
    prelude::*,
};
use ckb_verification::{
    ContextualTransactionVerifier, DaoScriptSizeVerifier, NonContextualTransactionVerifier, Since,
    SinceMetric,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, OnceLock},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyRequest {
    pub transaction: rpc::Transaction,
    pub context: Context,
    pub max_cycles: rpc::Uint64,
    pub script_group: Option<GroupSelector>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub network: String,
    /// Header of the candidate block in which the transaction is being checked.
    pub tip_header: rpc::Header,
    pub cells: Vec<Cell>,
    pub headers: Vec<rpc::Header>,
    pub extensions: Vec<Extension>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub out_point: rpc::OutPoint,
    pub output: rpc::CellOutput,
    pub data: rpc::JsonBytes,
    pub transaction_info: CellOrigin,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellOrigin {
    pub block_hash: ckb_types::H256,
    pub block_number: rpc::Uint64,
    pub block_epoch: rpc::Uint64,
    pub index: rpc::Uint64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Extension {
    pub block_hash: ckb_types::H256,
    #[serde(deserialize_with = "deserialize_nullable_extension")]
    pub data: Option<rpc::JsonBytes>,
}
fn deserialize_nullable_extension<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<rpc::JsonBytes>, D::Error> {
    Option::<rpc::JsonBytes>::deserialize(deserializer)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupSelector {
    pub group_type: String,
    pub script_hash: ckb_types::H256,
}

#[derive(Debug, Serialize)]
pub struct VerifyError {
    pub code: &'static str,
    pub message: String,
}
type Result<T> = std::result::Result<T, VerifyError>;
fn err(code: &'static str, message: impl ToString) -> VerifyError {
    VerifyError {
        code,
        message: message.to_string(),
    }
}
fn hash_hex(hash: &packed::Byte32) -> String {
    format!("0x{}", hex::encode(hash.as_slice()))
}

#[derive(Clone, Default)]
struct Snapshot {
    cells: HashMap<packed::OutPoint, CellMeta>,
    headers: HashMap<packed::Byte32, HeaderView>,
    extensions: HashMap<packed::Byte32, Option<packed::Bytes>>,
}
impl CellProvider for Snapshot {
    fn cell(&self, point: &packed::OutPoint, _: bool) -> CellStatus {
        self.cells
            .get(point)
            .cloned()
            .map(CellStatus::Live)
            .unwrap_or(CellStatus::Unknown)
    }
}
impl HeaderChecker for Snapshot {
    // This checks snapshot presence ONLY, not canonical-chain membership.
    fn check_valid(&self, hash: &packed::Byte32) -> std::result::Result<(), OutPointError> {
        if self.headers.contains_key(hash) {
            Ok(())
        } else {
            Err(OutPointError::InvalidHeader(hash.clone()))
        }
    }
}
impl CellDataProvider for Snapshot {
    fn get_cell_data(&self, point: &packed::OutPoint) -> Option<Bytes> {
        self.cells.get(point)?.mem_cell_data.clone()
    }
    fn get_cell_data_hash(&self, point: &packed::OutPoint) -> Option<packed::Byte32> {
        self.cells.get(point)?.mem_cell_data_hash.clone()
    }
}
impl HeaderProvider for Snapshot {
    fn get_header(&self, hash: &packed::Byte32) -> Option<HeaderView> {
        self.headers.get(hash).cloned()
    }
}
impl HeaderFieldsProvider for Snapshot {
    fn get_header_fields(&self, hash: &packed::Byte32) -> Option<HeaderFields> {
        self.headers.get(hash).map(|h| HeaderFields {
            hash: h.hash(),
            number: h.number(),
            epoch: h.epoch(),
            timestamp: h.timestamp(),
            parent_hash: h.parent_hash(),
        })
    }
}
impl ExtensionProvider for Snapshot {
    fn get_block_extension(&self, hash: &packed::Byte32) -> Option<packed::Bytes> {
        self.extensions.get(hash).cloned().flatten()
    }
}
impl EpochProvider for Snapshot {
    // Transaction fee verification does not call these block-reward APIs.
    fn get_epoch_ext(&self, _: &HeaderView) -> Option<core::EpochExt> {
        None
    }
    fn get_block_hash(&self, _: u64) -> Option<packed::Byte32> {
        None
    }
    fn get_block_ext(&self, _: &packed::Byte32) -> Option<core::BlockExt> {
        None
    }
    fn get_block_header(&self, hash: &packed::Byte32) -> Option<HeaderView> {
        self.get_header(hash)
    }
}
fn consensus(network: &str) -> Result<Arc<Consensus>> {
    if !matches!(network, "mainnet" | "testnet") {
        return Err(err(
            "UnsupportedNetwork",
            "network must be mainnet or testnet",
        ));
    }
    static MAINNET: OnceLock<std::result::Result<Arc<Consensus>, String>> = OnceLock::new();
    static TESTNET: OnceLock<std::result::Result<Arc<Consensus>, String>> = OnceLock::new();
    let slot = if network == "mainnet" {
        &MAINNET
    } else {
        &TESTNET
    };
    slot.get_or_init(|| {
        let spec = ChainSpec::load_from(&Resource::bundled(format!("specs/{network}.toml")))
            .map_err(|e| e.to_string())?;
        spec.build_consensus()
            .map(Arc::new)
            .map_err(|e| e.to_string())
    })
    .clone()
    .map_err(|e| err("Consensus", e))
}
fn checked_header(header: rpc::Header) -> Result<HeaderView> {
    let raw_epoch = EpochNumberWithFraction::from_full_value_unchecked(header.epoch.value());
    let h = packed::Header::from(header).into_view();
    if !(raw_epoch.is_well_formed() || (h.number() == 0 && raw_epoch.is_genesis())) {
        return Err(err(
            "InvalidContext",
            "header epoch must have nonzero length and index below length",
        ));
    }
    Ok(h)
}
impl Snapshot {
    fn header(&self, hash: &packed::Byte32) -> Result<&HeaderView> {
        self.headers.get(hash).ok_or_else(|| {
            err(
                "MissingContext",
                format!("missing header {}", hash_hex(hash)),
            )
        })
    }
    fn preflight_median(&self, start: packed::Byte32, count: usize) -> Result<()> {
        let mut hash = start;
        for index in 0..count {
            let h = self.header(&hash)?;
            if h.number() == 0 || index + 1 == count {
                break;
            }
            let parent = self.header(&h.parent_hash())?;
            if parent.number().checked_add(1) != Some(h.number()) {
                return Err(err(
                    "InvalidContext",
                    "discontinuous median-time header chain",
                ));
            }
            hash = parent.hash();
        }
        Ok(())
    }
}

/// Returns structured JSON on both success and failure. Numbers are lossless hex strings.
/// `scope=transaction` means validity relative to supplied context, not network acceptance.
#[cfg_attr(target_family = "wasm", wasm_bindgen::prelude::wasm_bindgen(js_name = verify))]
pub fn verify_json(request_json: &str) -> String {
    let result = serde_json::from_str::<VerifyRequest>(request_json)
        .map_err(|e| err("InvalidRequest", e))
        .and_then(verify_request);
    match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"ok":false,"error":error}).to_string(),
    }
}

pub fn verify_request(req: VerifyRequest) -> Result<Value> {
    let consensus = consensus(&req.context.network)?;
    let max_cycles = req.max_cycles.value();
    if max_cycles > consensus.max_block_cycles() {
        return Err(err(
            "InvalidRequest",
            "max_cycles exceeds network block cycle limit",
        ));
    }
    let tx = packed::Transaction::from(req.transaction).into_view();
    if tx.is_cellbase() {
        return Err(err(
            "UnsupportedCellbase",
            "cellbase requires block-level reward and structural verification",
        ));
    }
    NonContextualTransactionVerifier::new(&tx, &consensus)
        .verify()
        .map_err(|e| err("InvalidTransaction", e))?;
    let tip = checked_header(req.context.tip_header)?;
    if tip.number() == 0 {
        return Err(err(
            "UnsupportedContext",
            "candidate block must be after genesis",
        ));
    }
    let mut snapshot = Snapshot::default();
    snapshot.headers.insert(tip.hash(), tip.clone());
    for header in req.context.headers {
        let h = checked_header(header)?;
        if snapshot.headers.insert(h.hash(), h).is_some() {
            return Err(err("InvalidContext", "duplicate header"));
        }
    }
    let parent = snapshot.header(&tip.parent_hash())?;
    if parent.number().checked_add(1) != Some(tip.number()) {
        return Err(err("InvalidContext", "candidate parent number mismatch"));
    }
    let dao_rules_active = consensus.rfc0044_active(parent.epoch().number());
    for ext in req.context.extensions {
        let hash: packed::Byte32 = ext.block_hash.into();
        snapshot.header(&hash)?;
        if snapshot
            .extensions
            .insert(hash, ext.data.map(|d| d.into_bytes().pack()))
            .is_some()
        {
            return Err(err("InvalidContext", "duplicate block extension entry"));
        }
    }
    for cell in req.context.cells {
        let point: packed::OutPoint = cell.out_point.into();
        let origin = cell.transaction_info;
        let block_hash: packed::Byte32 = origin.block_hash.into();
        let h = snapshot.header(&block_hash)?;
        let epoch = EpochNumberWithFraction::from_full_value_unchecked(origin.block_epoch.value());
        if !(epoch.is_well_formed() || (h.number() == 0 && epoch.is_genesis()))
            || h.epoch().full_value() != epoch.normalize().full_value()
            || h.number() != origin.block_number.value()
            || h.number() >= tip.number()
        {
            return Err(err(
                "InvalidContext",
                "cell origin differs from supplied creation header, or is not before candidate block",
            ));
        }
        let index = usize::try_from(origin.index.value())
            .map_err(|_| err("InvalidContext", "transaction index overflow"))?;
        let meta = CellMetaBuilder::from_cell_output(cell.output.into(), cell.data.into_bytes())
            .out_point(point.clone())
            .transaction_info(TransactionInfo::new(h.number(), epoch, block_hash, index))
            .build();
        if snapshot.cells.insert(point, meta).is_some() {
            return Err(err("InvalidContext", "duplicate cell outpoint"));
        }
    }
    let resolved = Arc::new(
        resolve_transaction(tx.clone(), &mut HashSet::new(), &snapshot, &snapshot)
            .map_err(|e| err("Resolution", e))?,
    );
    // An omitted extension cannot silently mean an absent extension to a script.
    let mut required_extensions: HashSet<packed::Byte32> = tx.header_deps_iter().collect();
    for c in resolved
        .resolved_inputs
        .iter()
        .chain(&resolved.resolved_cell_deps)
    {
        if let Some(info) = &c.transaction_info {
            required_extensions.insert(info.block_hash.clone());
        }
    }
    for hash in required_extensions {
        if !snapshot.extensions.contains_key(&hash) {
            return Err(err(
                "MissingContext",
                format!(
                    "explicit extension data or null required for {}",
                    hash_hex(&hash)
                ),
            ));
        }
    }
    for (input, cell) in tx.inputs().into_iter().zip(&resolved.resolved_inputs) {
        let since = Since(input.since().into());
        if let Some(SinceMetric::Timestamp(_)) = since.extract_metric() {
            snapshot.preflight_median(tip.parent_hash(), consensus.median_time_block_count())?;
            if since.is_relative() {
                let origin = cell
                    .transaction_info
                    .as_ref()
                    .ok_or_else(|| err("MissingContext", "missing origin"))?;
                let origin_header = snapshot.header(&origin.block_hash)?;
                if !consensus
                    .hardfork_switch()
                    .ckb2021
                    .is_block_ts_as_relative_since_start_enabled(tip.epoch().number())
                {
                    snapshot.preflight_median(
                        origin_header.parent_hash(),
                        consensus.median_time_block_count(),
                    )?;
                }
            }
        }
    }
    // DAO withdrawal arithmetic assumes genuine headers. Guard untrusted snapshot AR.
    let dao_withdrawal = resolved.resolved_inputs.iter().any(|cell| {
        let is_dao = cell
            .cell_output
            .type_()
            .to_opt()
            .map(|s| {
                s.code_hash() == consensus.dao_type_hash() && Into::<u8>::into(s.hash_type()) == 1
            })
            .unwrap_or(false);
        is_dao
            && cell
                .mem_cell_data
                .as_ref()
                .map(|data| data.len() == 8 && data.iter().any(|b| *b != 0))
                .unwrap_or(false)
    });
    if dao_withdrawal {
        for hash in tx.header_deps_iter() {
            if ckb_dao_utils::extract_dao_data(snapshot.header(&hash)?.dao()).0 == 0 {
                return Err(err(
                    "InvalidContext",
                    "DAO withdrawal header has zero accumulated rate",
                ));
            }
        }
    }
    let env = Arc::new(TxVerifyEnv::new_commit(&tip));
    let script_verifier = TransactionScriptsVerifier::new(
        resolved.clone(),
        snapshot.clone(),
        consensus.clone(),
        env.clone(),
    );
    let groups: Vec<Value> = script_verifier.groups_with_type().map(|(kind,hash,group)| json!({"group_type":match kind { ScriptGroupType::Lock => "lock", ScriptGroupType::Type => "type" },"script_hash":hash_hex(hash),"input_indices":group.input_indices,"output_indices":group.output_indices})).collect();
    if let Some(selected) = req.script_group {
        let kind = match selected.group_type.as_str() {
            "lock" => ScriptGroupType::Lock,
            "type" => ScriptGroupType::Type,
            _ => return Err(err("InvalidRequest", "group_type must be lock or type")),
        };
        let hash = selected.script_hash.into();
        let cycles = script_verifier
            .verify_single(kind, &hash, max_cycles)
            .map_err(|e| err("Script", e))?;
        return Ok(
            json!({"ok":true,"scope":"script_group","cycles":format!("0x{cycles:x}"),"groups":groups,"chain_state_verified":false}),
        );
    }
    if dao_rules_active {
        DaoScriptSizeVerifier::new(resolved.clone(), consensus.clone(), snapshot.clone())
            .verify()
            .map_err(|e| err("InvalidTransaction", e))?;
    }
    let completed = ContextualTransactionVerifier::new(resolved, consensus, snapshot, env)
        .verify(max_cycles, false)
        .map_err(|e| err("InvalidTransaction", e))?;
    Ok(
        json!({"ok":true,"scope":"transaction","cycles":format!("0x{:x}",completed.cycles),"fee":format!("0x{:x}",completed.fee.as_u64()),"groups":groups,"chain_state_verified":false}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_json_returns_error() {
        let v: Value = serde_json::from_str(&verify_json("{")).unwrap();
        assert_eq!(v["ok"], false);
        assert_eq!(v["error"]["code"], "InvalidRequest");
    }
    #[test]
    fn missing_request_fields_fail_closed() {
        assert!(verify_json("{}").contains("InvalidRequest"));
    }
    #[test]
    fn missing_median_header_is_error_not_panic() {
        let s = Snapshot::default();
        assert_eq!(
            s.preflight_median(packed::Byte32::default(), 37)
                .unwrap_err()
                .code,
            "MissingContext"
        );
    }
    #[test]
    fn unknown_network_rejected() {
        assert_eq!(consensus("custom").unwrap_err().code, "UnsupportedNetwork");
    }
}

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod execution_tests {
    use super::*;
    #[test]
    fn executes_real_scripts_and_rejects_invalid_transactions() {
        for (name, request, expected) in test_support::cases() {
            let response: Value = serde_json::from_str(&verify_json(&request.to_string())).unwrap();
            assert_eq!(response["ok"], expected, "case {name}: {response}");
            if expected {
                assert_ne!(response["cycles"], "0x0");
            }
        }
    }
}
