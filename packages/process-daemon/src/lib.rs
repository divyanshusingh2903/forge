pub mod client;
pub mod daemon;
mod ghostty;
#[cfg(all(target_os = "linux", target_env = "musl"))]
mod musl;
#[cfg(any(unix, windows))]
mod ownership;
pub mod protocol;
pub mod service;
pub mod shell_integration;
#[cfg(any(unix, windows))]
mod transport;
