//! Offline, snapshot-relative CKB verification. No chain authenticity or liveness claims.
use ckb_chain_spec::consensus::{Consensus, ProposalWindow};
use ckb_jsonrpc_types as rpc;
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
        hardfork::{CKB2021, CKB2023, HardForks},
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
    sync::Arc,
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
    pub consensus: ConsensusParameters,
    /// Actual current chain tip. Never an implicitly named candidate.
    pub tip_header: rpc::Header,
    #[serde(default)]
    pub verification: Verification,
    pub cells: Vec<Cell>,
    pub headers: Vec<rpc::Header>,
    pub extensions: Vec<Extension>,
}
/// Parameters consumed by the pinned upstream transaction paths. No network lookup.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsensusParameters {
    pub tx_version: rpc::Uint32,
    pub max_block_bytes: rpc::Uint64,
    pub max_block_cycles: rpc::Uint64,
    pub cellbase_maturity: rpc::Uint64,
    pub median_time_block_count: rpc::Uint64,
    pub tx_proposal_window: ProposalParameters,
    pub dao_type_hash: ckb_types::H256,
    pub hardforks: HardforkParameters,
    pub starting_block_limiting_dao_withdrawing_lock: rpc::Uint64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalParameters {
    pub closest: rpc::Uint64,
    pub farthest: rpc::Uint64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HardforkParameters {
    pub rfc0028_epoch: rpc::Uint64,
    pub rfc0032_epoch: rpc::Uint64,
    pub rfc0049_epoch: rpc::Uint64,
    pub rfc0044_epoch: rpc::Uint64,
}
#[derive(Default, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case", deny_unknown_fields)]
pub enum Verification {
    #[default]
    Submitted,
    Committed {
        candidate_header: Box<rpc::Header>,
        transaction_index: rpc::Uint64,
    },
}
fn deserialize_nullable_origin<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<CellOrigin>, D::Error> {
    Option::<CellOrigin>::deserialize(deserializer)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub out_point: rpc::OutPoint,
    pub output: rpc::CellOutput,
    pub data: rpc::JsonBytes,
    #[serde(deserialize_with = "deserialize_nullable_origin")]
    pub transaction_info: Option<CellOrigin>,
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
    fn block_median_time(&self, start: &packed::Byte32, count: usize) -> u64 {
        // Upstream eagerly allocates count entries. A caller-supplied count may
        // be huge even when ancestry reaches genesis immediately. Allocate only
        // for the actual preflighted ancestry; preserve upstream median semantics.
        let mut timestamps = Vec::new();
        let mut hash = start.clone();
        for _ in 0..count {
            let header = self
                .headers
                .get(&hash)
                .expect("median ancestry preflighted");
            timestamps.push(header.timestamp());
            if header.number() == 0 {
                break;
            }
            hash = header.parent_hash();
        }
        timestamps.sort_unstable();
        timestamps[timestamps.len() / 2]
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
fn consensus(parameters: &ConsensusParameters) -> Result<Arc<Consensus>> {
    let p = parameters;
    let maturity = EpochNumberWithFraction::from_full_value_unchecked(p.cellbase_maturity.value());
    let count = p.median_time_block_count.value();
    if !maturity.is_well_formed()
        || count == 0
        || count > u32::MAX as u64
        || p.max_block_bytes.value() == 0
        || p.max_block_cycles.value() == 0
        || p.tx_proposal_window.closest.value() > p.tx_proposal_window.farthest.value()
    {
        return Err(err(
            "InvalidContext",
            "invalid consensus maturity, median count, limits or proposal window",
        ));
    }
    // Unused historic switches are explicit zero, not hidden mainnet defaults.
    // The pinned upstream has made several older rules unconditional.
    let ckb2021 = CKB2021::new_dev_default()
        .as_builder()
        .rfc_0028(p.hardforks.rfc0028_epoch.value())
        .rfc_0032(p.hardforks.rfc0032_epoch.value())
        .build()
        .map_err(|e| err("InvalidContext", e))?;
    let ckb2023 = CKB2023::new_dev_default()
        .as_builder()
        .rfc_0049(p.hardforks.rfc0049_epoch.value())
        .build()
        .map_err(|e| err("InvalidContext", e))?;
    // Defaults supply only block/reward fields unused by these transaction paths.
    // Do not call build() afterwards: it replaces dao_type_hash from genesis.
    let c = Consensus {
        id: "caller-supplied".into(),
        tx_version: p.tx_version.value(),
        max_block_bytes: p.max_block_bytes.value(),
        max_block_cycles: p.max_block_cycles.value(),
        cellbase_maturity: maturity,
        median_time_block_count: count as usize,
        tx_proposal_window: ProposalWindow(
            p.tx_proposal_window.closest.value(),
            p.tx_proposal_window.farthest.value(),
        ),
        dao_type_hash: p.dao_type_hash.clone().into(),
        hardfork_switch: HardForks { ckb2021, ckb2023 },
        starting_block_limiting_dao_withdrawing_lock: p
            .starting_block_limiting_dao_withdrawing_lock
            .value(),
        ..Consensus::default()
    };
    Ok(Arc::new(c))
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
    let consensus = consensus(&req.context.consensus)?;
    let max_cycles = req.max_cycles.value();
    if max_cycles > consensus.max_block_cycles() {
        return Err(err(
            "InvalidRequest",
            "max_cycles exceeds supplied block cycle limit",
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
    let mut snapshot = Snapshot::default();
    snapshot.headers.insert(tip.hash(), tip.clone());
    let (env, candidate, target_index, dao_rules_active) = match req.context.verification {
        Verification::Submitted => {
            tip.number()
                .checked_add(1)
                .and_then(|n| n.checked_add(consensus.tx_proposal_window().closest()))
                .ok_or_else(|| err("InvalidContext", "submitted height overflows u64"))?;
            (TxVerifyEnv::new_submit(&tip), None, None, true)
        }
        Verification::Committed {
            candidate_header,
            transaction_index,
        } => {
            let candidate = checked_header(*candidate_header)?;
            if candidate.parent_hash() != tip.hash()
                || tip.number().checked_add(1) != Some(candidate.number())
            {
                return Err(err(
                    "InvalidContext",
                    "candidate must be the direct child of tip_header",
                ));
            }
            let index = transaction_index.value();
            if index == 0 || index > u32::MAX as u64 {
                return Err(err(
                    "InvalidContext",
                    "committed non-cellbase transaction index must be 1..=u32::MAX",
                ));
            }
            snapshot.headers.insert(candidate.hash(), candidate.clone());
            let active =
                tip.epoch().number() >= req.context.consensus.hardforks.rfc0044_epoch.value();
            (
                TxVerifyEnv::new_commit(&candidate),
                Some(candidate),
                Some(index),
                active,
            )
        }
    };
    let env = Arc::new(env);
    for header in req.context.headers {
        let h = checked_header(header)?;
        if snapshot.headers.insert(h.hash(), h).is_some() {
            return Err(err("InvalidContext", "duplicate header"));
        }
    }
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
        let mut builder =
            CellMetaBuilder::from_cell_output(cell.output.into(), cell.data.into_bytes())
                .out_point(point.clone());
        if let Some(origin) = cell.transaction_info {
            let block_hash: packed::Byte32 = origin.block_hash.into();
            let h = snapshot.header(&block_hash)?;
            let epoch =
                EpochNumberWithFraction::from_full_value_unchecked(origin.block_epoch.value());
            if !(epoch.is_well_formed() || (h.number() == 0 && epoch.is_genesis()))
                || h.epoch().normalize().full_value() != epoch.normalize().full_value()
                || h.number() != origin.block_number.value()
            {
                return Err(err(
                    "InvalidContext",
                    "cell origin differs from supplied creation header",
                ));
            }
            let index = origin.index.value();
            if index > u32::MAX as u64 {
                return Err(err("InvalidContext", "transaction index exceeds u32"));
            }
            let latest = candidate.as_ref().unwrap_or(&tip);
            if h.number() > latest.number()
                || (h.number() == latest.number() && h.hash() != latest.hash())
            {
                return Err(err(
                    "InvalidContext",
                    "cell origin is beyond the supplied verification environment",
                ));
            }
            if candidate.as_ref().is_some_and(|c| c.hash() == h.hash())
                && index >= target_index.unwrap_or(0)
            {
                return Err(err(
                    "InvalidContext",
                    "same-block cell must precede the verified transaction",
                ));
            }
            builder = builder.transaction_info(TransactionInfo::new(
                h.number(),
                epoch,
                block_hash,
                index as usize,
            ));
        }
        let meta = builder.build();
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
            // A relative since on an explicitly unconfirmed input is Immature
            // upstream, before any timestamp/header access.
            if since.is_relative() && cell.transaction_info.is_none() {
                continue;
            }
            snapshot.preflight_median(env.parent_hash(), consensus.median_time_block_count())?;
            if since.is_relative() {
                let origin = cell
                    .transaction_info
                    .as_ref()
                    .ok_or_else(|| err("MissingContext", "missing origin"))?;
                let origin_header = snapshot.header(&origin.block_hash)?;
                if !consensus
                    .hardfork_switch()
                    .ckb2021
                    .is_block_ts_as_relative_since_start_enabled(
                        env.epoch_number(consensus.tx_proposal_window()),
                    )
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
