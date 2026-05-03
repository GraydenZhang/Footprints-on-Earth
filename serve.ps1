$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location -LiteralPath $root
node .\server.mjs
