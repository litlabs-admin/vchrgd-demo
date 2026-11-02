Set-StrictMode -Version Latest

$env:APP_DATA_STORE = "file"
$env:CARD_PAYMENT_PROVIDER = "revolut"
$env:REVOLUT_FORCE_LOCAL_DEMO = "false"
$env:REVOLUT_REDIRECT_URL = "https://accommodation-artists-aside-ver.trycloudflare.com/card/return"
$env:ENABLE_FRASERS_PLUS = "false"
$env:NEXT_PUBLIC_ENABLE_FRASERS_PLUS = "false"
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"

npm run dev
