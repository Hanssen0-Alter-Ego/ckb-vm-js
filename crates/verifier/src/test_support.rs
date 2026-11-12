use ckb_jsonrpc_types as rpc;
use ckb_types::{
    bytes::Bytes,
    core::{EpochNumberWithFraction, HeaderBuilder},
    packed,
    prelude::*,
};
use serde_json::{Value, json};

pub fn fixture(program: &[u8]) -> Value {
    let epoch = EpochNumberWithFraction::new(20_000, 0, 1000);
    let origin = HeaderBuilder::default().number(100u64).epoch(epoch).build();
    let tip = HeaderBuilder::default()
        .number(101u64)
        .epoch(EpochNumberWithFraction::new(20_000, 1, 1000))
        .parent_hash(origin.hash())
        .build();
    let program_hash = packed::CellOutput::calc_data_hash(&Bytes::copy_from_slice(program));
    let hash_hex = |hash: packed::Byte32| format!("0x{}", hex::encode(hash.as_slice()));
    let lock = json!({"code_hash":hash_hex(program_hash),"hash_type":"data2","args":"0x"});
    let cell_output = json!({"capacity":"0x174876e800","lock":lock,"type":null});
    let input_point = json!({"tx_hash":format!("0x{}","11".repeat(32)),"index":"0x0"});
    let dep_point = json!({"tx_hash":format!("0x{}","22".repeat(32)),"index":"0x0"});
    let origin_info = json!({"block_hash":hash_hex(origin.hash()),"block_number":"0x64","block_epoch":format!("0x{:x}",epoch.full_value()),"index":"0x1"});
    let origin_rpc = rpc::Header::from(origin.data());
    let tip_rpc = rpc::Header::from(tip.data());
    json!({
        "transaction":{"version":"0x0","cell_deps":[{"out_point":dep_point,"dep_type":"code"}],"header_deps":[],"inputs":[{"since":"0x0","previous_output":input_point}],"outputs":[cell_output],"outputs_data":["0x"],"witnesses":[]},
        "context":{"network":"mainnet","tip_header":tip_rpc,"headers":[origin_rpc],"cells":[
            {"out_point":input_point,"output":cell_output,"data":"0x","transaction_info":origin_info},
            {"out_point":dep_point,"output":cell_output,"data":format!("0x{}",hex::encode(program)),"transaction_info":origin_info}
        ],"extensions":[{"block_hash":hash_hex(origin.hash()),"data":null}]},
        "max_cycles":"0x989680"
    })
}

// Tiny RV64I programs for cross-host integer-width conformance tests.
// No cross compiler is required: ELF64 header plus one RX PT_LOAD segment.
fn syscall_program(syscall: u32, large_index: bool, large_offset: bool) -> Vec<u8> {
    let addi =
        |rd: u32, rs: u32, imm: i32| ((imm as u32 & 0xfff) << 20) | (rs << 15) | (rd << 7) | 0x13;
    let slli32 = |rd: u32| (32 << 20) | (rd << 15) | (1 << 12) | (rd << 7) | 0x13;
    let mut words = vec![
        addi(2, 2, -16),              // reserve stack bytes
        (2 << 15) | (3 << 12) | 0x23, // sd zero, 0(sp): zero copy length
        addi(10, 0, 0),
        addi(11, 2, 0), // a0 = null buffer, a1 = length address
        addi(12, 0, i32::from(large_offset)),
    ];
    if large_offset {
        words.push(slli32(12));
    }
    words.push(addi(13, 0, i32::from(large_index)));
    if large_index {
        words.push(slli32(13));
    }
    words.extend([
        addi(14, 0, 1),
        (1 << 12) | (17 << 7) | 0x37,
        addi(17, 17, syscall as i32 - 4096),
        0x73,
    ]);
    if large_offset {
        words.push((2 << 15) | (3 << 12) | (10 << 7) | 0x03);
    } // ld a0, 0(sp)
    words.extend([addi(17, 0, 93), 0x73]); // exit with syscall status or remaining data length
    let size = 120 + words.len() * 4;
    let mut elf = vec![0u8; size];
    elf[..7].copy_from_slice(b"\x7fELF\x02\x01\x01");
    elf[16..18].copy_from_slice(&2u16.to_le_bytes());
    elf[18..20].copy_from_slice(&243u16.to_le_bytes());
    elf[20..24].copy_from_slice(&1u32.to_le_bytes());
    elf[24..32].copy_from_slice(&(0x10000u64 + 120).to_le_bytes());
    elf[32..40].copy_from_slice(&64u64.to_le_bytes());
    elf[52..54].copy_from_slice(&64u16.to_le_bytes());
    elf[54..56].copy_from_slice(&56u16.to_le_bytes());
    elf[56..58].copy_from_slice(&1u16.to_le_bytes());
    elf[64..68].copy_from_slice(&1u32.to_le_bytes());
    elf[68..72].copy_from_slice(&5u32.to_le_bytes());
    elf[80..88].copy_from_slice(&0x10000u64.to_le_bytes());
    elf[88..96].copy_from_slice(&0x10000u64.to_le_bytes());
    elf[96..104].copy_from_slice(&(size as u64).to_le_bytes());
    elf[104..112].copy_from_slice(&(size as u64).to_le_bytes());
    elf[112..120].copy_from_slice(&0x1000u64.to_le_bytes());
    for (chunk, word) in elf[120..].chunks_exact_mut(4).zip(words) {
        chunk.copy_from_slice(&word.to_le_bytes());
    }
    elf
}

pub fn cases() -> Vec<(&'static str, Value, bool)> {
    let good = fixture(include_bytes!(
        "../../../vendor/ckb/script/testdata/always_success"
    ));
    let mut cases = vec![("valid", good.clone(), true)];
    cases.push((
        "syscall-index-zero",
        fixture(&syscall_program(2071, false, false)),
        true,
    ));
    for (name, syscall) in [
        ("cell-index-u64", 2071),
        ("header-index-u64", 2072),
        ("input-index-u64", 2073),
        ("witness-index-u64", 2074),
        ("extension-index-u64", 2104),
    ] {
        let mut request = fixture(&syscall_program(syscall, true, false));
        request["transaction"]["witnesses"] = json!(["0x"]);
        request["transaction"]["header_deps"] =
            json!([request["context"]["cells"][0]["transaction_info"]["block_hash"]]);
        request["context"]["extensions"][0]["data"] = json!("0x00");
        cases.push((name, request, false));
    }
    let mut offset = fixture(&syscall_program(2092, false, true));
    offset["context"]["cells"][0]["data"] = json!("0x01");
    cases.push(("cell-data-offset-u64", offset, true));
    let mut large_phoff =
        include_bytes!("../../../vendor/ckb/script/testdata/always_success").to_vec();
    let phoff = u64::from_le_bytes(large_phoff[32..40].try_into().unwrap());
    large_phoff[32..40].copy_from_slice(&(phoff + (1u64 << 32)).to_le_bytes());
    cases.push(("elf-phoff-u64-overflow", fixture(&large_phoff), false));

    let mut bad = good.clone();
    bad["transaction"]["outputs"][0]["capacity"] = json!("0x174876e801");
    cases.push(("capacity-overflow", bad, false));
    let mut bad = good.clone();
    bad["transaction"]["inputs"][0]["since"] = json!("0x100000");
    cases.push(("immature-since", bad, false));
    let mut bad = good.clone();
    bad["context"]["cells"].as_array_mut().unwrap().pop();
    cases.push(("missing-dep", bad, false));
    let mut bad = good.clone();
    bad["max_cycles"] = json!("0x1");
    cases.push(("cycle-limit", bad, false));
    let mut bad = good.clone();
    let duplicate = bad["transaction"]["inputs"][0].clone();
    bad["transaction"]["inputs"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    cases.push(("duplicate-input", bad, false));
    let mut bad = good.clone();
    let duplicate = bad["transaction"]["cell_deps"][0].clone();
    // Kept explicit to make each generated mutation easy to inspect.
    bad["transaction"]["cell_deps"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    cases.push(("duplicate-dep", bad, false));
    let mut bad = good.clone();
    bad["context"]["extensions"] = json!([]);
    cases.push(("missing-extension", bad, false));
    let failure = fixture(include_bytes!(
        "../../../vendor/ckb/script/testdata/always_failure"
    ));
    cases.push(("script-failure", failure, false));
    let malformed = fixture(b"not a RISC-V ELF");
    cases.push(("invalid-program", malformed, false));
    let lock: rpc::Script =
        serde_json::from_value(good["context"]["cells"][0]["output"]["lock"].clone()).unwrap();
    let hash = packed::Script::from(lock).calc_script_hash();
    let mut selected = good.clone();
    selected["script_group"] =
        json!({"group_type":"lock","script_hash":format!("0x{}",hex::encode(hash.as_slice()))});
    cases.push(("selected-lock", selected, true));
    let mut selected = good.clone();
    selected["script_group"] =
        json!({"group_type":"type","script_hash":format!("0x{}",hex::encode(hash.as_slice()))});
    cases.push(("missing-group", selected, false));
    let mut with_type = good.clone();
    with_type["transaction"]["outputs"][0]["type"] =
        good["context"]["cells"][0]["output"]["lock"].clone();
    cases.push(("lock-and-type", with_type.clone(), true));
    with_type["script_group"] =
        json!({"group_type":"type", "script_hash":format!("0x{}",hex::encode(hash.as_slice()))});
    cases.push(("selected-type", with_type, true));
    let mut group = good.clone();
    let dep_point: rpc::OutPoint =
        serde_json::from_value(group["context"]["cells"][1]["out_point"].clone()).unwrap();
    let group_data: packed::OutPointVec = vec![packed::OutPoint::from(dep_point)].pack();
    let group_point = json!({"tx_hash":format!("0x{}","33".repeat(32)),"index":"0x0"});
    let mut group_cell = group["context"]["cells"][1].clone();
    group_cell["out_point"] = group_point.clone();
    group_cell["data"] = json!(format!("0x{}", hex::encode(group_data.as_slice())));
    group["context"]["cells"]
        .as_array_mut()
        .unwrap()
        .push(group_cell);
    group["transaction"]["cell_deps"] = json!([{"out_point":group_point,"dep_type":"dep_group"}]);
    cases.push(("dep-group", group.clone(), true));
    group["context"]["cells"][2]["data"] = json!("0x1234");
    cases.push(("malformed-dep-group", group, false));
    let mut bad = good.clone();
    bad["context"]["cells"][0]["transaction_info"]["index"] = json!("0x0");
    cases.push(("immature-cellbase-input", bad, false));
    let mut bad = good.clone();
    bad["context"]["cells"][0]["transaction_info"]["block_number"] = json!("0x63");
    cases.push(("origin-mismatch", bad, false));
    let mut bad = good.clone();
    bad["context"]["headers"][0]["epoch"] = json!("0x0");
    cases.push(("malformed-header-epoch", bad, false));
    let mut bad = good.clone();
    bad["context"]["extensions"][0]
        .as_object_mut()
        .unwrap()
        .remove("data");
    cases.push(("omitted-extension-data", bad, false));
    let mut bad = good.clone();
    bad["transaction"]["inputs"][0]["since"] = json!("0x4000000000000001");
    cases.push(("missing-median-ancestors", bad, false));
    let mut bad = good.clone();
    bad["transaction"]["outputs"][0]["capacity"] = json!("0x1");
    cases.push(("insufficient-occupied-capacity", bad, false));
    let mut bad = good.clone();
    bad["transaction"]["outputs_data"] = json!([]);
    cases.push(("outputs-data-mismatch", bad, false));
    let mut bad = good.clone();
    bad["transaction"]["version"] = json!("0x1");
    cases.push(("invalid-version", bad, false));
    let mut bad = good;
    bad["max_cycles"] = json!("0xffffffffffffffff");
    cases.push(("excessive-cycle-limit", bad, false));
    cases
}
