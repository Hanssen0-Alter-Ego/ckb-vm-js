#[path = "../src/test_support.rs"]
mod test_support;
fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| "fixtures".into());
    std::fs::create_dir_all(&dir).unwrap();
    for (name, request, expected) in test_support::cases() {
        let response: serde_json::Value =
            serde_json::from_str(&ckb_wasm_verifier::verify_json(&request.to_string())).unwrap();
        assert_eq!(response["ok"], expected, "{name}: {response}");
        let case = serde_json::json!({"request":request,"expected":response});
        std::fs::write(
            format!("{dir}/{name}.json"),
            serde_json::to_string_pretty(&case).unwrap() + "\n",
        )
        .unwrap();
        println!("{name}: {}", response);
    }
}
