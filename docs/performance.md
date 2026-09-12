# Performance harness and recorded baseline

Run the harness with:

```sh
npm run bench
```

It prints JSON with machine metadata, grammar tokenization timings, scaling samples,
discovery resolution timings, and, when the sibling server binary is present, real
`initialize`/`semanticTokens/full`/`hover` round trips over stdio. All numbers below are
a **single-machine baseline**, not a promise. Re-measure on a named reference machine
before gating changes.

## Methodology

1. Record revision, platform, architecture, Node version, and build profile.
2. Warm up by running each operation many times; report p50/p95/p99/max, sample count,
   and mean.
3. Tokenization uses the real `vscode-textmate` + Oniguruma engine with the packaged
   grammar, exactly as VS Code does.
4. Discovery runs the real `resolveServer` path with `node:fs` stat probes against a
   temporary workspace containing an executable `build/elisa-lsp`.
5. Scaling samples grow the synthetic source at roughly `N`, `2N`, and `4N` to expose
   accidental superlinear behavior.
6. Server measurements spawn the sibling `build/elisa-lsp`, complete `initialize`, open a
   synthetic document, then time per-request round trips on the warm process. The first
   semantic-token request also pays for analysis, which shows up in the tail.

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
