# A Run arrives as a bracketed paste followed by Enter, so it shows, runs and
# is remembered exactly like a typed command.
function __forge_preexec --on-event fish_preexec
    printf '\033]633;Forge;2;manual_start\007'
end
function __forge_finish --on-event fish_postexec
    printf '\033]633;Forge;2;end;%s\007' $status
end
function __forge_ready --on-event fish_prompt
    printf '\033]633;Forge;2;ready;fish\007'
end
