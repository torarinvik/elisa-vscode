# Performance harness and recorded baseline

Run the harness with:

```sh
npm run bench
```

To retain a point-in-time JSON capture without overwriting an existing file:

```sh
npm run bench -- --out benchmarks/YYYY-MM-DD-machine.json
```

It prints JSON with machine metadata, grammar tokenization timings, scaling samples,
discovery resolution timings, and, when the sibling server binary is present, real
`initialize`/`semanticTokens/full`/`hover` round trips over stdio. All numbers below are
a **single-machine baseline**, not a promise. Re-measure on a named reference machine
before gating changes.

## Methodology

1. Record revision, platform, architecture, Node version, and build profile.
2. The harness records the first operation as `coldMs`, executes and reports an explicit
   warmup count, then computes p50/p95/p99/max, sample count, mean, and population standard
   deviation over measured warm samples. Percentiles use the nearest-rank definition.
   `coldMs` means the first operation for that workload after harness initialization; it
   does not claim cold machine caches. Process-start samples remain genuinely cold and are
   summarized separately because each sample creates a new process. Historical captures
   predate this stricter schema and must not be compared as if they had the same warmup
   protocol.
3. Tokenization uses the real `vscode-textmate` + Oniguruma engine with the packaged
   grammar, exactly as VS Code does.
   The `markdownFenceGrammar` section separately tokenizes complete Markdown documents
   containing Elisa fences. Set `VSCODE_MARKDOWN_GRAMMAR` to the host's Markdown grammar
   path to measure that editor version; otherwise the harness reports its small test-host
   fixture explicitly.
4. Discovery runs the real `resolveServer` path with `node:fs` stat probes against a
   temporary workspace containing an executable `build/elisa-lsp`.
5. Scaling samples grow the synthetic source at roughly `N`, `2N`, and `4N` to expose
   accidental superlinear behavior.
6. Server measurements validate the sibling manifest and artifact/input fingerprints,
   require a release-profile server, complete the LSP `initialize`/`initialized`
   handshake, and report process-start/initialize samples separately. Debug builds may
   still be used for functional tests, but they are excluded from server performance
   samples. Each measured server is shut down through the protocol and required to exit
   successfully. The binary and LSP/compiler source fingerprints are rechecked after the
   measurement sequence; if the build or sources change mid-run, the capture is discarded.
   After `didOpen`, the harness polls private analysis counters until exactly one
   tokenize/parse/check pass is observed, reporting the end-to-end observed analysis-ready
   time and polling interval. It then reports first request latency separately, applies
   explicit provider warmups, and measures warm round trips. It fails if provider requests
   trigger another analysis pass. Source mismatches remain fail-closed and are labeled in
   the report.

Each new capture records source-tree cleanliness without exposing changed file paths,
CPU model/count, fixture SHA-256 values, and exact server/compiler provenance. Editor
version and power mode are recorded only when explicitly provided through
`VSCODE_VERSION` and `ELISA_BENCH_POWER_MODE`; otherwise they are marked unavailable, not
inferred. The extension revision and dirty-state digest are checked again at the end; a
changed plugin worktree also invalidates the run. The CLI harness is not an
extension-host activation measurement.

Raw captures are stored under `benchmarks/` with the date and platform in the name.

## Recorded baseline (2026-09-12)

Machine: macOS 26.6.2, Darwin arm64, Node v26.8.2, revision `3f49f88`, release bundle.

| Measurement | Samples | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| Small enum fixture, full tokenization (ms) | 200 | 0.079 | 0.665 | 1.942 | 26.4 |
| Discovery resolution, warm workspace (ms) | 50 | 0.149 | 0.573 | 3.339 | 3.34 |
| 2,500-line synthetic source, tokenization (ms) | 20 | 69.4 | 159.7 | 309.0 | 309.0 |
| 5,000-line synthetic source, tokenization (ms) | 20 | 131.5 | 183.9 | 190.0 | 190.0 |
| 10,000-line synthetic source, tokenization (ms) | 20 | 185.1 | 303.8 | 414.8 | 414.8 |

Scaling from 2,500 to 10,000 lines (4×) grows the p50 by roughly 2.7× on this machine, so
the grammar shows no obvious quadratic blowup on this synthetic shape. Adversarial line
shapes are covered by `test/hostile-inputs.test.mjs`; they assert bounded completion, not
throughput.

## Server round trips (2026-09-12, capture artifact)

Source: `benchmarks/2026-09-12-macos-arm64.json`, sibling `Elisa-LSP` build, release
`-O2`, 750-line synthetic document.

| Measurement | Samples | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| Warm `initialize` round trip (ms) | 5 | 11.2 | 42.3 | 42.3 | 42.3 |
| `semanticTokens/full` round trip (ms) | 30 | 3.1 | 10.7 | 966.8 | 966.8 |
| `hover` round trip (ms) | 30 | 2.7 | 6.3 | 8.0 | 8.0 |

The semantic-token tail includes the first request that triggers document analysis; later
requests are sub-10 ms. These are client-observed round trips, not isolated server time,
and they were captured while unrelated sibling-repository test jobs were running on the
same machine. Treat them as an order-of-magnitude baseline only. A named idle reference
machine is required before gating.

## Load sensitivity

The two captured runs on this machine differ materially in the grammar scaling rows
(for example the 10,000-line p50 moved from 185 ms to 666 ms between an idle run and a
loaded run). That difference is CPU contention from concurrent repository test jobs, not
a code change. This is exactly why the plan requires controlled runners and separate
cold/warm samples; do not accept or reject a change from a single noisy capture.

## What is not measured yet

- Extension activation and extension-host stalls: requires an extension-host profile
  with the packaged VSIX.
- Visible response latency for hover, completion, and diagnostics: owned by the server
  and measured through LSP spans once those features exist.
- Memory, leak, and soak growth: the soak suite proves timer/lifecycle hygiene, not heap
  retention across editor sessions.
- Remote hosts: no supported host harness yet.

Do not quietly redefine a metric to exclude the expensive part. If a target proves
unrealistic, record the evidence, bottleneck, tradeoff, and replacement target.

## Revalidation sample (2026-09-13)

Capture: `benchmarks/2026-09-13-macos-arm64.json`; extension HEAD `bdbab60` with a dirty
worktree, macOS arm64, Node v26.8.2. This is one observational run, not a regression gate.
At capture time the source-freshness check reported that the server binary matched both
Elisa-LSP and Elisa-compiler input trees. The LSP has since been rebuilt and further
changed; these server measurements belong only to the earlier `20:00:14Z` binary below,
not the current tested binary.

| Measurement | Samples | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| Small enum fixture, full tokenization (ms) | 200 | 0.036 | 0.111 | 0.228 | 7.101 |
| Discovery resolution, warm workspace (ms) | 50 | 0.068 | 0.151 | 1.041 | 1.041 |
| 2,500-line synthetic source, tokenization (ms) | 20 | 19.832 | 27.703 | 28.075 | 28.075 |
| 5,000-line synthetic source, tokenization (ms) | 20 | 40.377 | 45.949 | 46.106 | 46.106 |
| 10,000-line synthetic source, tokenization (ms) | 20 | 85.936 | 91.402 | 92.602 | 92.602 |

The 2,500-to-10,000-line grammar p50 grows 4.33× for 4× input, close to linear in this
synthetic shape. That is a useful scaling signal, not proof of viewport/editing latency;
same-day captures vary with machine load. The server's warm p50/p95/p99 round trips were
1.423/2.325/2.325 ms for initialize, 0.239/0.328/0.343 ms for semantic tokens, and
0.177/0.205/0.287 ms for hover. In this capture, the private server counters were unchanged
after didOpen, 30 semantic-token requests, and 30 hover requests: one tokenize/parse/check,
one symbol index build, one occurrence index build, and 5,145 adapter queries total. This
supports that these providers reuse the retained analysis for this workload; it is not a
general proof for all edit/provider sequences.

The release server was built at `2026-09-13T20:00:14Z`, profile `-O2`. Its binary SHA-256
is `11fb8f509c3a0e8b48baa5ffcb6e5c0e44f865e0341f1e1f637790d07507a621`, LSP input
fingerprint `3ded4b726bf3e9e45f33ee4b4f156fd4de75821dbacd4f9cf63f02a8fb784ffd`, and
compiler-source fingerprint
`7b5729b5341eeef652a9b63ff0a47562afdef0baf14f160d595ac949717a2f0b`. That matching
snapshot passed 44 LSP checks and 88 extension tests. The capture is observational evidence
only; it does not replace controlled repeat runs or the pending extension-host and
visual-theme checks. The latest tested release was built at `2026-09-13T20:15:53Z` with
artifact SHA-256 `da15ffa5739d1871814361061dbe20b203f280ad149adf875cb9ec1e4b9cffb3` and LSP
input fingerprint `cf5df770ffae02a77b4d5e60719e591968ec5406102e745d61a82a5947a9b884`. Its
performance has not been measured; do not carry the earlier latency rows forward.

## Fresh actual-compiler snapshot (2026-09-14)

Raw capture: `benchmarks/2026-09-14-macos-arm64.json`. This run followed the fresh LSP
build from clean Elisa-compiler commit `9791a8e1cd924bb03e43cb46da2d3530b4c9fbb0`,
after the canonical LSP suite and extension tests completed. The benchmark independently
reported that the built server matched the live LSP and compiler source fingerprints.
Machine: macOS Darwin arm64, Node v26.8.2, extension revision `bdbab60`, release profile.

| Measurement | Samples | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small enum fixture, full tokenization (ms) | 200 | 0.049 | 0.150 | 0.659 | 11.794 |
| Warm discovery resolution (ms) | 50 | 0.102 | 0.294 | 3.716 | 3.716 |
| 2,500-line synthetic source, tokenization (ms) | 20 | 27.994 | 42.380 | 44.652 | 44.652 |
| 5,000-line synthetic source, tokenization (ms) | 20 | 59.512 | 65.006 | 66.382 | 66.382 |
| 10,000-line synthetic source, tokenization (ms) | 20 | 124.485 | 151.870 | 162.092 | 162.092 |
| Process start + `initialize` (ms) | 5 | 2.205 | 3.626 | 3.626 | 3.626 |
| `semanticTokens/full`, 750-line document (ms) | 30 | 0.238 | 0.331 | 0.399 | 0.399 |
| `hover`, 750-line document (ms) | 30 | 0.111 | 0.185 | 0.200 | 0.200 |

The grammar p50 rises 4.45× when the synthetic source grows 4× from 2,500 to 10,000
lines. This one-run scaling signal is close to linear, not a CI performance gate. The
server counters recorded one tokenize/parse/check and one symbol/occurrence-index build
after opening the document; after 30 token and 30 hover requests they remained unchanged.
The 750-line analysis recorded 65,447 adapter queries; the benchmark does not isolate
their cost, so use a profile before inferring whether this count is a bottleneck. The
measured warm provider latency is not a substitute for analysis-completion latency,
large-workspace behavior, or tail-latency sampling under controlled load.

On this exact source snapshot, `bash ../Elisa-LSP/test/run_all.sh` reports **54 passed,
0 failed**, and `npm test` reports **88 passed, 0 failed, 0 skipped**. The extension-host
integration and actual theme rendering remain unverified. Earlier snapshot tables above
remain historical and must not be used as measurements for this build.

## Markdown fence grammar benchmark (2026-09-14)

Raw capture: `benchmarks/2026-09-14-markdown-fences-macos-arm64.json`. This uses the
installed VS Code 1.137.0 Markdown grammar with the Elisa injection, macOS arm64, Node
v26.8.2, 20 samples per size, and extension revision `bdbab60`. The Markdown document
contains one `elisa` fence plus synthetic Elisa source; p50/p95/p99 are:

| Total Markdown lines | p50 (ms) | p95 (ms) | p99 (ms) |
| ---: | ---: | ---: | ---: |
| 1,254 | 12.894 | 14.643 | 20.430 |
| 2,504 | 26.186 | 28.616 | 29.234 |
| 5,004 | 52.775 | 58.972 | 59.011 |

The p50 grows about 4.09× for 3.99× as many lines in this single run. Treat that as a
near-linear scaling observation, not an editor-latency guarantee or a release gate. Server
measurements were deliberately skipped because the current LSP binary's fingerprints do
not match the live LSP and compiler source trees; the capture records the mismatch rather
than running a stale executable.
