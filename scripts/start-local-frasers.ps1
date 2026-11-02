Set-StrictMode -Version Latest

$env:NEXT_PUBLIC_ENABLE_FRASERS_PLUS = "true"
$env:ENABLE_FRASERS_PLUS = "true"
$env:FRASERS_PLUS_USE_MOCK = "false"
$env:FRASERS_PLUS_API_BASE_URL = "https://merchant-api.staging.tymit.com"
$env:FRASERS_PLUS_REDIRECT_URL = "http://localhost:3000/frasers-plus/return"
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"
$env:APP_DATA_STORE = "file"

npm run dev
