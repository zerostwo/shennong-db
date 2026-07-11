export type ResourceVisibility = "Public" | "Private";
export type ResourceKind = "Resource" | "Artifact" | "Relation";

export type ResourceRecord = {
  id: string;
  name: string;
  kind: ResourceKind;
  visibility: ResourceVisibility;
  backend: string;
  updated: string;
  usage: string;
  dataClass: "raw" | "canonical" | "derived" | "cache";
  description: string;
  owner: string;
  organism: string;
  checksum: string;
  source: string;
  provenance: string;
  size: string;
};

export const resources: ResourceRecord[] = [
  { id: "res_01J6ZSX4Q6RX7X9JRV2Y0HMN2N3P", name: "Toil RNA-seq (Homo sapiens)", kind: "Resource", visibility: "Public", backend: "TileDB Cloud", updated: "2 hours ago", usage: "1.2K", dataClass: "canonical", description: "Normalized RNA-seq expression (TPM) for Toil collection across human samples.", owner: "bioinfo@demo.org", organism: "Homo sapiens", checksum: "a3b7c5d5e9f12c9c6b1a2f3a4b5c6d7e", source: "s3://toil-rnaseq/processed/v2.1.0/", provenance: "ingest: toil-rnaseq-pipeline v2.1.0", size: "2.34 TB" },
  { id: "res_0JTCsNNI26Be2dVJ3S8T1NBOD4HKK", name: "PBMC 3K TileDB filtered", kind: "Resource", visibility: "Private", backend: "TileDB Cloud", updated: "1 day ago", usage: "342", dataClass: "derived", description: "Filtered PBMC 3K single-cell matrix with cell-level metadata.", owner: "researcher@demo.org", organism: "Homo sapiens", checksum: "c4d0a1b16e9a51d7b7dd1ef70bb4f5c2", source: "s3://pbmc-3k/filtered/", provenance: "ingest: pbmc-cellranger v7.2", size: "18.7 GB" },
  { id: "res_01J47TTA2AWVS0F6PL3H1KT2Q3Q", name: "TCGA survival metadata", kind: "Resource", visibility: "Public", backend: "PostgreSQL", updated: "3 days ago", usage: "980", dataClass: "canonical", description: "Curated TCGA clinical and survival metadata joined by patient identifier.", owner: "clinical@demo.org", organism: "Homo sapiens", checksum: "d8ee9a4f20b68067a6b7e31a5f8ed55a", source: "s3://tcga-clinical/survival/v4/", provenance: "ingest: tcga-clinical-normalizer v4.0", size: "6.8 GB" },
  { id: "res_01J33DE1B4FDRBGON2JLL4MSN", name: "GENCODE v44 gene map", kind: "Resource", visibility: "Public", backend: "S3", updated: "5 days ago", usage: "2.7K", dataClass: "canonical", description: "Gene, transcript, and stable identifier mapping from GENCODE release 44.", owner: "genomics@demo.org", organism: "Homo sapiens", checksum: "f7c0a2b4d9c3a1e55a7dd492d8bfe611", source: "s3://reference/gencode/v44/", provenance: "provider: gencode v44", size: "2.1 GB" },
  { id: "res_01Q2JSRW8V8C37D6P6GQ2H4J", name: "S3 raw bucket · WGS reads", kind: "Resource", visibility: "Private", backend: "AWS S3", updated: "7 days ago", usage: "156", dataClass: "raw", description: "Raw sequencing reads retained for reproducible WGS processing.", owner: "data-steward@demo.org", organism: "Homo sapiens", checksum: "9014a4e1ddf917e3debc56f3dbe09b3a", source: "s3://shennong-raw/wgs/", provenance: "upload: multipart-2025-05-12", size: "146.2 TB" },
  { id: "art_01J6ZSX4Q6RX7X9JRV2Y0HMN2N3P_v1", name: "Toil RNA-seq (Homo sapiens) v1", kind: "Artifact", visibility: "Public", backend: "TileDB Cloud", updated: "2 hours ago", usage: "1.2K", dataClass: "derived", description: "Versioned TileDB artifact for the Toil RNA-seq resource.", owner: "bioinfo@demo.org", organism: "Homo sapiens", checksum: "04e9a2cc40ee6b71ce58a6e82d39a2d3", source: "tiledb://tiledb-cloud/tiles/toil-rnaseq.b5", provenance: "derived from toil RNA-seq", size: "2.34 TB" },
  { id: "art_0JTCsNNI26Be2dVJ3S8T1NBOD4HKK_s1", name: "PBMC 3K TileDB filtered snapshot 2024-05-12", kind: "Artifact", visibility: "Private", backend: "TileDB Cloud", updated: "1 day ago", usage: "87", dataClass: "cache", description: "Immutable snapshot used by a PBMC 3K analysis workspace.", owner: "researcher@demo.org", organism: "Homo sapiens", checksum: "5b8c3d9a2c3ea2a6d5ecf67a9a9b1d03", source: "tiledb://tiledb-cloud/tiles/pbmc3k.b5", provenance: "snapshot: 2024-05-12", size: "4.3 GB" },
  { id: "rel_01J47TTA2AWVS0F6PL3H1KT2Q3Q_r1", name: "TCGA clinical → survival (view)", kind: "Relation", visibility: "Public", backend: "PostgreSQL", updated: "3 days ago", usage: "410", dataClass: "derived", description: "A relation exposing curated survival fields from TCGA clinical records.", owner: "clinical@demo.org", organism: "Homo sapiens", checksum: "relation:tcga-survival-v2", source: "postgres://catalog/relations/tcga", provenance: "relation: clinical → survival", size: "1.2 GB" },
  { id: "rel_01J33DE1B4FDRBGON2JLL4MSN_r1", name: "GENCODE gene ↔ transcript (contains)", kind: "Relation", visibility: "Public", backend: "S3", updated: "5 days ago", usage: "720", dataClass: "canonical", description: "Gene-to-transcript containment relation from GENCODE v44.", owner: "genomics@demo.org", organism: "Homo sapiens", checksum: "relation:gencode-v44", source: "s3://reference/gencode/v44/relations", provenance: "provider: gencode v44", size: "490 MB" },
  { id: "rel_01Q2JSRW8V8C37D6P6GQ2H4J_r1", name: "Sample → S3 raw bucket (stored_in)", kind: "Relation", visibility: "Private", backend: "AWS S3", updated: "7 days ago", usage: "33", dataClass: "raw", description: "Storage relation for WGS sample objects in the raw bucket.", owner: "data-steward@demo.org", organism: "Homo sapiens", checksum: "relation:wgs-raw-2025", source: "s3://shennong-raw/wgs/relations", provenance: "upload: multipart-2025-05-12", size: "92 MB" }
];

export const mockApi = {
  listResources: async () => resources,
  getResource: async (id: string) => resources.find((resource) => resource.id === id) ?? null
};
