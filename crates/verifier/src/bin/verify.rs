//! Native reference CLI: read one request JSON document from stdin.
use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        eprintln!("cannot read request: {error}");
        std::process::exit(2);
    }
    println!("{}", ckb_wasm_verifier::verify_json(&input));
}
