# Compatibility entry point for PR #122. All deployment logic lives in the one-click root script.
# No -Package/-Migrate/-Yes switches are needed or accepted: provenance and migration policy are automatic.
& (Join-Path $PSScriptRoot '..\..\deploy-11ship.ps1')
exit $LASTEXITCODE
