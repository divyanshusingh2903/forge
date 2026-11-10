use std::collections::VecDeque;
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use base64::Engine;
use serde::{Deserialize, Serialize};

const HALF_OUTPUT: usize = 10_240;
const MAX_ESCAPE: usize = 4_096;
/// A shell that still has the hooks prints `start` right after reading the line.
const START_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub id: String,
    pub outcome: String,
    pub exit_code: Option<i32>,
    pub success: Option<bool>,
    pub output: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunStatus {
    pub state: String,
    pub shell: Option<String>,
    pub run: Option<RunResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunAdmission {
    pub accepted: bool,
    pub reason: Option<String>,
}

/// Owned exclusively by the PTY actor. Replay never passes through this parser.
#[derive(Default)]
pub struct ShellIntegration {
    shell: Option<String>,
    ready: bool,
    /// Bytes typed on the current prompt line that no Enter has submitted yet.
    pending_input: bool,
    /// An Enter the shell has not yet answered with `manual_start` or a new prompt.
    unacked_submit: bool,
    manual_running: bool,
    admitted: Option<Instant>,
    active: Option<RunResult>,
    last: Option<RunResult>,
    capture: bool,
    head: Vec<u8>,
    tail: VecDeque<u8>,
    total: usize,
    escape: Vec<u8>,
    escape_previous: Option<u8>,
    dropping_escape: bool,
}

impl ShellIntegration {
    pub fn status(&self, id: &str) -> RunStatus {
        RunStatus {
            state: if self.shell.is_none() {
                "unsupported"
            } else if self.active.is_some() || self.manual_running {
                "running"
            } else if self.pending_input || self.unacked_submit {
                "dirty"
            } else if self.ready {
                "ready"
            } else {
                "unknown"
            }
            .to_string(),
            shell: self.shell.clone(),
            run: self
                .active
                .iter()
                .chain(self.last.iter())
                .find(|run| id.is_empty() || run.id == id)
                .cloned(),
        }
    }

    /// Tracks only what is on the current prompt line. Every new prompt starts
    /// clean, so earlier manual work never disables a terminal.
    pub fn input(&mut self, bytes: &[u8]) {
        // Focus reports are not line input; a shell that enables them gets one
        // whenever the user clicks from the terminal to a Run button.
        if matches!(bytes, b"\x1b[I" | b"\x1b[O") {
            return;
        }
        for byte in bytes {
            if matches!(byte, b'\r' | b'\n') {
                self.pending_input = false;
                self.unacked_submit = true;
            } else {
                self.pending_input = true;
            }
        }
    }

    /// Ends a run whose line never reached the hooks, such as after `exec zsh`.
    pub fn expire(&mut self, now: Instant) {
        if self.capture {
            return;
        }
        if self
            .admitted
            .is_some_and(|at| now.duration_since(at) >= START_DEADLINE)
        {
            self.finish("unknown", None, None);
        }
    }

    pub fn admit(&mut self, id: String, command: &str) -> Result<Vec<u8>> {
        if id.is_empty()
            || id.len() > 128
            || command.trim().is_empty()
            || command.len() > 65_536
            || command.contains('\0')
        {
            bail!("invalid_command");
        }
        if self.last.as_ref().is_some_and(|run| run.id == id) {
            bail!("already_executed");
        }
        match self.status("").state.as_str() {
            "ready" => {}
            "running" => bail!("busy"),
            "dirty" => bail!("dirty"),
            "unsupported" => bail!("unsupported"),
            _ => bail!("not_ready"),
        }
        let input = match self.shell.as_deref() {
            // A bracketed paste followed by Enter: the shell shows, runs and
            // remembers the source exactly like a typed command, and keeps
            // newlines and tabs literal. The leading key runs the hook that
            // suspends history expansion for this one line; Fish has none.
            Some(shell @ ("bash" | "zsh" | "fish")) => {
                let source = command.replace("\r\n", "\n").replace('\r', "\n");
                let source = source.trim_end_matches('\n');
                // Any other control character could end the paste early.
                if source
                    .chars()
                    .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\t'))
                {
                    bail!("invalid_command");
                }
                let begin = if shell == "fish" { "" } else { "\x1b[633~" };
                format!("{begin}\x1b[200~{source}\x1b[201~\r")
            }
            // Evaluated in the interactive scope; quoting keeps it one line.
            Some("powershell") => {
                let encoded = base64::engine::general_purpose::STANDARD.encode(command);
                format!(
                    ". __forge_run ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')))\r"
                )
            }
            _ => bail!("unsupported"),
        };
        self.ready = false;
        self.admitted = Some(Instant::now());
        self.capture = false;
        self.head.clear();
        self.tail.clear();
        self.total = 0;
        self.active = Some(RunResult {
            id,
            outcome: "running".to_string(),
            exit_code: None,
            success: None,
            output: String::new(),
            truncated: false,
        });
        Ok(input.into_bytes())
    }

    pub fn failed_write(&mut self) {
        self.finish("unknown", None, None);
        self.ready = false;
    }

    pub fn exited(&mut self) {
        self.finish("terminated", None, None);
        self.ready = false;
    }

    pub fn output(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if self.escape.is_empty() {
                if byte == 0x1b {
                    self.escape.push(byte);
                    self.escape_previous = Some(byte);
                } else if self.capture && (byte >= 0x20 || byte == b'\n' || byte == b'\t') {
                    self.capture_byte(byte);
                }
                continue;
            }
            let previous = self.escape_previous;
            self.escape_previous = Some(byte);
            // Like a terminal, abort an unterminated string on CAN, SUB or a
            // new ESC, so it cannot swallow the markers that follow it.
            if matches!(byte, 0x18 | 0x1a) {
                self.reset_escape();
                continue;
            }
            let string = matches!(self.escape.get(1), Some(b']' | b'P' | b'_' | b'^'));
            if string && previous == Some(0x1b) && byte != b'\\' {
                self.escape.truncate(1);
                self.dropping_escape = false;
            }
            if byte == 0x1b && !matches!(self.escape.get(1), Some(b']' | b'P' | b'_' | b'^')) {
                self.escape.truncate(1);
                self.dropping_escape = false;
                continue;
            }
            if self.escape.len() < MAX_ESCAPE {
                self.escape.push(byte);
            } else {
                self.dropping_escape = true;
            }
            let kind = self.escape.get(1).copied();
            let complete = match kind {
                Some(b']' | b'P' | b'_' | b'^') => {
                    byte == 7 || (previous == Some(0x1b) && byte == b'\\')
                }
                Some(b'[') => self.escape.len() > 2 && (0x40..=0x7e).contains(&byte),
                _ => (0x30..=0x7e).contains(&byte),
            };
            if !complete {
                continue;
            }
            if kind == Some(b']') && !self.dropping_escape {
                let end = self.escape.len() - if byte == 7 { 1 } else { 2 };
                let payload = String::from_utf8_lossy(&self.escape[2..end]).into_owned();
                self.marker(&payload);
            }
            self.reset_escape();
        }
    }

    fn reset_escape(&mut self) {
        self.escape.clear();
        self.escape_previous = None;
        self.dropping_escape = false;
    }

    fn marker(&mut self, value: &str) {
        let Some(value) = value.strip_prefix("633;Forge;2;") else {
            return;
        };
        if let Some(shell) = value.strip_prefix("ready;") {
            if matches!(shell, "bash" | "zsh" | "fish" | "powershell") {
                self.shell = Some(shell.to_string());
                self.manual_running = false;
                // A new prompt has an empty line.
                self.pending_input = false;
                self.unacked_submit = false;
                // The prompt is back, so a run whose `end` was lost is over.
                if self.capture {
                    self.finish("unknown", None, None);
                }
                self.ready = self.active.is_none();
            }
            return;
        }
        if value == "manual_start" {
            if self.active.is_none() {
                self.ready = false;
                self.manual_running = true;
                self.unacked_submit = false;
            } else if self.shell.as_deref() != Some("powershell") {
                // A pasted run executes as an ordinary line, so the shell's
                // own pre-execution hook marks where its output begins.
                self.capture = true;
            }
            return;
        }
        if value == "start" && self.active.is_some() && !self.capture {
            self.capture = true;
            return;
        }
        if let Some(status) = value.strip_prefix("end;") {
            if !self.capture {
                return;
            }
            let code = status.parse::<i32>().ok();
            let success = match status {
                "true" => Some(true),
                "false" => Some(false),
                _ => code.map(|code| code == 0),
            };
            self.finish(
                if success.is_some() {
                    "completed"
                } else {
                    "unknown"
                },
                code,
                success,
            );
        }
    }

    fn capture_byte(&mut self, byte: u8) {
        self.total = self.total.saturating_add(1);
        if self.head.len() < HALF_OUTPUT {
            self.head.push(byte);
            return;
        }
        if self.tail.len() == HALF_OUTPUT {
            self.tail.pop_front();
        }
        self.tail.push_back(byte);
    }

    fn finish(&mut self, outcome: &str, exit_code: Option<i32>, success: Option<bool>) {
        let Some(mut run) = self.active.take() else {
            return;
        };
        self.capture = false;
        self.admitted = None;
        run.outcome = outcome.to_string();
        run.exit_code = exit_code;
        run.success = success;
        run.truncated = self.total > HALF_OUTPUT * 2;
        let mut bytes = self.head.clone();
        if run.truncated {
            bytes.extend_from_slice(b"\n[output truncated]\n");
        }
        bytes.extend(self.tail.iter());
        run.output = String::from_utf8_lossy(&bytes).into_owned();
        self.last = Some(run);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn integrated(shell: &str) -> ShellIntegration {
        let mut state = ShellIntegration::default();
        state.output(format!("\x1b]633;Forge;2;ready;{shell}\x07").as_bytes());
        state
    }

    #[test]
    fn captures_lifecycle_with_every_byte_split_and_no_echo_false_positive() {
        for terminator in ["\x07", "\x1b\\"] {
            let mut state = integrated("bash");
            state.admit("first".to_string(), "printf hello").unwrap();
            let output = format!(
                "__forge_run printf hello\r\n\x1b]633;Forge;2;start{terminator}\x1b[31mhello\x1b[0m\r\n\x1b]633;Forge;2;end;7{terminator}\x1b]633;Forge;2;ready;bash{terminator}prompt> "
            );
            for byte in output.bytes() {
                state.output(&[byte]);
            }
            let status = state.status("first");
            assert_eq!(status.state, "ready");
            let result = status.run.unwrap();
            assert_eq!(result.output, "hello\n");
            assert_eq!(result.exit_code, Some(7));
            assert_eq!(result.success, Some(false));
            assert!(state.admit("first".to_string(), "printf hello").is_err());
        }
    }

    #[test]
    fn only_the_current_prompt_line_blocks_a_run() {
        // Unsubmitted text, and a line the shell has not answered (a quote
        // continuation), would be glued to the run.
        for bytes in [b"echo partial".as_slice(), b"\t", b"echo \"open\r"] {
            let mut state = integrated("zsh");
            state.input(bytes);
            assert_eq!(
                state
                    .admit("id".to_string(), "pwd")
                    .unwrap_err()
                    .to_string(),
                "dirty"
            );
        }
        // An empty Enter, Ctrl+C and focus reports leave a clean new prompt.
        for bytes in [b"\r".as_slice(), b"\x03", b"\x1b[A"] {
            let mut state = integrated("zsh");
            state.input(bytes);
            state.output(b"\x1b]633;Forge;2;ready;zsh\x07");
            state.admit("id".to_string(), "pwd").unwrap();
        }
        let mut state = integrated("fish");
        state.input(b"\x1b[O");
        state.admit("id".to_string(), "pwd").unwrap();
    }

    #[test]
    fn input_to_a_running_command_does_not_disable_later_runs() {
        let mut state = integrated("bash");
        state.admit("first".to_string(), "sudo true").unwrap();
        state.output(b"\x1b]633;Forge;2;start\x07");
        state.input(b"password\r");
        state.output(b"\x1b]633;Forge;2;end;0\x07\x1b]633;Forge;2;ready;bash\x07");
        assert_eq!(state.status("first").run.unwrap().outcome, "completed");
        state.admit("second".to_string(), "pwd").unwrap();
    }

    #[test]
    fn bounds_output_and_ignores_prompt_redraws_without_execution() {
        let mut state = integrated("fish");
        state.admit("id".to_string(), "echo output").unwrap();
        state.output(b"\x1b]633;Forge;2;end;0\x07");
        assert_eq!(state.status("id").run.unwrap().outcome, "running");
        state.output(b"\x1b]633;Forge;2;start\x07head");
        state.output(&vec![b'x'; 100_000]);
        state.output(b"tail\x1b]633;Forge;2;end;0\x07");
        let result = state.status("id").run.unwrap();
        assert!(result.truncated);
        assert!(result.output.starts_with("head"));
        assert!(result.output.ends_with("tail"));
        assert!(result.output.len() <= 20_480 + 20);
    }

    #[test]
    fn manual_commands_return_to_ready() {
        let mut state = integrated("bash");
        state.input(b"pwd\r");
        assert_eq!(state.status("").state, "dirty");
        state.output(b"\x1b]633;Forge;2;manual_start\x07");
        assert_eq!(state.status("").state, "running");
        assert_eq!(
            state
                .admit("run".to_string(), "pwd")
                .unwrap_err()
                .to_string(),
            "busy"
        );
        state.input(b"q");
        state.output(b"/repo\n\x1b]633;Forge;2;ready;bash\x07");
        assert_eq!(state.status("").state, "ready");
        state.admit("run".to_string(), "pwd").unwrap();
    }

    #[test]
    fn a_lost_end_marker_or_missing_hooks_cannot_leave_a_run_running() {
        // An unterminated title sequence must not swallow the end marker.
        let mut state = integrated("bash");
        state.admit("first".to_string(), "cat binary").unwrap();
        state.output(b"\x1b]633;Forge;2;start\x07out\x1b]0;title");
        state.output(b"\x1b]633;Forge;2;end;3\x07");
        assert_eq!(state.status("first").run.unwrap().exit_code, Some(3));

        // A prompt after a captured run ends it even without an end marker.
        let mut state = integrated("zsh");
        state.admit("second".to_string(), "pwd").unwrap();
        state.output(b"\x1b]633;Forge;2;start\x07out\x1b]633;Forge;2;ready;zsh\x07");
        assert_eq!(state.status("second").run.unwrap().outcome, "unknown");
        assert_eq!(state.status("").state, "ready");

        // A replaced shell never prints start.
        let mut state = integrated("bash");
        state.admit("third".to_string(), "pwd").unwrap();
        state.expire(Instant::now());
        assert_eq!(state.status("third").run.unwrap().outcome, "running");
        state.expire(Instant::now() + START_DEADLINE);
        assert_eq!(state.status("third").run.unwrap().outcome, "unknown");
        assert_eq!(state.status("").state, "unknown");
    }

    #[test]
    fn unknown_interruption_status_is_not_reported_as_success() {
        let mut state = integrated("zsh");
        state.admit("run".to_string(), "sleep 60").unwrap();
        state.output(b"\x1b]633;Forge;2;start\x07partial output");
        state.input(b"\x03");
        state.output(b"\x1b]633;Forge;2;end;unknown\x07\x1b]633;Forge;2;ready;zsh\x07");
        let result = state.status("run").run.unwrap();
        assert_eq!(result.outcome, "unknown");
        assert_eq!(result.success, None);
        assert_eq!(result.exit_code, None);
        assert_eq!(result.output, "partial output");
        state.admit("next".to_string(), "pwd").unwrap();
    }

    #[test]
    fn pastes_source_literally_and_submits_once() {
        for shell in ["bash", "zsh", "fish"] {
            let mut state = integrated(shell);
            let bytes = state
                .admit("id".to_string(), "printf 'quote\\path'\r\n\t# café!\n")
                .unwrap();
            let begin = if shell == "fish" { "" } else { "\x1b[633~" };
            assert_eq!(
                String::from_utf8(bytes).unwrap(),
                format!("{begin}\x1b[200~printf 'quote\\path'\n\t# café!\x1b[201~\r")
            );
            assert!(state.admit("second".to_string(), "pwd").is_err());
            state.exited();
            assert_eq!(state.status("id").run.unwrap().outcome, "terminated");

            // An escape character could close the paste and inject keys.
            let mut state = integrated(shell);
            assert_eq!(
                state
                    .admit("id".to_string(), "echo \x1b[201~")
                    .unwrap_err()
                    .to_string(),
                "invalid_command"
            );
        }
        let mut state = integrated("powershell");
        let bytes = state.admit("id".to_string(), "echo 'a'\n\t\x1b").unwrap();
        assert_eq!(bytes.iter().filter(|&&byte| byte == b'\r').count(), 1);
        assert!(!bytes.contains(&b'\n') && !bytes.contains(&0x1b));
    }

    #[test]
    fn a_pasted_run_is_captured_between_the_shell_hooks() {
        let mut state = integrated("bash");
        state.admit("id".to_string(), "echo one\nfalse").unwrap();
        // The echoed line precedes the hook; each pasted line fires it again.
        state.output(b"echo one\r\nfalse\r\n\x1b]633;Forge;2;manual_start\x07one\r\n");
        state.output(b"\x1b]633;Forge;2;manual_start\x07");
        state.output(b"\x1b]633;Forge;2;end;1\x07\x1b]633;Forge;2;ready;bash\x07");
        let result = state.status("id").run.unwrap();
        assert_eq!(result.output, "one\n");
        assert_eq!(result.exit_code, Some(1));
        assert_eq!(state.status("").state, "ready");
    }

    #[test]
    fn powershell_reports_logical_status_without_fabricating_exit_codes() {
        let mut state = integrated("powershell");
        state
            .admit("id".to_string(), "Write-Error failure")
            .unwrap();
        state.output(b"\x1b]633;Forge;2;start\x07failure\x1b]633;Forge;2;end;false\x07");
        let result = state.status("id").run.unwrap();
        assert_eq!(result.exit_code, None);
        assert_eq!(result.success, Some(false));
        assert_eq!(result.output, "failure");
    }
}
