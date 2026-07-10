from pathlib import Path

from fastapi.testclient import TestClient

from shennong_db.config import Settings
from shennong_db.ingest.loaders import build_xena_matrix_index
from shennong_db.main import create_app

ADMIN_KEY = "test-admin-key"
ADMIN_HEADERS = {"X-Shennong-Admin-Key": ADMIN_KEY}


def make_client(local_data_root: str | None = None) -> TestClient:
    settings = Settings(
        environment="test",
        registry_backend="memory",
        redis_url=None,
        disable_external_backends=False,
        max_page_size=2,
        admin_api_key=ADMIN_KEY,
        docs_enabled=True,
        local_data_root=local_data_root or "/data/shennong",
    )
    return TestClient(create_app(settings=settings))


def register_dataset(client: TestClient, dataset_id: str, dataset_type: str) -> None:
    data_model = {
        "bulk_expression": "bulk",
        "survival": "clinical",
        "eqtl": "qtl",
        "single_cell": "single_cell",
        "spatial": "spatial",
    }[dataset_type]
    response = client.post(
        "/v1/ingest",
        headers=ADMIN_HEADERS,
        json={
            "dataset": dataset_id,
            "data_model": data_model,
            "backend": "memory",
            "version": "v1",
            "is_default": True,
            "citation": "unit test",
            "metadata": {
                "title": f"{dataset_id} title",
                "visibility": "public",
                "assays": ["rna"] if dataset_type == "bulk_expression" else [],
            },
        },
    )
    assert response.status_code == 200, response.text


def test_admin_routes_require_api_key() -> None:
    with make_client() as client:
        response = client.post(
            "/v1/ingest",
            json={
                "dataset": "blocked",
                "data_model": "bulk",
                "backend": "memory",
                "version": "v1",
            },
        )
        assert response.status_code == 401


def test_admin_access_bootstrap_project_token_and_audit() -> None:
    with make_client() as client:
        response = client.get("/v1/admin/users")
        assert response.status_code == 401

        response = client.post(
            "/v1/admin/bootstrap",
            headers=ADMIN_HEADERS,
            json={
                "user": {
                    "email": "curator@example.org",
                    "display_name": "Dataset Curator",
                    "is_superuser": True,
                },
                "organization": {
                    "slug": "demo-lab",
                    "name": "Demo Lab",
                },
            },
        )
        assert response.status_code == 201, response.text
        bootstrap = response.json()
        user_id = bootstrap["user"]["user_id"]
        org_id = bootstrap["organization"]["org_id"]
        assert bootstrap["membership"]["role"] == "owner"

        response = client.post(
            "/v1/admin/projects",
            headers=ADMIN_HEADERS,
            json={
                "org_id": org_id,
                "slug": "pan-cancer-tcells",
                "name": "Pan-cancer T cell atlas",
                "description": "Draft project for a public T cell atlas release.",
                "visibility": "private",
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["slug"] == "pan-cancer-tcells"

        response = client.post(
            "/v1/admin/api-tokens",
            headers=ADMIN_HEADERS,
            json={
                "user_id": user_id,
                "name": "R publishing token",
                "scopes": ["datasets:read", "datasets:write", "ingest:write"],
            },
        )
        assert response.status_code == 201, response.text
        token = response.json()
        assert token["token"].startswith("shn_")
        assert "token_hash" not in token["data"]
        assert token["data"]["scopes"] == ["datasets:read", "datasets:write", "ingest:write"]

        response = client.get("/v1/admin/users", headers=ADMIN_HEADERS)
        assert response.status_code == 200
        assert response.json()["users"][0]["email"] == "curator@example.org"

        response = client.get(f"/v1/admin/projects?org_id={org_id}", headers=ADMIN_HEADERS)
        assert response.status_code == 200
        assert response.json()["projects"][0]["org_id"] == org_id

        response = client.get("/v1/admin/audit-events", headers=ADMIN_HEADERS)
        assert response.status_code == 200
        actions = {event["action"] for event in response.json()["events"]}
        assert {"access.bootstrap", "project.upsert", "api_token.create"} <= actions


def test_health_and_dataset_registry() -> None:
    with make_client() as client:
        response = client.get("/v1/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

        register_dataset(client, "tcga_test", "bulk_expression")
        response = client.get("/v1/catalog/datasets")
        assert response.status_code == 200
        assert response.json()["data"][0]["dataset"] == "tcga_test"


def test_ingest_registers_dataset_version(tmp_path: Path) -> None:
    source = tmp_path / "toil" / "expression.tsv"
    source.parent.mkdir(parents=True)
    source.write_text("gene\tS1\n", encoding="utf-8")
    with make_client(local_data_root=str(tmp_path)) as client:
        response = client.post(
            "/v1/ingest",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "toil_ingest",
                "version": "v1",
                "data_model": "bulk",
                "backend": "xena",
                "source": {"expression": str(source)},
                "metadata": {"title": "Toil ingest"},
                "is_default": True,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "success"
        assert body["state"] == "completed"
        assert body["registered"] is True

        response = client.get("/v1/catalog/datasets/toil_ingest")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["dataset"] == "toil_ingest"


def test_ingest_validate_reports_queryable_and_metadata_only_states(tmp_path: Path) -> None:
    source = tmp_path / "toil" / "expression.tsv"
    source.parent.mkdir(parents=True)
    source.write_text("gene\tS1\nYTHDF2\t1.2\n", encoding="utf-8")
    with make_client(local_data_root=str(tmp_path)) as client:
        response = client.post(
            "/v1/ingest/validate",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "toil_validate",
                "version": "v1",
                "data_model": "bulk",
                "backend": "xena",
                "source": {"expression": str(source)},
                "metadata": {"title": "Validated Toil"},
            },
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["valid"] is True
        assert report["queryable"] is True
        assert report["dataset_type"] == "bulk_expression"
        assert report["storage_uri"] == str(source)
        assert report["present_source_roles"] == ["expression"]
        assert report["preview"]["columns"] == ["gene", "S1"]
        assert all(issue["level"] != "error" for issue in report["issues"])

        response = client.post(
            "/v1/ingest/validate",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "metadata_only",
                "version": "draft",
                "data_model": "bulk",
                "backend": "xena",
                "metadata": {"title": "Metadata only"},
            },
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["valid"] is True
        assert report["queryable"] is False
        assert report["issues"][0]["level"] == "warning"
        assert report["issues"][0]["field"] == "source"


def test_ingest_validate_checks_modality_specific_columns(tmp_path: Path) -> None:
    clinical = tmp_path / "clinical.csv"
    clinical.write_text("sample_id,time,event\nS1,120,1\n", encoding="utf-8")
    bad_clinical = tmp_path / "bad_clinical.csv"
    bad_clinical.write_text("sample_id,time\nS1,120\n", encoding="utf-8")
    qtl = tmp_path / "eqtl.csv"
    qtl.write_text(
        "gene_symbol,variant_id,tissue,phenotype,beta,se,pvalue,qvalue\n"
        "IDH1,rs1,brain,expression,0.2,0.01,0.001,0.01\n",
        encoding="utf-8",
    )
    with make_client(local_data_root=str(tmp_path)) as client:
        response = client.post(
            "/v1/ingest/validate",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "survival_validate",
                "version": "v1",
                "data_model": "clinical",
                "backend": "clickhouse",
                "source": {"survival": str(clinical)},
                "metadata": {"title": "Survival"},
            },
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["valid"] is True
        assert report["queryable"] is True
        assert report["dataset_type"] == "survival"
        assert report["preview"]["columns"] == ["sample_id", "time", "event"]

        response = client.post(
            "/v1/ingest/validate",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "bad_survival_validate",
                "version": "v1",
                "data_model": "clinical",
                "backend": "clickhouse",
                "source": {"survival": str(bad_clinical)},
                "metadata": {"title": "Bad survival"},
            },
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["valid"] is False
        assert report["queryable"] is False
        assert report["issues"][0]["field"] == "preview.columns"
        assert report["issues"][0]["details"]["missing"] == ["event"]

        response = client.post(
            "/v1/ingest/validate",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "eqtl_validate",
                "version": "v1",
                "data_model": "qtl",
                "backend": "clickhouse",
                "source": {"eqtl": str(qtl)},
                "metadata": {"title": "eQTL"},
            },
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["valid"] is True
        assert report["queryable"] is True
        assert report["dataset_type"] == "eqtl"
        assert report["preview"]["columns"] == [
            "gene_symbol",
            "variant_id",
            "tissue",
            "phenotype",
            "beta",
            "se",
            "pvalue",
            "qvalue",
        ]


def test_upload_validate_previews_file_without_registering_dataset(tmp_path: Path) -> None:
    with make_client(local_data_root=str(tmp_path)) as client:
        response = client.post(
            "/v1/ingest/upload/validate",
            headers=ADMIN_HEADERS,
            data={
                "dataset": "upload_preview_only",
                "version": "draft",
                "data_model": "bulk",
                "backend": "xena",
                "role": "matrix",
                "metadata_json": '{"title":"Upload preview only"}',
            },
            files={"file": ("matrix.tsv", b"gene\tS1\nYTHDF2\t1.2\n", "text/tab-separated-values")},
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["valid"] is True
        assert report["queryable"] is True
        assert report["preview"]["columns"] == ["gene", "S1"]
        assert report["storage_uri"] == str(
            tmp_path / "uploads" / "upload_preview_only" / "draft" / "matrix.tsv"
        )

        response = client.get("/v1/catalog/datasets/upload_preview_only")
        assert response.status_code == 404


def test_ingest_validate_reports_storage_escape_without_registering(tmp_path: Path) -> None:
    data_root = tmp_path / "data_root"
    data_root.mkdir()
    outside = tmp_path / "outside.tsv"
    outside.write_text("gene\tS1\n", encoding="utf-8")
    with make_client(local_data_root=str(data_root)) as client:
        response = client.post(
            "/v1/ingest/validate",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "unsafe_dataset",
                "version": "v1",
                "data_model": "bulk",
                "backend": "xena",
                "source": {"expression": str(outside)},
                "metadata": {"title": "Unsafe"},
            },
        )
        assert response.status_code == 200, response.text
        report = response.json()
        assert report["valid"] is False
        assert report["queryable"] is False
        assert report["issues"][0]["level"] == "error"
        assert report["issues"][0]["field"] == "storage_uri"

        response = client.get("/v1/catalog/datasets/unsafe_dataset")
        assert response.status_code == 404


def test_upload_ingest_saves_file_and_registers_dataset(tmp_path: Path) -> None:
    with make_client(local_data_root=str(tmp_path)) as client:
        response = client.post(
            "/v1/ingest/upload",
            headers=ADMIN_HEADERS,
            data={
                "dataset": "uploaded_matrix",
                "version": "v1",
                "data_model": "bulk",
                "backend": "xena",
                "role": "expression",
                "metadata_json": '{"title":"Uploaded matrix"}',
                "is_default": "true",
            },
            files={"file": ("matrix.tsv", b"gene\tS1\nYTHDF2\t1.2\n", "text/tab-separated-values")},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "success"
        assert body["registered"] is True
        assert body["preview"]["columns"] == ["gene", "S1"]
        assert body["preview"]["sample_rows"] == [{"gene": "YTHDF2", "S1": "1.2"}]
        assert body["data"]["result"]["preview"]["sampled_rows"] == 1

        uploaded = tmp_path / "uploads" / "uploaded_matrix" / "v1" / "matrix.tsv"
        assert uploaded.read_text(encoding="utf-8") == "gene\tS1\nYTHDF2\t1.2\n"

        response = client.get("/v1/catalog/datasets/uploaded_matrix")
        assert response.status_code == 200, response.text
        dataset = response.json()["data"]
        assert dataset["dataset"] == "uploaded_matrix"
        assert dataset["source_roles"] == ["expression"]


def test_v2_catalog_query_and_agent_call() -> None:
    with make_client() as client:
        register_dataset(client, "tcga_test", "bulk_expression")
        client.app.state.backend_router.memory_backend.seed(
            table="expression",
            rows=[
                {
                    "dataset": "tcga_test",
                    "version": "v1",
                    "sample_id": "S1",
                    "gene_symbol": "IDH1",
                    "cancer": "LGG",
                    "group_name": "tumor",
                    "value": 1.0,
                },
                {
                    "dataset": "tcga_test",
                    "version": "v1",
                    "sample_id": "S2",
                    "gene_symbol": "IDH1",
                    "cancer": "GBM",
                    "group_name": "tumor",
                    "value": 2.0,
                },
            ],
        )

        response = client.get("/version")
        assert response.status_code == 200
        assert response.json()["api"] == "v2"

        response = client.get("/v1/catalog/datasets")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "success"
        assert body["data"][0]["dataset"] == "tcga_test"
        assert body["data"][0]["data_model"] == "bulk"

        response = client.get("/v1/catalog/datasets/tcga_test")
        assert response.status_code == 200, response.text
        detail = response.json()["data"]
        assert detail["versions"] == ["v1"]
        assert detail["status"] == "active"
        assert detail["publication_state"] == "active"
        assert detail["source_roles"] == []
        assert "storage_uri" not in detail

        response = client.get("/v1/catalog/datasets/tcga_test/schema")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["feature"]["type"] == "gene"

        response = client.get("/v1/catalog/datasets/tcga_test/capabilities")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["can_query_matrix"] is True

        response = client.get("/v1/catalog/datasets/tcga_test/fields")
        assert response.status_code == 200, response.text
        field_names = {field["field"] for field in response.json()["data"]}
        assert {"sample_id", "cancer", "gene_symbol"} <= field_names

        response = client.get("/v1/catalog/datasets/tcga_test/values/cancer")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["values"] == ["GBM", "LGG"]

        payload = {
            "dataset": "tcga_test",
            "version": "latest",
            "assay": "rna",
            "data_model": "bulk",
            "select": {
                "features": ["IDH1"],
                "observations": {"cancer": ["LGG"]},
                "fields": ["sample_id", "cancer", "group"],
            },
            "layer": "log2_tpm",
            "measure": "expression",
            "return": {"format": "json", "shape": "tidy"},
            "options": {"limit": 10},
        }
        response = client.post("/v1/query", json=payload)
        assert response.status_code == 200, response.text
        query_body = response.json()
        assert query_body["status"] == "success"
        assert query_body["data"][0]["observation_id"] == "S1"
        assert query_body["data"][0]["feature_symbol"] == "IDH1"
        assert query_body["meta"]["n_rows"] == 1

        response = client.get("/v1/agent/tools")
        assert response.status_code == 200, response.text
        tool_names = {tool["name"] for tool in response.json()["tools"]}
        assert {"query_data", "compute", "list_datasets"} <= tool_names

        response = client.post(
            "/v1/agent/call",
            json={"tool": "query_data", "args": payload},
        )
        assert response.status_code == 200, response.text
        agent_body = response.json()
        assert agent_body["tool"] == "query_data"
        assert agent_body["data"][0]["sample_id"] == "S1"


def test_v2_compute_and_jobs() -> None:
    with make_client() as client:
        register_dataset(client, "tcga_test", "bulk_expression")
        response = client.post(
            "/v1/compute",
            headers=ADMIN_HEADERS,
            json={
                "task": "survival",
                "dataset": "tcga_test",
                "inputs": {"expression": {"features": ["IDH1"], "assay": "rna"}},
                "execution": {"mode": "auto"},
            },
        )
        assert response.status_code == 200, response.text
        job_id = response.json()["job_id"]
        assert response.json()["status"] == "accepted"

        response = client.get(f"/v1/jobs/{job_id}", headers=ADMIN_HEADERS)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["state"] == "queued"

        response = client.delete(f"/v1/jobs/{job_id}", headers=ADMIN_HEADERS)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["state"] == "cancelled"


def test_v2_xena_backend_queries_wide_matrix_lazily(tmp_path) -> None:
    matrix = tmp_path / "toil.tsv"
    matrix.write_text(
        "\t".join(["gene", "S1", "S2", "S3"]) + "\n"
        "ENSG1\t1.0\t2.0\t3.0\n"
        "ENSG2\t4.0\t5.0\t6.0\n",
        encoding="utf-8",
    )
    build_xena_matrix_index(matrix)
    gene_map = tmp_path / "genes.tsv"
    gene_map.write_text(
        "id\tgene\tchrom\tchromStart\tchromEnd\tstrand\n"
        "ENSG1\tYTHDF2\tchr1\t1\t2\t+\n"
        "ENSG2\tTP53\tchr17\t1\t2\t-\n",
        encoding="utf-8",
    )
    phenotype = tmp_path / "phenotype.tsv"
    phenotype_header = [
        "sample",
        "detailed_category",
        "primary disease or tissue",
        "_primary_site",
        "_sample_type",
        "_gender",
        "_study",
    ]
    phenotype_rows = [
        [
            "S1",
            "Pancreatic Adenocarcinoma",
            "Pancreatic Adenocarcinoma",
            "Pancreas",
            "Primary Tumor",
            "Female",
            "TCGA",
        ],
        [
            "S2",
            "Pancreatic Adenocarcinoma",
            "Pancreatic Adenocarcinoma",
            "Pancreas",
            "Solid Tissue Normal",
            "Male",
            "GTEx",
        ],
        [
            "S3",
            "Brain Lower Grade Glioma",
            "Brain Lower Grade Glioma",
            "Brain",
            "Primary Tumor",
            "Female",
            "TCGA",
        ],
    ]
    phenotype.write_text(
        "\n".join(["\t".join(phenotype_header), *["\t".join(row) for row in phenotype_rows]])
        + "\n",
        encoding="utf-8",
    )

    with make_client(local_data_root=str(tmp_path)) as client:
        response = client.post(
            "/v1/ingest",
            headers=ADMIN_HEADERS,
            json={
                "dataset": "toil",
                "data_model": "bulk",
                "backend": "xena",
                "version": "2026.07",
                "source": {"matrix": str(matrix)},
                "is_default": True,
                "metadata": {
                    "title": "Toil Xena",
                    "assays": ["rna"],
                    "layer": "log2_tpm",
                    "gene_map_uri": str(gene_map),
                    "phenotype_uri": str(phenotype),
                },
            },
        )
        assert response.status_code == 200, response.text

        response = client.get("/v1/catalog/datasets/toil/values/cancer")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["values"] == [
            "Brain Lower Grade Glioma",
            "Pancreatic Adenocarcinoma",
        ]

        response = client.post(
            "/v1/query",
            json={
                "dataset": "toil",
                "assay": "rna",
                "data_model": "bulk",
                "select": {
                    "features": ["YTHDF2"],
                    "observations": {"cancer": "Pancreatic Adenocarcinoma"},
                },
                "layer": "log2_tpm",
                "measure": "expression",
                "return": {"format": "json", "shape": "tidy"},
                "options": {"limit": 10},
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["meta"]["backend"] == "xena"
        assert [row["sample_id"] for row in body["data"]] == ["S1", "S2"]
        assert [row["value"] for row in body["data"]] == [1.0, 2.0]
        assert body["data"][0]["feature_symbol"] == "YTHDF2"


def test_legacy_routes_are_not_exposed() -> None:
    with make_client() as client:
        routes = [
            (client.get, "/v1/datasets"),
            (client.post, "/v1/datasets"),
            (client.post, "/v1/expression/query"),
            (client.post, "/v1/survival/query"),
            (client.post, "/v1/singlecell/query"),
            (client.post, "/v1/spatial/query"),
            (client.post, "/v1/eqtl/query"),
            (client.get, "/v1/tools"),
            (client.post, "/v1/tools/call"),
        ]
        for request, path in routes:
            response = request(path)
            assert response.status_code == 404
