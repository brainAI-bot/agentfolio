# SATP 91455b6 escrow IDL fallback

This directory contains a byte-for-byte copy of `idls/v3/escrow_v3.json` from
SATP commit `91455b6824798c9993c29816acca7d394ae39365`.

- Git blob: `4c846a12878401ec69f558fd8968d9fc0e986f94`
- File SHA-256: `ef9622a6d07bd818d3a74ba6c61f3b3f447f61167e82aadc65ecbce4fb307829`
- Bytes: `20926`
- Instructions: `14`

The installed `@brainai/satp-client` package is the authoritative consumer
source. This checked-in copy is a read-only diagnostic fallback and cannot by
itself authorize live escrow writes.
