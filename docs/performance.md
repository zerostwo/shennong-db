# Query Performance and Analysis Readiness

## Production measurements

Measured on 2026-07-11 against `http://192.168.3.10:18080` after installing the
complete built-in Toil provider. These are warm single-request latency
measurements, not throughput or concurrency guarantees.

| Request | Backend path | Observed latency |
|---|---|---:|
| Toil YTHDF2, SKCM primary tumor, 102 rows | indexed TSV plus phenotype join | 379 ms |
| Toil YTHDF2, SKCM survival, 470 rows | indexed TSV plus phenotype and survival joins | 370 ms |
| PBMC3K YTHDF2, 360 non-zero cells | TileDB sparse array | 139 ms |

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
| Compare YTHDF2 tumor vs adjacent normal within selected cancers | Ready | Toil phenotype provides disease and sample type |
| Join TCGA expression to OS, DSS, DFI, and PFI | Ready | Toil survival metadata is installed |
| Retrieve YTHDF2 counts for individual PBMC3K cells | Ready | sparse expression matrix and barcodes are installed |
| Summarize YTHDF2 by PBMC3K cell type | Not ready | cell-type annotations are not installed |

The API accepts only context fields declared by the selected Resource. PBMC3K
still has no cell-type labels, so it supports per-cell expression but does not
pretend that a cell-type summary is available.

## What is needed for melanoma CAR-T target discovery

A defensible workflow needs Resources for:

1. melanoma single-cell expression with cell-type and malignant-cell labels;
2. the installed Toil TCGA-SKCM expression, phenotype, and survival data;
3. the installed Toil GTEx tissue expression for normal-tissue safety screening;
4. OpenTargets evidence and target tractability;
5. optional surface-protein or cell-surface annotation evidence.

Once installed, these Resources appear in the first-level catalog. Their detail
documents tell the agent which analyses are ready and which additional inputs
are still required.
