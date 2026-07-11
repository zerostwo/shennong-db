export type DataModel = "bulk" | "single_cell" | "spatial" | "clinical" | "qtl" | "table";

export interface DatasetSummary {
  dataset: string;
  title: string;
  data_model: DataModel;
  assays: string[];
  default_version: string | null;
  backend: string;
  visibility: string;
}

interface ResourceRecord {
  id: string;
  kind: string;
  metadata: Record<string, unknown>;
  spec: Record<string, unknown>;
  status: string;
  permissions: { visibility?: string };
}

export interface QueryRow {
  [key: string]: string | number | boolean | null | undefined;
}

export interface QueryResponse {
  status: string;
  data: QueryRow[];
  meta: {
    dataset: string;
    version: string;
    backend: string;
    n_rows: number;
    columns: string[];
    elapsed_ms: number;
  };
}

export interface ApiStatus {
  ok: boolean;
  source: "live" | "mock";
  message: string;
}

const API_URL = import.meta.env.VITE_SHENNONG_API_URL ?? "";

export const mockDatasets: DatasetSummary[] = [
  {
    dataset: "toil",
    title: "TCGA TARGET GTEx Toil RNA-seq",
    data_model: "bulk",
    assays: ["rna"],
    default_version: "2026.07",
    backend: "file",
    visibility: "public"
  }
];

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function dataModel(value: unknown): DataModel {
  return ["bulk", "single_cell", "spatial", "clinical", "qtl", "table"].includes(String(value))
    ? (value as DataModel)
    : "table";
}

function resourceToDataset(resource: ResourceRecord): DatasetSummary {
  return {
    dataset: resource.id,
    title: stringValue(resource.metadata.title) ?? stringValue(resource.metadata.name) ?? resource.id,
    data_model: dataModel(resource.metadata.data_model),
    assays: Array.isArray(resource.metadata.assays) ? resource.metadata.assays.map(String) : [],
    default_version: stringValue(resource.spec.version) ?? null,
    backend: stringValue(resource.spec.backend) ?? stringValue(resource.spec.storage) ?? "file",
    visibility: resource.permissions.visibility ?? "public"
  };
}

export async function fetchDatasets(): Promise<{ datasets: DatasetSummary[]; status: ApiStatus }> {
  try {
    const response = await requestJson<{ data: ResourceRecord[] }>("/api/v1/resources");
    return {
      datasets: response.data.map(resourceToDataset),
      status: { ok: true, source: "live", message: "Connected to ShennongDB v0.1.0" }
    };
  } catch (error) {
    return {
      datasets: mockDatasets,
      status: {
        ok: false,
        source: "mock",
        message: error instanceof Error ? error.message : "Using mock data"
      }
    };
  }
}

export async function queryDataset(
  dataset: DatasetSummary,
  gene: string,
  limit = 200
): Promise<QueryResponse> {
  if (!["bulk", "single_cell", "spatial"].includes(dataset.data_model)) {
    throw new Error(`This release has no expression adapter for ${dataset.data_model} Resources.`);
  }
  const response = await requestJson<{ data: QueryResponse }>("/api/v1/query", {
    method: "POST",
    body: JSON.stringify({
      resource: dataset.dataset,
      version: dataset.default_version ?? "latest",
      operation: "expression",
      feature: { type: "gene", name: gene },
      context: {},
      options: { limit }
    })
  });
  return response.data;
}

export function buildMockQuery(dataset: DatasetSummary, gene: string): QueryResponse {
  const data = Array.from({ length: 12 }, (_, index) => ({
    observation_id: `sample-${String(index + 1).padStart(3, "0")}`,
    feature: gene,
    value: Number((4.2 + Math.sin(index) * 1.4).toFixed(3))
  }));
  return {
    status: "mock",
    data,
    meta: {
      dataset: dataset.dataset,
      version: dataset.default_version ?? "mock",
      backend: dataset.backend,
      n_rows: data.length,
      columns: Object.keys(data[0] ?? {}),
      elapsed_ms: 0
    }
  };
}
