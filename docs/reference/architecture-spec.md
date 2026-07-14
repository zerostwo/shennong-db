# ShennongDB Architecture Specification

> Historical architecture target for the v0.1.0 rewrite. For the current
> release surface, use `docs/guide.md`, `openapi/shennongdb.json`, and the
> checked-in Rust workspace as the sources of truth.

## v0.1.0 release boundary

This release ships the API, PostgreSQL, ClickHouse, and TileDB in one Docker
image and one Compose service. PostgreSQL stores metadata. ClickHouse is an
internal-only server used for the Toil expression cache. TileDB is embedded in
the query process and stores sparse PBMC feature-by-cell arrays under `/data`.

This all-in-one boundary favors simple deployment and backup. It intentionally
does not provide independent scaling, upgrades, or failure isolation for the
internal engines. The Resource, Artifact, Relation, and query contracts remain
storage-independent so those processes can be split later without changing the
agent-facing API.

## Vision

Shennong-db is:

> A universal biological data infrastructure layer for storage, metadata
> management, semantic discovery, and reproducible access.

The system is designed as the data kernel of Shennong OS.

The goal is not to build an analysis platform or AI agent framework.

The goal is to provide a stable biological data abstraction layer that
can be safely accessed by humans, software, and future AI agents.

------------------------------------------------------------------------

# Design Principles

## 1. Semantic first, storage independent

Users query biological concepts:

-   genes
-   datasets
-   diseases
-   cells
-   assays
-   measurements

They do not query:

-   ClickHouse tables
-   h5ad files
-   parquet files
-   object storage paths

Storage engines are implementation details.

------------------------------------------------------------------------

## 2. Metadata first

Every resource must expose metadata before data access.

Large objects are never loaded automatically.

The workflow is:

    discover
     |
    inspect metadata
     |
    validate permissions
     |
    request artifact/query
     |
    retrieve data

------------------------------------------------------------------------

## 3. Three core abstractions

The entire system should be built around three primitives:

    Resource

    Artifact

    Relation

Avoid dozens of specialized object types.

------------------------------------------------------------------------

# Resource Model

A Resource is a biological concept.

Examples:

-   Dataset
-   Gene
-   Protein
-   Disease
-   Drug
-   Reference genome
-   Knowledge database
-   Analysis result
-   Model artifact

Schema:

``` yaml
Resource:

id:

kind:

metadata:

spec:

status:

provenance:

permissions:
```

Example:

``` yaml
kind:
Dataset

metadata:

name:
PBMC3K

organism:
human

modality:
scRNA-seq

spec:

reference:
GRCh38

status:

available:
true
```

------------------------------------------------------------------------

# Artifact Model

Artifacts represent physical data.

A Resource can have multiple artifacts.

Examples:

PBMC3K:

    Resource:
    PBMC3K


    Artifacts:

    expression_matrix.h5ad

    cell_metadata.parquet

    embedding.zarr

Schema:

``` yaml
Artifact:

id:

resource_id:

uri:

format:

size:

checksum:

storage_backend:

schema:
```

Supported formats:

-   h5ad
-   zarr
-   parquet
-   csv
-   bam
-   fasta
-   gtf
-   sqlite
-   feather

------------------------------------------------------------------------

# Relation Model

Relations represent biological knowledge.

Examples:

    Gene -> Disease

    Gene -> Drug

    Gene -> Cell type

    Dataset -> Publication

    Analysis -> Dataset

Schema:

``` yaml
Relation:

source:

target:

type:

evidence:

provenance:
```

------------------------------------------------------------------------

# Knowledge Resource Support

External biological databases are not special cases.

They are Resources.

Examples:

-   Xena TOIL
-   GeneCards
-   Human Protein Atlas
-   OpenTargets
-   UniProt
-   CellPhoneDB
-   SCENIC databases
-   Reactome
-   KEGG

Example:

``` yaml
kind:

KnowledgeResource


metadata:

name:
OpenTargets

domain:
gene-disease-drug


artifact:

opentargets.parquet
```

------------------------------------------------------------------------

# Built-in Resource Registry

Shennong-db should provide a plugin system for curated resources.

Example:

    providers/

      toil.yaml

      hpa.yaml

      opentargets.yaml

      uniprot.yaml

Each provider defines:

``` yaml
name:

version:

source:

download:

checksum:

resource_schema:

storage:
```

Installation:

    shennong resource install toil

Process:

    download

    validate

    convert

    register Resource

    register Artifact

    index metadata

    ready

------------------------------------------------------------------------

# Core Services

Rust workspace:

    shennong-db/

    crates/

     shennong-server

     shennong-core

     shennong-schema

     shennong-storage

     shennong-query

     shennong-auth

     shennong-cli

------------------------------------------------------------------------

# Technology Stack

Backend:

-   Rust
-   Axum
-   Tokio
-   SQLx
-   Serde
-   Tower
-   Tracing

Database:

Metadata:

-   PostgreSQL

Analytical engines:

-   ClickHouse
-   TileDB-SOMA
-   DuckDB
-   Arrow

Storage:

Abstract interface:

    ObjectStorage trait

Backends:

-   local filesystem
-   S3 compatible storage
-   Ceph
-   Cloud storage

Do not hardcode MinIO.

------------------------------------------------------------------------

# Query Architecture

The agent-facing path is metadata-first and two-level:

    GET /.well-known/shennong-agent.json
      -> choose candidate Resource
      -> GET /api/v1/agent/resources/{id}
      -> inspect fields, dimensions, readiness, Artifacts, and Relations
      -> POST /api/v1/query only for an operation marked ready

Toil expression uses its byte-offset index for the first feature lookup and
stores the resulting sample vector in ClickHouse. PBMC expression reads sparse
TileDB arrays by gene symbol or Ensembl identifier.

The installed Toil Resource currently has expression and sample IDs but no
cancer-project, sample-type, or survival annotations. PBMC matrices currently
have barcodes and counts but no cell-type annotations. The planner rejects
context filters until those annotation Resources are installed; it must never
silently return unfiltered data for a filtered biological question.

------------------------------------------------------------------------

# Permission and Security

Implement RBAC.

Roles:

-   guest
-   user
-   admin

Permissions:

-   resource.read
-   resource.write
-   resource.admin

Rules:

-   private unpublished datasets are invisible
-   every query requires authorization
-   artifacts inherit resource permissions

Use:

-   JWT authentication
-   secure middleware
-   audit logs

------------------------------------------------------------------------

# Provenance

Every Resource and Artifact must track:

    source

    creator

    software

    version

    parameters

    timestamp

    parent resources

Example:

SCVI embedding:

    input:
    PBMC dataset

    method:
    scVI

    parameters:
    latent=30

    software:
    scvi-tools

    output:
    embedding.zarr

------------------------------------------------------------------------

# AI Agent Compatibility

The API should be designed for future AI agents.

Agents should discover:

    Resource metadata

    Capabilities

    Relations

    Available measurements

    Query schema

Agents should never directly access storage.

Example:

Agent request:

"Find genes associated with pancreatic cancer CAR-T targets"

The system exposes:

    Disease Resource

    Gene Resources

    Expression Resources

    Knowledge Relations

    Evidence

------------------------------------------------------------------------

# API Design

Base:

    /api/v1

Core endpoints:

    GET    /resources

    GET    /resources/{id}

    POST   /query

    GET    /resources/{id}/artifacts

    GET    /resources/{id}/relations

    POST   /resources/install

    GET    /capabilities

------------------------------------------------------------------------

# Implementation Priorities

Phase 1:

-   Rust backend
-   Resource model
-   Artifact model
-   PostgreSQL metadata
-   RBAC
-   storage abstraction
-   migration system

Phase 2:

-   ClickHouse adapter
-   TileDB-SOMA adapter
-   resource providers
-   query planner

Phase 3:

-   knowledge graph
-   semantic search
-   AI agent interfaces

------------------------------------------------------------------------

# Final Architecture

                    Shennong-db


                         API


                          |

                  Resource Engine


                          |

            ----------------------------

            Resource

            Artifact

            Relation


            ----------------------------


     PostgreSQL      Object Storage      Analytics Engines

The key abstraction:

> Everything is a Resource. Data lives in Artifacts. Biology is
> connected by Relations.

This provides a minimal, extensible, secure foundation for future
biological computing.
