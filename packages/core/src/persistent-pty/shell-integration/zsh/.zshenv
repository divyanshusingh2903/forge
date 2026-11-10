typeset -g __forge_zdotdir=${FORGE_ORIGINAL_ZDOTDIR:-$HOME}
if [[ -f $__forge_zdotdir/.zshenv ]]; then
  ZDOTDIR=$__forge_zdotdir
  source "$__forge_zdotdir/.zshenv"
  __forge_zdotdir=${ZDOTDIR:-$HOME}
fi
ZDOTDIR=$FORGE_ZSH_INTEGRATION
