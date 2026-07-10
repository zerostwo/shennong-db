# ShennongDB unified data model

## Boundary

ShennongDB stores, versions, authorizes, discovers, and reads bioinformatics data. It does not run
scientific workflows or expose agent/compute APIs. Keeping this boundary makes storage durable and
lets R, Python, web, or future analysis systems share the same data contract.

## Two-level model

### Dataset version

A dataset version owns publication-level metadata:

- `dataset_id` and immutable `version`;
- `data_model`: `bulk`, `clinical`, `qtl`, `single_cell`, `spatial`, `table`, `reference`, or
  `resource`;
- `visibility`: `public` or `private`;
- lifecycle status, citation, schema version, and domain metadata;
- one manifest containing every physical asset.

New files or corrected metadata produce a new version when they change the scientific release.
Purely reproducible performance derivatives may be added to the same version and point to their
source through `derived_from`.

### Asset

An asset is one stored object with these stable fields:

| Field | Meaning |
| --- | --- |
| `role` | Semantic purpose within the dataset, such as `matrix` or `embedding.umap` |
| `kind` | Broad class: matrix, metadata, embedding, reference, index, annotation, database, table, archive, other |
| `format` | Physical encoding such as h5ad, 10x_h5, feather, parquet, fasta, gtf, sqlite, tsv |
| `storage_uri` | Server-only path; never returned by public catalog APIs |
| `compression` | gzip/bgz/etc. when applicable |
| `checksum`, `size_bytes` | Integrity and operational metadata |
| `derived_from` | Role of the source asset when this is an index or optimized derivative |

Roles use dotted namespaces where a dataset can contain repeated families: `embedding.umap`,
`embedding.pca`, `image.hires`, `index.star.genome`, `index.bwa.amb`. Unknown roles remain valid,
so new bioinformatics formats do not require a database migration.

## Standard profiles

### Bulk expression

- required: `matrix` or `expression`;
- common: `phenotype`, `sample_metadata`, `gene_map`;
- optimized Xena form: uncompressed tab-delimited matrix plus `index.expression`.

### Single-cell and spatial

- matrix container: `matrix` (`h5ad`, `10x_h5`, or SOMA);
- cell/observation metadata: `obs` or `cell_metadata`;
- feature metadata: `var`;
- embeddings: one asset per coordinate system, for example `embedding.umap` and
  `embedding.spatial`;
- optional images and coordinates use `image.*` and `coordinates`.

An H5AD may contain several logical components internally. It can remain one matrix asset while
the manifest metadata records internal keys. Separately supplied metadata or embeddings become
independent assets. This avoids duplicating large containers but preserves explicit discovery.

### Reference genome

- `reference.fasta`;
- `annotation.gtf` or `annotation.gff3`;
- indexes such as `index.fai`, `index.dict`, `index.bwa.*`, `index.star.*`, or
  `index.cellranger`;
- metadata records organism, assembly, source release, contig convention, and annotation release.

Different tool indexes are derivatives of the same FASTA/annotation and can coexist in one version.

### Reusable resources

TF databases, motif collections, CellPhoneDB, pathway sets, and similar resources use the generic
`resource` model. Their roles are `data`, `database`, `metadata`, `documentation`, and `index.*`.
Feather, Parquet, SQLite, TSV, JSON, and archives are physical formats rather than new dataset
types.

## Access rules

Catalog listing, detail, manifest, asset download, field discovery, and `/query` all apply the same
dataset-level read decision:

```text
public -> everyone
private -> administrator or explicitly granted active user
otherwise -> 404
```

Permissions attach to `dataset_id`, so an authorized researcher can follow approved versions. If a
release needs a separate audience, publish it under a separate dataset identity.

## Ingestion state machine

```text
upload/path registration -> identify format -> validate profile -> preserve source
                         -> create safe derivative/index when supported
                         -> register dataset version and assets -> ready
```

Ingestion never silently replaces the original. Optimized objects are written under the persistent
data root, registered as derived assets, and can be rebuilt. Xena gzip decompression plus row-offset
indexing is the first implemented optimizer. Future optimizers should follow the same rule for
bgzip/tabix, FASTA indexes, Parquet partitioning, or SOMA conversion.

## Client contract

Clients discover the dataset, choose a version, inspect its manifest, then either download a named
asset or use `/query` for a supported lazy backend. The manifest is the universal fallback: a new
format can be stored and served immediately even before a specialized query adapter exists.
