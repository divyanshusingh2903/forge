# Load the user's ordinary interactive configuration before adding Forge hooks.
[[ -f ~/.bashrc ]] && source ~/.bashrc

# A Run arrives as a bracketed paste followed by Enter, so it shows, runs and
# is remembered exactly like a typed command. PS0 (Bash >= 4.4) is the only
# hook between accepting a line and executing it that leaves DEBUG traps alone;
# older Bash stays unintegrated.
if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then
  # Sent before the paste: its text is source, never a history reference.
  __forge_begin() {
    if [[ $- == *H* ]]; then
      __forge_histexpand=1
      set +H
    fi
  }
  __forge_finish() {
    local __forge_previous=${1:-0}
    if [[ -n ${__forge_histexpand:-} ]]; then
      unset __forge_histexpand
      set -H
    fi
    printf '\033]633;Forge;2;end;%s\007' "$__forge_previous"
    return "$__forge_previous"
  }
  __forge_ready() { printf '\033]633;Forge;2;ready;bash\007'; }

  bind 'set enable-bracketed-paste on'
  bind -m emacs -x '"\e[633~": __forge_begin'
  bind -m vi-insert -x '"\e[633~": __forge_begin'

  PS0=$'\033]633;Forge;2;manual_start\007'"${PS0:-}"

  # Preserve both forms of PROMPT_COMMAND, without replacing DEBUG traps or PS0.
  if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a '* ]]; then
    PROMPT_COMMAND=('__forge_finish $?' "${PROMPT_COMMAND[@]}" '__forge_ready')
  else
    PROMPT_COMMAND="__forge_finish \$?; ${PROMPT_COMMAND:+${PROMPT_COMMAND}; }__forge_ready"
  fi
fi
