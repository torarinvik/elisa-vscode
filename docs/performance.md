# Performance harness and recorded baseline

Run the harness with:

```sh
npm run bench
```

It prints JSON with machine metadata, grammar tokenization timings, scaling samples, and
discovery resolution timings. All numbers below are a **single-machine baseline**, not a
promise. Re-measure on a named reference machine before gating changes.

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
