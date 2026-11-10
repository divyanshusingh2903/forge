$global:__forge_original_prompt = $function:prompt
$global:__forge_original_readline = $function:PSConsoleHostReadLine
if ($global:__forge_original_readline) {
    function global:PSConsoleHostReadLine {
        $line = & $global:__forge_original_readline
        [Console]::Write("$([char]27)]633;Forge;2;manual_start$([char]7)")
        $line
    }
}
function global:__forge_run([string]$source) {
    $global:__forge_active = $true
    [Console]::WriteLine($source)
    [Console]::Write("$([char]27)]633;Forge;2;start$([char]7)")
    . ([scriptblock]::Create($source))
    $global:__forge_success = $?
    $global:__forge_active = $false
    [Console]::Write("$([char]27)]633;Forge;2;end;$($global:__forge_success.ToString().ToLowerInvariant())$([char]7)")
    $global:__forge_success = $null
}
function global:prompt {
    if ($global:__forge_active) {
        $global:__forge_active = $false
        $global:__forge_success = $null
        [Console]::Write("$([char]27)]633;Forge;2;end;unknown$([char]7)")
    }
    if ($global:__forge_original_prompt) { & $global:__forge_original_prompt }
    else { "PS $($executionContext.SessionState.Path.CurrentLocation)> " }
    [Console]::Write("$([char]27)]633;Forge;2;ready;powershell$([char]7)")
}
