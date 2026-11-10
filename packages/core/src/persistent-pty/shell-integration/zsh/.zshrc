ZDOTDIR=$__forge_zdotdir
# A system zshrc (macOS) derives HISTFILE from ZDOTDIR before this file runs.
[[ ${HISTFILE:-} == $FORGE_ZSH_INTEGRATION/* ]] && HISTFILE=$ZDOTDIR/${HISTFILE:t}
[[ -f $ZDOTDIR/.zshrc ]] && source "$ZDOTDIR/.zshrc"

# A Run arrives as a bracketed paste followed by Enter, so it shows, runs and
# is remembered exactly like a typed command.
# Sent before the paste: its text is source, never a history reference.
__forge-begin() {
  if [[ -o banghist ]]; then
    typeset -g __forge_banghist=1
    setopt nobanghist
  fi
}
zle -N __forge-begin
for __forge_keymap in emacs viins vicmd; do
  bindkey -M $__forge_keymap '\e[633~' __forge-begin
done
unset __forge_keymap

__forge_precmd() {
  local __forge_previous=$?
  if [[ -n ${__forge_banghist:-} ]]; then
    unset __forge_banghist
    setopt banghist
  fi
  printf '\033]633;Forge;2;end;%s\007' "$__forge_previous"
  return "$__forge_previous"
}
__forge_ready() { printf '\033]633;Forge;2;ready;zsh\007'; }
__forge_preexec() { printf '\033]633;Forge;2;manual_start\007'; }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __forge_preexec
precmd_functions=(__forge_precmd ${precmd_functions:#__forge_precmd} __forge_ready)
