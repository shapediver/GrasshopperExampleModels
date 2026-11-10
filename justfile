[windows]
set shell := ["powershell.exe", "-NoLogo", "-Command"]

# List example models whose Platform status is denied.
[unix]
list-denied SHAPEDIVER_ACCESS_KEY_ID SHAPEDIVER_ACCESS_KEY_SECRET:
    PROCESS_MODELS_CHAPTER= SHAPEDIVER_ACCESS_KEY_ID={{ quote(SHAPEDIVER_ACCESS_KEY_ID) }} SHAPEDIVER_ACCESS_KEY_SECRET={{ quote(SHAPEDIVER_ACCESS_KEY_SECRET) }} pnpm run docs:list-denied-models

# List example models whose Platform status is denied.
[windows]
list-denied SHAPEDIVER_ACCESS_KEY_ID SHAPEDIVER_ACCESS_KEY_SECRET:
    $env:PROCESS_MODELS_CHAPTER = ''; $env:SHAPEDIVER_ACCESS_KEY_ID = '{{ replace(SHAPEDIVER_ACCESS_KEY_ID, "'", "''") }}'; $env:SHAPEDIVER_ACCESS_KEY_SECRET = '{{ replace(SHAPEDIVER_ACCESS_KEY_SECRET, "'", "''") }}'; pnpm.cmd run docs:list-denied-models; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
