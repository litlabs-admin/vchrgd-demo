Set-StrictMode -Version Latest

$env:APP_DATA_STORE = "file"
$env:CARD_PAYMENT_PROVIDER = "revolut"
$env:REVOLUT_FORCE_LOCAL_DEMO = "true"
$env:REVOLUT_REDIRECT_URL = "http://localhost:3000/card/return"
$env:ENABLE_FRASERS_PLUS = "false"
$env:NEXT_PUBLIC_ENABLE_FRASERS_PLUS = "false"
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"

npm run dev
