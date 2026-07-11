# Query Performance and Analysis Readiness

## Production measurements

Measured on 2026-07-11 against `http://192.168.3.10:18080` with a response
limit of 100 rows. These are single-request latency measurements, not throughput
or concurrency guarantees.

| Request | Backend path | Observed latency |
|---|---|---:|
| First Toil YTHDF2 request | indexed TSV, then ClickHouse fill for 19,131 samples | 512 ms |
| Repeated Toil YTHDF2 request | ClickHouse | 5-6 ms steady state |
| PBMC3K YTHDF2 request | TileDB sparse array | 123-168 ms, 133 ms median |

The Toil query used `ENSG00000198492.14`. The PBMC3K query used the `YTHDF2`
symbol and resolved to `ENSG00000198492.16`.

Run the same bounded checks with:

```bash
./scripts/benchmark.sh http://192.168.3.10:18080
```

## What the current data can answer

| Analysis request | Current status | Reason |
|---|---|---|
| Retrieve YTHDF2 expression for raw Toil sample IDs | Ready | expression matrix and row index are installed |
| Compare YTHDF2 tumor vs adjacent normal within selected cancers | Not ready | cancer-project and sample-type annotations are not installed |
| Run survival analysis | Not ready | clinical follow-up, survival time, and event data are not installed |
| Retrieve YTHDF2 counts for individual PBMC3K cells | Ready | sparse expression matrix and barcodes are installed |
| Summarize YTHDF2 by PBMC3K cell type | Not ready | cell-type annotations are not installed |

The API rejects non-empty `context` filters while these annotations are absent.
Returning an explicit error is safer than returning an unfiltered expression
vector that an agent could misinterpret.

## What is needed for melanoma CAR-T target discovery

A defensible workflow needs Resources for:

1. melanoma single-cell expression with cell-type and malignant-cell labels;
2. TCGA-SKCM sample, clinical, survival, and tumor/normal metadata;
3. GTEx tissue annotations for normal-tissue safety screening;
4. OpenTargets evidence and target tractability;
5. optional surface-protein or cell-surface annotation evidence.

Once installed, these Resources appear in the first-level catalog. Their detail
documents tell the agent which analyses are ready and which additional inputs
are still required.
