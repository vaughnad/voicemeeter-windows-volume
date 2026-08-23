param(
    [string]$ScriptPath = (Join-Path $PSScriptRoot "..\include\auto-start-task.ps1")
)

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $ScriptPath,
    [ref]$tokens,
    [ref]$parseErrors
)

if ($parseErrors.Count -gt 0) {
    throw "auto-start-task.ps1 has PowerShell parse errors: $($parseErrors.Message -join '; ')"
}

$commands = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst]
}, $true)

$startProcessCommands = @($commands | Where-Object {
    $_.GetCommandName() -eq "Start-Process"
})

if ($startProcessCommands.Count -ne 1) {
    throw "Expected exactly one Start-Process command, found $($startProcessCommands.Count)."
}

$destructiveCommands = @($commands | Where-Object {
    $_.GetCommandName() -in @("taskkill", "Stop-Process")
})

if ($destructiveCommands.Count -gt 0) {
    throw "The startup task must not terminate existing VMWV processes."
}

$loopTypes = @(
    [System.Management.Automation.Language.WhileStatementAst],
    [System.Management.Automation.Language.DoWhileStatementAst],
    [System.Management.Automation.Language.DoUntilStatementAst],
    [System.Management.Automation.Language.ForStatementAst],
    [System.Management.Automation.Language.ForEachStatementAst]
)
$loops = $ast.FindAll({
    param($node)
    $loopTypes -contains $node.GetType()
}, $true)

foreach ($loop in $loops) {
    $loopStartCommands = $loop.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
            $node.GetCommandName() -eq "Start-Process"
    }, $true)

    if ($loopStartCommands.Count -gt 0) {
        throw "Start-Process must not run inside a retry loop."
    }
}

$scriptContents = Get-Content -LiteralPath $ScriptPath -Raw
if ($scriptContents -notmatch "tray_windows_release\.exe") {
    throw "The startup check must target the systray2 Windows child process."
}
if ($scriptContents -notmatch "\.AddSeconds\(30\)") {
    throw "The startup check must have a bounded 30-second timeout."
}

Write-Host "auto-start-task.ps1 regression checks passed."
