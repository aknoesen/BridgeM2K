# push.ps1 — one-command stage/commit/push helper
# Usage:  .\push.ps1 "commit message"
param([string]$m = "wip")
git add -A
git commit -m $m
git push
