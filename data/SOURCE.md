# Sanctions data source

- **File:** `ofac-eth-addresses.json`
- **Fetched:** 2026-09-08 (UTC)
- **Source:** Community OFAC sanctioned digital-currency address list (ETH)
  https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json
- **Upstream project:** https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
- **License / note:** Community mirror of publicly listed OFAC SDN digital-currency addresses. Not an official Treasury API. Refresh periodically for production; do not treat as exhaustive compliance.

Production deployments must refresh this file from OFAC / a maintained feed. Trust Gate loads it offline at boot — no paid API keys.
