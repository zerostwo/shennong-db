export const resources = [
  ["Toil RNA-seq (Homo sapiens)", "toil", "Resource", "Public", "TileDB", "canonical"],
  ["PBMC 3K TileDB filtered", "pbmc-3k", "Resource", "Private", "TileDB", "derived"],
  ["TCGA survival metadata", "tcga-survival", "Resource", "Public", "PostgreSQL", "canonical"],
  ["GENCODE v44 gene map", "gencode-v44", "Artifact", "Public", "ClickHouse", "canonical"],
  ["S3 raw bucket · WGS reads", "wgs-raw", "Artifact", "Private", "S3", "raw"]
] as const;

export const users = [
  ["Dr. Maya Chen", "maya.chen@shennong.org", "Admin", "Active", "18", "3", "2 min ago"],
  ["Elias Morgan", "elias@genomics.org", "User", "Active", "7", "2", "1 hour ago"],
  ["Priya Raman", "priya@biolab.edu", "User", "Active", "4", "1", "Yesterday"],
  ["Noah Williams", "noah@research.net", "User", "Disabled", "0", "0", "May 18"]
] as const;

export const grants = [
  ["Elias Morgan", "PBMC 3K TileDB filtered", "resource.read, query.execute", "Dr. Maya Chen", "2026-06-12", "Never"],
  ["Priya Raman", "S3 raw bucket · WGS reads", "artifact.download", "Dr. Maya Chen", "2026-07-01", "2026-10-01"]
] as const;

export const audit = [
  ["2026-07-12 08:42", "maya.chen", "grant.create", "pbmc-3k", "Success", "192.168.3.18"],
  ["2026-07-12 08:31", "elias", "resource.query", "toil", "Success", "10.24.1.5"],
  ["2026-07-12 08:12", "anonymous", "artifact.download", "wgs-raw", "Denied", "203.0.113.14"]
] as const;

export const jobs = [
  ["ing-7842", "PBMC snapshot 2024-05-12", "Cell Ranger", "materializing", "72%", "12 min", "worker-03"],
  ["ing-7839", "GENCODE v44 gene map", "GENCODE", "available", "100%", "8 min", "worker-01"],
  ["ing-7831", "TCGA clinical → survival", "TCGA", "failed", "48%", "4 min", "worker-02"]
] as const;
