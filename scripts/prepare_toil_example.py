from __future__ import annotations

import csv
import gzip
import json
from pathlib import Path

SOURCE_ROOT = Path("/home/duansq/refs/public_datasets/tcga_gtex/Xena_TCGA_TARGET_GTEx_TOIL")
RAW = SOURCE_ROOT / "raw"
OUT = Path("data/toil_example")

DATASET_VERSION = "2026.07.example"
EXPRESSION_DATASET = "toil_tcga_gtex_expression_example"
SURVIVAL_DATASET = "toil_tcga_survival_example"
TARGET_CANCER = "LGG"
TARGET_GENES = ["IDH1", "TP53", "EGFR", "VEGFA", "GAPDH"]
MAX_SAMPLES = 40


def read_matrix_samples(matrix_path: Path) -> list[str]:
    with gzip.open(matrix_path, "rt", encoding="utf-8", newline="") as handle:
        header = handle.readline().rstrip("\n").split("\t")
    return header[1:]


def read_probemap(path: Path, target_genes: set[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            gene = row["gene"]
            if gene in target_genes:
                mapping[row["id"]] = gene
    missing = sorted(target_genes - set(mapping.values()))
    if missing:
        raise RuntimeError(f"Missing target genes in probemap: {', '.join(missing)}")
    return mapping


def read_phenotype(path: Path) -> dict[str, dict[str, str]]:
    with gzip.open(path, "rt", encoding="latin-1", newline="") as handle:
        return {row["sample"]: row for row in csv.DictReader(handle, delimiter="\t")}


def read_survival(path: Path, matrix_samples: set[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            if row["sample"] not in matrix_samples:
                continue
            if row["cancer type abbreviation"] != TARGET_CANCER:
                continue
            if row["OS"] == "" or row["OS.time"] == "":
                continue
            rows.append(row)
            if len(rows) >= MAX_SAMPLES:
                break
    if not rows:
        raise RuntimeError(f"No {TARGET_CANCER} survival rows overlap the expression matrix")
    return rows


def write_expression(
    matrix_path: Path,
    gene_id_to_symbol: dict[str, str],
    selected_samples: list[str],
    phenotype: dict[str, dict[str, str]],
    survival_by_sample: dict[str, dict[str, str]],
) -> int:
    out_path = OUT / "expression_bulk.csv"
    sample_set = set(selected_samples)
    written = 0
    with gzip.open(matrix_path, "rt", encoding="utf-8", newline="") as matrix, out_path.open(
        "w",
        encoding="utf-8",
        newline="",
    ) as out:
        reader = csv.reader(matrix, delimiter="\t")
        header = next(reader)
        sample_indices = [
            (idx, sample_id)
            for idx, sample_id in enumerate(header[1:], start=1)
            if sample_id in sample_set
        ]
        writer = csv.DictWriter(
            out,
            fieldnames=[
                "dataset",
                "version",
                "sample_id",
                "gene_symbol",
                "cancer",
                "group_name",
                "value",
            ],
        )
        writer.writeheader()
        found_genes: set[str] = set()
        for row in reader:
            gene_symbol = gene_id_to_symbol.get(row[0])
            if gene_symbol is None:
                continue
            found_genes.add(gene_symbol)
            for idx, sample_id in sample_indices:
                pheno = phenotype.get(sample_id, {})
                survival = survival_by_sample[sample_id]
                writer.writerow(
                    {
                        "dataset": EXPRESSION_DATASET,
                        "version": DATASET_VERSION,
                        "sample_id": sample_id,
                        "gene_symbol": gene_symbol,
                        "cancer": survival["cancer type abbreviation"],
                        "group_name": pheno.get("_sample_type") or pheno.get("_study") or "unknown",
                        "value": row[idx],
                    }
                )
                written += 1
            if found_genes == set(gene_id_to_symbol.values()):
                break
    return written


def write_survival(
    selected_rows: list[dict[str, str]],
    phenotype: dict[str, dict[str, str]],
) -> int:
    out_path = OUT / "survival_events.csv"
    with out_path.open("w", encoding="utf-8", newline="") as out:
        writer = csv.DictWriter(
            out,
            fieldnames=[
                "dataset",
                "version",
                "sample_id",
                "cancer",
                "time",
                "event",
                "group_name",
                "covariates",
            ],
        )
        writer.writeheader()
        for row in selected_rows:
            pheno = phenotype.get(row["sample"], {})
            writer.writerow(
                {
                    "dataset": SURVIVAL_DATASET,
                    "version": DATASET_VERSION,
                    "sample_id": row["sample"],
                    "cancer": row["cancer type abbreviation"],
                    "time": row["OS.time"],
                    "event": row["OS"],
                    "group_name": pheno.get("_sample_type") or "unknown",
                    "covariates": json.dumps(
                        {
                            "age": row.get("age_at_initial_pathologic_diagnosis"),
                            "gender": row.get("gender"),
                            "race": row.get("race"),
                        },
                        separators=(",", ":"),
                    ),
                }
            )
    return len(selected_rows)


def write_manifest(path: Path, dataset_id: str, dataset_type: str, source_file: Path) -> None:
    payload = {
        "dataset": {
            "dataset_id": dataset_id,
            "type": dataset_type,
            "backend": "clickhouse",
            "version": DATASET_VERSION,
            "citation": "UCSC Xena TCGA TARGET GTEx Toil example slice",
            "storage_uri": str(source_file),
            "status": "active",
            "is_default": True,
            "schema_version": "1.0",
            "metadata": {
                "source_root": str(SOURCE_ROOT),
                "example": True,
                "cancer": TARGET_CANCER,
                "genes": TARGET_GENES if dataset_type == "bulk_expression" else [],
            },
        },
        "source_uri": str(source_file),
        "format": "csv",
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    matrix_path = RAW / "TcgaTargetGtex_rsem_gene_tpm.gz"
    matrix_samples = read_matrix_samples(matrix_path)
    phenotype = read_phenotype(RAW / "TcgaTargetGTEX_phenotype.txt.gz")
    survival_rows = read_survival(
        RAW / "Survival_SupplementalTable_S1_20171025_xena_sp",
        set(matrix_samples),
    )
    selected_samples = [row["sample"] for row in survival_rows]
    survival_by_sample = {row["sample"]: row for row in survival_rows}
    gene_id_to_symbol = read_probemap(
        RAW / "gencode.v23.annotation.gene.probemap",
        set(TARGET_GENES),
    )
    expression_rows = write_expression(
        matrix_path,
        gene_id_to_symbol,
        selected_samples,
        phenotype,
        survival_by_sample,
    )
    survival_count = write_survival(survival_rows, phenotype)
    write_manifest(
        OUT / "expression_manifest.json",
        EXPRESSION_DATASET,
        "bulk_expression",
        OUT / "expression_bulk.csv",
    )
    write_manifest(
        OUT / "survival_manifest.json",
        SURVIVAL_DATASET,
        "survival",
        OUT / "survival_events.csv",
    )
    print(f"wrote {expression_rows} expression rows for {len(selected_samples)} samples")
    print(f"wrote {survival_count} survival rows")
    print(f"output: {OUT.resolve()}")


if __name__ == "__main__":
    main()
