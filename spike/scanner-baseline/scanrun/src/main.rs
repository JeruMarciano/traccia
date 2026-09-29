// Runs today's Traccia scanner, unchanged, on one URL and prints its JSON.
use std::sync::Arc;
#[tokio::main]
async fn main() {
    let url = std::env::args().nth(1).expect("url");
    match traccia_lib::scan::run(Arc::new(Default::default()), url).await {
        Ok(json) => println!("{json}"),
        Err(e) => { eprintln!("ERR {e}"); std::process::exit(1) }
    }
}
