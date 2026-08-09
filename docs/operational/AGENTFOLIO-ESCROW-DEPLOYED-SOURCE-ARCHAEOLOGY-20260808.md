# AgentFolio Escrow Deployed-Source Archaeology [#ef7e4581]

Date: 2026-08-08  
Scope: read-only source and build archaeology; no Solana write, deployment,
upgrade, authority/keypair access, IDL publication, or runtime mutation.

## Canonical deployed tuple

The deployed mainnet program is the runtime authority for this record:

| Field | Readback |
| --- | --- |
| Program | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |
| ProgramData | `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk` |
| ProgramData account length | `290725` bytes |
| ELF offset in ProgramData | `45` |
| Extracted ELF length | `290680` bytes |
| Extracted ELF SHA-256 | `b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094` |
| ELF machine | `EM_SBF (0x107)` |

The tuple and dumped ELF can be re-derived without a keypair:

```sh
program_id=HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C
artifact_dir=$(mktemp -d)
solana --url mainnet-beta program show "$program_id"
solana --url mainnet-beta program dump "$program_id" "$artifact_dir/escrow_v3-mainnet.so"
wc -c "$artifact_dir/escrow_v3-mainnet.so"
shasum -a 256 "$artifact_dir/escrow_v3-mainnet.so"
```

The recorded `program show` output names ProgramData
`Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk`. The final two commands
recorded `290680` bytes and
`b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094`.
The full account-level readback, including the ProgramData account hash, is in
`docs/operational/ESCROW-V3-SOURCE-DEPLOYED-IDL-READBACK-49e40f78.md`.

## Source candidates

| Candidate | Exact input | Source evidence | Status against deployed ELF |
| --- | --- | --- | --- |
| Historical deployment candidate | `brainAI-bot/clawd-brainchain@27f38ff8fa32c72008606c0a3d87f2e1b7256c8c`, `satp-v3/programs/escrow_v3/src/lib.rs` | source SHA-256 `855ae970eb45d3a503f8586ddbf0b474220cbce8eba0c504dcf74b442c1b71e7`; declares `HXCUWKR2...`; commit message records the Anchor 1.0 mainnet upgrade | Provenance candidate only. The commit does not contain the deployed ELF, compiler/container digest, Solana CLI version, or a build transcript/hash, so no reproduced-binary claim is made. |
| Current AgentFolio fork | `brainAI-bot/agentfolio@f25b9c23d886d6adb0ebb57defd52689b5dc9990`, `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | source SHA-256 `a713fb25815f724bde8bc0ed9eec0c104826fc0fb26bd3f608a6ed46096efd4c`; Cargo.lock SHA-256 `52c6b0701f7f69798582f350576000de01055f1235a12c6efcadf9a26d0e7e29` | Rebuilt under both available SBF toolchains below; neither hash matches the deployed target. This is an undeployed fork. |

No other repository source candidate with a deployment-linked commit was found
in the read-only archaeology. In particular, a source tree sharing the program
ID is not treated as deployed provenance without a matching ELF hash.

## Toolchain and hash matrix

Target for every binary comparison:
`b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094`
(`290680` bytes, `EM_SBF`).

| Source | Host Cargo / rustc | Anchor | Solana CLI / builder | Platform tools / SBF rustc | Profile and command | Reproduced ELF | Target match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AgentFolio `f25b9c2` | Cargo `1.86.0`; rustc `1.86.0` | CLI and `anchor-lang` `0.31.1` | Solana CLI / `solana-cargo-build-sbf` `2.1.21` | `v1.43` / `1.79.0` | release SBF; `cargo build-sbf --manifest-path programs/escrow_v3/Cargo.toml --sbf-out-dir target/deploy` | SHA-256 `21dda9b5b0f95aba7f2560d58f2085de7ef8d0c9f1e3ac79f8ee506dcb9c6cf4`; `289216` bytes; `EM_BPF` | **No** |
| AgentFolio `f25b9c2` | Cargo `1.86.0`; rustc `1.86.0` | CLI and `anchor-lang` `0.31.1` | Solana CLI / `solana-cargo-build-sbf` `2.1.21` | `v1.52` / `1.89.0` | release SBF; `cargo build-sbf --force-tools-install --tools-version v1.52 --manifest-path programs/escrow_v3/Cargo.toml --sbf-out-dir target/deploy` | SHA-256 `60f7fee84d640a0ff339011962bab3d866c5c27d6a1dad574798999838183d67`; `292336` bytes; `EM_SBF` | **No** |
| clawd-brainchain `27f38ff` | repository pins rust `1.89.0` | CLI and `anchor-lang` `1.0.0` | not recorded at the deployment commit | not recorded at the deployment commit | repository source and Cargo.lock inspected; no reproducible historical build environment is committed | No reproduced hash; the candidate remains explicitly hash-unverified | Not established |

The first AgentFolio build differs at ELF machine. The v1.52 build has the
correct `EM_SBF` format but differs at the ELF entry point, length, and hash.
Trying an unrecorded modern environment for `clawd-brainchain@27f38ff` would
produce a new candidate; it would not establish what produced the deployed
bytes. Its Cargo.lock SHA-256 is
`68d67c7eeadd99ab625c1bb86cdd8e5203648cdff4bc206b405ecc926dd6c6f2`.

## Conclusion

Known reproducible source/toolchain combinations do not produce the deployed
ELF. `clawd-brainchain@27f38ff` remains the strongest historical provenance
candidate but is hash-unverified because its deployment build environment and
output were not preserved. The current AgentFolio source is an undeployed
fork. Therefore source == deployed == IDL is not certified, while the deployed
program/ProgramData/ELF tuple above is the canonical runtime truth. This record
does not authorize a redeploy.
