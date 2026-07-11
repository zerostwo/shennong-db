# Gene Identifier Coordination

ShennongDB never joins expression datasets by gene symbol alone. Symbols are
display names and aliases; they can be renamed, reused, or mapped to multiple
features between annotation releases.

## Identity model

Each Resource declares:

- genome assembly;
- gene annotation source and release;
- original feature identifier type;
- canonical cross-dataset key.

The canonical key for the current human expression Resources is the Ensembl
gene stable ID without its version suffix. Original IDs and annotation releases
are always retained.

Example:

| Resource | Annotation | Original ID | Canonical key | Symbol |
|---|---|---|---|---|
| Toil | GENCODE v23 | `ENSG00000198492.14` | `ENSG00000198492` | YTHDF2 |
| PBMC3K | GENCODE v37 | `ENSG00000198492.16` | `ENSG00000198492` | YTHDF2 |

Resolve across installed Resources with:

```bash
curl -sS 'http://127.0.0.1:8000/api/v1/genes/resolve?q=YTHDF2&resources=toil,pbmc-3k' | jq
```

The response reports each Resource's original ID, stable ID, symbol, assembly,
and annotation release. Status is `resolved`, `ambiguous`, or `missing`.

## Cross-dataset rules

1. Resolve the input separately against every selected Resource.
2. Join only matches sharing one unambiguous stable Ensembl gene ID.
3. Keep original versioned IDs in all results and provenance.
4. Use gene symbols for display and search, never as the join key.
5. Treat missing, retired, split, merged, or one-to-many mappings as not directly
   comparable until an explicit mapping policy is supplied.
6. Compare measurements only after checking units and transformations; identifier
   agreement does not make TPM, counts, or normalized values interchangeable.

Removing the version suffix coordinates gene identity, not feature definition.
GENCODE releases can change exon boundaries, gene biotypes, and which genes are
present, so the API exposes both the stable key and release-specific IDs.
