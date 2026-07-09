import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  Database,
  FileUp,
  FlaskConical,
  KeyRound,
  Layers3,
  Loader2,
  Lock,
  MessageSquareText,
  Play,
  Search,
  SendHorizontal,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  UploadCloud,
  UsersRound,
  type LucideIcon
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea
} from "@/components/ui/input-group";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from "@/components/ui/message-scroller";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  AdminOverview,
  AgentTool,
  ApiStatus,
  BootstrapPayload,
  CatalogField,
  DataModel,
  DatasetCapabilities,
  DatasetDetail,
  DatasetSchema,
  DatasetSummary,
  IngestResponse,
  IngestRegistrationPayload,
  IngestValidationReport,
  QueryResponse,
  agentQueryDataset,
  bootstrapAccess,
  buildMockQuery,
  fetchAdminOverview,
  fetchAgentTools,
  fetchDatasetCapabilities,
  fetchDatasetDetail,
  fetchDatasetFields,
  fetchDatasetSchema,
  fetchDatasets,
  publishDatasetRegistration,
  queryDataset,
  uploadDatasetFile,
  validateIngestManifest,
  validateUploadDatasetFile
} from "./lib/api";

type Section = "catalog" | "explore" | "agent" | "publish" | "admin" | "dataset";
type SourceMode = "server_path" | "upload" | "metadata";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ToolTrace {
  name: string;
  status: "queued" | "running" | "done";
  detail: string;
}

const navItems: Array<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: "catalog", label: "Catalog", icon: Database },
  { id: "explore", label: "Explore", icon: Layers3 },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "publish", label: "Publish", icon: UploadCloud },
  { id: "admin", label: "Admin", icon: ShieldCheck }
];

const publishProfiles: Array<{
  model: DataModel;
  label: string;
  description: string;
  defaultBackend: string;
  defaultRole: string;
  backends: string[];
  roles: string[];
  pathPlaceholder: string;
}> = [
  {
    model: "bulk",
    label: "Bulk",
    description: "Expression matrices or long expression tables.",
    defaultBackend: "xena",
    defaultRole: "matrix",
    backends: ["xena", "clickhouse", "memory"],
    roles: ["matrix", "expression"],
    pathPlaceholder: "/data/shennong/toil/expression.tsv"
  },
  {
    model: "clinical",
    label: "Clinical",
    description: "Survival and sample-level clinical tables.",
    defaultBackend: "clickhouse",
    defaultRole: "survival",
    backends: ["clickhouse", "memory"],
    roles: ["survival", "clinical", "events"],
    pathPlaceholder: "/data/shennong/toil/survival.csv"
  },
  {
    model: "single_cell",
    label: "Single-cell",
    description: "TileDB-SOMA, h5ad, or 10x H5 stores.",
    defaultBackend: "tiledb_soma",
    defaultRole: "soma",
    backends: ["tiledb_soma", "tenx_h5", "memory"],
    roles: ["soma", "h5ad", "h5", "matrix"],
    pathPlaceholder: "/data/shennong/pan_tcell/soma"
  },
  {
    model: "spatial",
    label: "Spatial",
    description: "Spatial SOMA or image-aligned expression stores.",
    defaultBackend: "tiledb_soma",
    defaultRole: "soma",
    backends: ["tiledb_soma", "tenx_h5", "memory"],
    roles: ["soma", "spatial", "h5ad", "h5"],
    pathPlaceholder: "/data/shennong/spatial/soma"
  },
  {
    model: "qtl",
    label: "eQTL",
    description: "Variant-gene-tissue summary statistics.",
    defaultBackend: "clickhouse",
    defaultRole: "eqtl",
    backends: ["clickhouse", "memory"],
    roles: ["eqtl", "qtl", "variants"],
    pathPlaceholder: "/data/shennong/gtex/eqtl.csv"
  }
];

function publishProfileFor(model: DataModel) {
  return publishProfiles.find((profile) => profile.model === model) ?? publishProfiles[0];
}

function datasetAssayFor(model: DataModel) {
  return model === "clinical" ? "clinical" : model === "qtl" ? "eqtl" : "rna";
}

function datasetMeasureFor(model: DataModel) {
  if (model === "clinical") {
    return "survival";
  }
  if (model === "qtl") {
    return "eqtl";
  }
  return "expression";
}

function rSnippet(dataset: DatasetSummary, gene: string) {
  if (dataset.data_model === "clinical") {
    return [
      `library(ShennongData)`,
      ``,
      `${dataset.dataset} <- sn_load_data("${dataset.dataset}")`,
      `${dataset.dataset} |>`,
      `  dplyr::filter(cancer == "PAAD") |>`,
      `  sn_collect(limit = 1000)`
    ].join("\n");
  }
  return [
    `library(ShennongData)`,
    ``,
    `${dataset.dataset} <- sn_load_data("${dataset.dataset}")`,
    `${dataset.dataset} |>`,
    `  dplyr::filter(cancer == "PAAD") |>`,
    `  sn_collect(features = "${gene}", limit = 1000)`
  ].join("\n");
}

function apiSnippet(dataset: DatasetSummary, gene: string) {
  const payload = {
    dataset: dataset.dataset,
    version: dataset.default_version ?? "latest",
    assay: datasetAssayFor(dataset.data_model),
    data_model: dataset.data_model,
    select: {
      features: dataset.data_model === "clinical" ? [] : [gene],
      observations: dataset.data_model === "bulk" ? { cancer: "PAAD" } : {},
      fields: []
    },
    layer: dataset.data_model === "clinical" ? null : "log2_tpm",
    measure: datasetMeasureFor(dataset.data_model),
    return: { format: "json", shape: "tidy" },
    options: { limit: 1000 }
  };
  return `curl -X POST "$SHENNONG_API_URL/v1/query" \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(payload, null, 2)}'`;
}

function agentPrompt(dataset: DatasetSummary, gene: string) {
  if (dataset.data_model === "single_cell" || dataset.data_model === "spatial") {
    return `In ${dataset.dataset}, which annotated cell states express ${gene}, and what metadata should I inspect next?`;
  }
  if (dataset.data_model === "clinical") {
    return `In ${dataset.dataset}, summarize survival records and suggest a cohort split to test.`;
  }
  return `In ${dataset.dataset}, is ${gene} associated with prognosis or cancer context?`;
}

function datasetPath(datasetId: string) {
  return `/datasets/${encodeURIComponent(datasetId)}`;
}

function routeFromLocation(): { section: Section; datasetId: string | null } {
  if (typeof window === "undefined") {
    return { section: "catalog", datasetId: null };
  }
  const path = window.location.pathname;
  const datasetMatch = path.match(/^\/datasets\/([^/]+)\/?$/);
  if (datasetMatch) {
    return { section: "dataset", datasetId: decodeURIComponent(datasetMatch[1]) };
  }
  if (path === "/explore") {
    return { section: "explore", datasetId: null };
  }
  if (path === "/agent") {
    return { section: "agent", datasetId: null };
  }
  if (path === "/publish") {
    return { section: "publish", datasetId: null };
  }
  if (path === "/admin") {
    return { section: "admin", datasetId: null };
  }
  return { section: "catalog", datasetId: null };
}

function pathForSection(section: Section) {
  if (section === "catalog") {
    return "/";
  }
  if (section === "dataset") {
    return null;
  }
  return `/${section}`;
}

const cellPoints = Array.from({ length: 160 }, (_, index) => {
  const cluster = index % 4;
  const angle = index * 0.38;
  const radius = 1.4 + (index % 17) * 0.08;
  const centers = [
    [-2.3, -0.8],
    [1.8, -1.2],
    [-0.2, 1.8],
    [2.7, 1.6]
  ];
  return {
    x: Number((Math.cos(angle) * radius + centers[cluster][0]).toFixed(2)),
    y: Number((Math.sin(angle) * radius + centers[cluster][1]).toFixed(2)),
    cluster,
    label: ["CD8 exhausted", "CD4 memory", "Treg", "Cycling T"][cluster]
  };
});

const survivalPoints = [
  { month: 0, high: 1, low: 1 },
  { month: 12, high: 0.86, low: 0.9 },
  { month: 24, high: 0.68, low: 0.78 },
  { month: 36, high: 0.51, low: 0.69 },
  { month: 48, high: 0.42, low: 0.61 },
  { month: 60, high: 0.31, low: 0.54 }
];

const expressionChartConfig = {
  value: {
    label: "Mean expression",
    color: "var(--chart-1)"
  }
} satisfies ChartConfig;

const survivalChartConfig = {
  high: {
    label: "High expression",
    color: "var(--chart-2)"
  },
  low: {
    label: "Low expression",
    color: "var(--chart-1)"
  }
} satisfies ChartConfig;

const cellChartConfig = {
  cluster0: { label: "CD8 exhausted", color: "var(--chart-1)" },
  cluster1: { label: "CD4 memory", color: "var(--chart-3)" },
  cluster2: { label: "Treg", color: "var(--chart-2)" },
  cluster3: { label: "Cycling T", color: "var(--chart-4)" }
} satisfies ChartConfig;

function App() {
  const initialRoute = useMemo(routeFromLocation, []);
  const [section, setSection] = useState<Section>(initialRoute.section);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    ok: false,
    source: "mock",
    message: "Loading"
  });
  const [selectedDatasetId, setSelectedDatasetId] = useState(initialRoute.datasetId ?? "toil");
  const [searchText, setSearchText] = useState("");
  const [gene, setGene] = useState("YTHDF2");
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [adminToken, setAdminToken] = useState(import.meta.env.VITE_SHENNONG_ADMIN_KEY ?? "");
  const [agentTools, setAgentTools] = useState<AgentTool[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Select a dataset and ask a grounded biology question. I will show the tools I would call before summarizing the result."
    }
  ]);
  const [toolTrace, setToolTrace] = useState<ToolTrace[]>([
    { name: "list_datasets", status: "done", detail: "Catalog context loaded" }
  ]);

  function navigateSection(nextSection: Section) {
    setSection(nextSection);
    const path = pathForSection(nextSection);
    if (path && typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }

  function navigateDataset(datasetId: string) {
    setSelectedDatasetId(datasetId);
    setSection("dataset");
    if (typeof window !== "undefined") {
      const path = datasetPath(datasetId);
      if (window.location.pathname !== path) {
        window.history.pushState({}, "", path);
      }
    }
  }

  async function refreshDatasets() {
    const response = await fetchDatasets();
    setDatasets(response.datasets);
    setApiStatus(response.status);
    if (response.datasets.length > 0) {
      setSelectedDatasetId((current) =>
        response.datasets.some((dataset) => dataset.dataset === current)
          ? current
          : response.datasets[0].dataset
      );
    }
  }

  useEffect(() => {
    void refreshDatasets();
    void fetchAgentTools()
      .then(setAgentTools)
      .catch(() => setAgentTools([]));
  }, []);

  useEffect(() => {
    function handlePopState() {
      const route = routeFromLocation();
      setSection(route.section);
      if (route.datasetId) {
        setSelectedDatasetId(route.datasetId);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selectedDataset = useMemo(
    () =>
      datasets.find((dataset) => dataset.dataset === selectedDatasetId) ??
      (section === "dataset" ? undefined : datasets[0]),
    [datasets, section, selectedDatasetId]
  );

  const filteredDatasets = useMemo(() => {
    const normalized = searchText.trim().toLowerCase();
    if (!normalized) {
      return datasets;
    }
    return datasets.filter((dataset) =>
      [dataset.dataset, dataset.title, dataset.data_model, dataset.backend]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [datasets, searchText]);

  useEffect(() => {
    if (!selectedDataset) {
      return;
    }
    setQueryResult(buildMockQuery(selectedDataset, gene));
  }, [gene, selectedDataset]);

  async function runQuery(): Promise<QueryResponse | null> {
    if (!selectedDataset) {
      return null;
    }
    setIsQuerying(true);
    try {
      const response = await queryDataset(selectedDataset, gene, 200);
      setQueryResult(response);
      return response;
    } catch {
      const response = buildMockQuery(selectedDataset, gene);
      setQueryResult(response);
      return response;
    } finally {
      setIsQuerying(false);
    }
  }

  async function sendMessage(prompt: string) {
    if (!prompt.trim() || !selectedDataset) {
      return;
    }
    setChatMessages((messages) => [...messages, { role: "user", content: prompt }]);
    setToolTrace([
      { name: "agent.tools", status: agentTools.length ? "done" : "queued", detail: `${agentTools.length || "unknown"} registered tools` },
      { name: "query_data", status: "running", detail: `${gene} in ${selectedDataset.dataset}` }
    ]);
    try {
      const response = await agentQueryDataset(selectedDataset, gene, 200);
      setQueryResult(response);
      setToolTrace([
        { name: "agent.tools", status: agentTools.length ? "done" : "queued", detail: `${agentTools.length || "unknown"} registered tools` },
        { name: "query_data", status: "done", detail: `${gene}; /v1/agent/call; bounded page` }
      ]);
      setChatMessages((messages) => [
        ...messages,
        {
          role: "assistant",
          content: `I called the Shennong agent tool router and queried ${gene} in ${selectedDataset.dataset}. The current slice returns ${response.meta.n_rows} rows from ${response.meta.backend}.`
        }
      ]);
    } catch (error) {
      const response = await runQuery();
      setToolTrace([
        { name: "agent.tools", status: "queued", detail: "Tool router unavailable in this session" },
        { name: "query_data", status: "done", detail: `${gene}; fallback query/mock result` }
      ]);
      setChatMessages((messages) => [
        ...messages,
        {
          role: "assistant",
          content: `The agent tool router was unavailable, so I fell back to a bounded query preview for ${gene}. The current slice returns ${
            response?.meta.n_rows ?? "a bounded set of"
          } rows from ${response?.meta.backend ?? selectedDataset.backend}.`
        }
      ]);
      if (error instanceof Error) {
        setApiStatus((status) => ({ ...status, message: error.message }));
      }
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="flex border-b bg-sidebar text-sidebar-foreground lg:min-h-screen lg:w-64 lg:flex-col lg:border-r lg:border-b-0">
          <div className="flex w-full items-center gap-3 p-4 lg:h-20">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-base font-semibold text-sidebar-primary-foreground">
              S
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Shennong</div>
              <div className="truncate text-xs text-muted-foreground">Data Discovery</div>
            </div>
          </div>
          <ScrollArea className="hidden flex-1 lg:block">
            <nav className="flex flex-col gap-1 p-3" aria-label="Primary">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.id}
                    className="w-full justify-start"
                    variant={section === item.id ? "secondary" : "ghost"}
                    onClick={() => navigateSection(item.id)}
                    type="button"
                  >
                    <Icon data-icon="inline-start" />
                    {item.label}
                  </Button>
                );
              })}
            </nav>
          </ScrollArea>
          <div className="ml-auto flex items-center gap-2 p-3 lg:mt-auto lg:ml-0 lg:block">
            <Badge variant={apiStatus.source === "live" ? "default" : "outline"}>
              {apiStatus.source === "live" ? "Live API" : "Mock mode"}
            </Badge>
            <div className="hidden pt-2 text-xs text-muted-foreground lg:block">
              {apiStatus.source === "live" ? "Connected to local server" : "API fallback active"}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <InputGroup className="h-9 max-w-2xl">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search datasets, modalities, genes, projects"
                />
              </InputGroup>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" title="Access controls" type="button">
                  <Lock data-icon="icon" />
                </Button>
                <Button type="button" onClick={() => navigateSection("agent")}>
                  <Sparkles data-icon="inline-start" />
                  Ask agent
                </Button>
              </div>
            </div>
            <div className="mt-3 lg:hidden">
              <Tabs
                value={section === "dataset" ? "catalog" : section}
                onValueChange={(value) => navigateSection(value as Section)}
              >
                <TabsList className="w-full">
                  {navItems.map((item) => (
                    <TabsTrigger key={item.id} value={item.id}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </header>

          <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {section === "catalog" && (
                <CatalogPanel
                  datasets={filteredDatasets}
                  selectedDatasetId={selectedDatasetId}
                  onSelect={navigateDataset}
                />
              )}
              {section === "explore" && selectedDataset && (
                <ExplorerPanel
                  dataset={selectedDataset}
                  gene={gene}
                  onGeneChange={setGene}
                  queryResult={queryResult}
                  isQuerying={isQuerying}
                  onRunQuery={runQuery}
                />
              )}
              {section === "dataset" && selectedDataset && (
                <DatasetReleasePage
                  dataset={selectedDataset}
                  gene={gene}
                  onGeneChange={setGene}
                  onNavigate={navigateSection}
                  onRunQuery={runQuery}
                />
              )}
              {section === "agent" && selectedDataset && (
                <AgentPanel
                  dataset={selectedDataset}
                  gene={gene}
                  messages={chatMessages}
                  trace={toolTrace}
                  toolCount={agentTools.length}
                  onSend={sendMessage}
                />
              )}
              {section === "publish" && (
                <PublishPanel
                  adminToken={adminToken}
                  onAdminTokenChange={setAdminToken}
                  onPublished={refreshDatasets}
                />
              )}
              {section === "admin" && (
                <AdminPanel
                  apiStatus={apiStatus}
                  adminToken={adminToken}
                  onAdminTokenChange={setAdminToken}
                />
              )}
              {!selectedDataset && <LoadingPanel />}
            </div>

            <div className="min-w-0">
              <ContextPanel
                dataset={selectedDataset}
                gene={gene}
                onGeneChange={setGene}
                queryResult={queryResult}
                onNavigate={navigateSection}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

interface CatalogPanelProps {
  datasets: DatasetSummary[];
  selectedDatasetId: string;
  onSelect: (datasetId: string) => void;
}

function CatalogPanel({ datasets, selectedDatasetId, onSelect }: CatalogPanelProps) {
  const modalityCounts = datasets.reduce<Record<string, number>>((acc, dataset) => {
    acc[dataset.data_model] = (acc[dataset.data_model] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className="w-fit">
            Dataset catalog
          </Badge>
          <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
            Find, publish, and query biomedical datasets
          </h1>
        </div>
        <Button type="button" variant="outline">
          <FileUp data-icon="inline-start" />
          New dataset
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Datasets" value={String(datasets.length)} icon={Database} />
        <Metric label="Modalities" value={String(Object.keys(modalityCounts).length)} icon={Layers3} />
        <Metric
          label="Public"
          value={String(datasets.filter((dataset) => dataset.visibility === "public").length)}
          icon={ShieldCheck}
        />
        <Metric label="Agent tools" value="7" icon={Bot} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datasets</CardTitle>
          <CardDescription>Registry entries are lazy handles; data is fetched only by query.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[520px] rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Modality</TableHead>
                  <TableHead>Backend</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map((dataset) => (
                  <TableRow key={dataset.dataset} data-state={selectedDatasetId === dataset.dataset ? "selected" : undefined}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{dataset.title}</span>
                        <span className="text-xs text-muted-foreground">{dataset.dataset}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{dataset.data_model}</Badge>
                    </TableCell>
                    <TableCell>{dataset.backend}</TableCell>
                    <TableCell>
                      <Badge variant={dataset.visibility === "public" ? "default" : "outline"}>
                        {dataset.visibility}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        type="button"
                        aria-label={`Open ${dataset.dataset}`}
                        onClick={() => onSelect(dataset.dataset)}
                      >
                        <ChevronRight data-icon="icon" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

interface DatasetReleasePageProps {
  dataset: DatasetSummary;
  gene: string;
  onGeneChange: (gene: string) => void;
  onNavigate: (section: Section) => void;
  onRunQuery: () => Promise<QueryResponse | null>;
}

function DatasetReleasePage({
  dataset,
  gene,
  onGeneChange,
  onNavigate,
  onRunQuery
}: DatasetReleasePageProps) {
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [schema, setSchema] = useState<DatasetSchema | null>(null);
  const [capabilityInfo, setCapabilityInfo] = useState<DatasetCapabilities | null>(null);
  const [fields, setFields] = useState<CatalogField[]>([]);
  const [message, setMessage] = useState("Loading release metadata.");

  useEffect(() => {
    let active = true;
    const version = dataset.default_version ?? "latest";
    setMessage("Loading release metadata.");
    void Promise.all([
      fetchDatasetDetail(dataset.dataset),
      fetchDatasetSchema(dataset.dataset, version),
      fetchDatasetCapabilities(dataset.dataset, version),
      fetchDatasetFields(dataset.dataset, version)
    ])
      .then(([nextDetail, nextSchema, nextCapabilities, nextFields]) => {
        if (!active) {
          return;
        }
        setDetail(nextDetail);
        setSchema(nextSchema);
        setCapabilityInfo(nextCapabilities);
        setFields(nextFields);
        setMessage("Release metadata loaded.");
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setDetail(null);
        setSchema(null);
        setCapabilityInfo(null);
        setFields([]);
        setMessage(error instanceof Error ? error.message : "Release metadata is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [dataset.dataset, dataset.default_version]);

  const activeVersion = detail?.default_version ?? dataset.default_version ?? "latest";
  const sharePath = datasetPath(dataset.dataset);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-col gap-2">
          <Badge variant="outline" className="w-fit">
            Dataset release
          </Badge>
          <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
            {detail?.title ?? dataset.title}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {detail?.description ??
              "A versioned Shennong dataset with bounded query APIs, schema metadata, and agent-ready tools."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={detail?.visibility === "public" ? "default" : "outline"}>
              {detail?.visibility ?? dataset.visibility}
            </Badge>
            <Badge variant="secondary">{dataset.data_model}</Badge>
            <Badge variant="outline">{detail?.publication_state ?? "loading"}</Badge>
            <Badge variant="outline">{dataset.backend}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => onNavigate("agent")}>
            <Bot data-icon="inline-start" />
            Ask agent
          </Button>
          <Button type="button" onClick={() => void onRunQuery()}>
            <Play data-icon="inline-start" />
            Query preview
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Version" value={activeVersion} icon={Layers3} />
        <Metric label="Backend" value={dataset.backend} icon={Database} />
        <Metric label="Fields" value={String(fields.length || "0")} icon={Table2} />
        <Metric label="Share" value={sharePath} icon={ChevronRight} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="examples">Examples</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-2">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Release metadata</CardTitle>
                <CardDescription>{message}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <InfoCell label="Dataset id" value={dataset.dataset} />
                <InfoCell label="Status" value={detail?.status ?? "loading"} />
                <InfoCell
                  label="Source roles"
                  value={detail?.source_roles.length ? detail.source_roles.join(", ") : "not published"}
                />
                <InfoCell label="Citation" value={detail?.citation ?? "not provided"} />
                <InfoCell label="License" value={detail?.license ?? "not provided"} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Versions</CardTitle>
                <CardDescription>Published versions are immutable release handles.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {(detail?.versions ?? [activeVersion]).map((version) => (
                  <Badge key={version} variant={version === activeVersion ? "default" : "secondary"}>
                    {version}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="schema" className="mt-2">
          <Card>
            <CardHeader>
              <CardTitle>Schema and capabilities</CardTitle>
              <CardDescription>Agent and client code use this contract instead of raw storage.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {schema && (
                <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <InfoCell label="Observation" value={schema.observation?.type ?? "unknown"} />
                  <InfoCell label="Feature" value={schema.feature?.type ?? "unknown"} />
                  <InfoCell label="Measures" value={(schema.measures ?? []).join(", ") || "none"} />
                  <InfoCell label="Shapes" value={(schema.return_shapes ?? []).join(", ") || "none"} />
                </div>
              )}
              {capabilityInfo && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(capabilityInfo)
                    .filter(([key, value]) => key.startsWith("can_") && value === true)
                    .map(([key]) => (
                      <Badge key={key} variant="secondary">
                        {key.replace(/^can_/, "").replace(/_/g, " ")}
                      </Badge>
                    ))}
                </div>
              )}
              <ScrollArea className="max-h-72 rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field) => (
                      <TableRow key={`${field.scope}-${field.field}`}>
                        <TableCell>{field.scope}</TableCell>
                        <TableCell>{field.field}</TableCell>
                        <TableCell>{field.type}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="examples" className="mt-2">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>R lazy query</CardTitle>
                <CardDescription>Data is fetched only when collected or plotted.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
                  <code>{rSnippet(dataset, gene)}</code>
                </pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>API query</CardTitle>
                <CardDescription>Same bounded query contract used by Web and agents.</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
                  <code>{apiSnippet(dataset, gene)}</code>
                </pre>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="agent" className="mt-2">
          <Card>
            <CardHeader>
              <CardTitle>Agent entry</CardTitle>
              <CardDescription>Grounded prompt with this dataset as context.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="release-gene">Focus gene</FieldLabel>
                <InputGroup className="h-9">
                  <InputGroupInput
                    id="release-gene"
                    value={gene}
                    onChange={(event) => onGeneChange(event.target.value)}
                  />
                </InputGroup>
              </Field>
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                {agentPrompt(dataset, gene)}
              </div>
              <Button type="button" className="w-fit" onClick={() => onNavigate("agent")}>
                <MessageSquareText data-icon="inline-start" />
                Open agent
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface ExplorerPanelProps {
  dataset: DatasetSummary;
  gene: string;
  onGeneChange: (gene: string) => void;
  queryResult: QueryResponse | null;
  isQuerying: boolean;
  onRunQuery: () => Promise<QueryResponse | null>;
}

function ExplorerPanel({
  dataset,
  gene,
  onGeneChange,
  queryResult,
  isQuerying,
  onRunQuery
}: ExplorerPanelProps) {
  const expressionBars = useMemo(() => {
    const rows = queryResult?.data ?? [];
    const groups = rows.reduce<Record<string, { total: number; n: number }>>((acc, row) => {
      const group = String(row.group ?? row.group_name ?? row.cancer ?? "observations");
      const value = Number(row.value ?? 0);
      acc[group] = acc[group] ?? { total: 0, n: 0 };
      acc[group].total += value;
      acc[group].n += 1;
      return acc;
    }, {});
    return Object.entries(groups).map(([group, stats]) => ({
      group,
      value: Number((stats.total / Math.max(stats.n, 1)).toFixed(2))
    }));
  }, [queryResult]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className="w-fit">
            Explorer
          </Badge>
          <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">{dataset.title}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Query bounded slices, inspect cell states, and keep provenance visible.
          </p>
        </div>
        <FieldGroup className="max-w-xl">
          <Field orientation="responsive">
            <FieldLabel htmlFor="explorer-gene">Focus gene</FieldLabel>
            <div className="flex w-full gap-2">
              <InputGroup className="h-9">
                <InputGroupInput
                  id="explorer-gene"
                  value={gene}
                  onChange={(event) => onGeneChange(event.target.value)}
                />
              </InputGroup>
              <Button onClick={() => void onRunQuery()} type="button" disabled={isQuerying}>
                {isQuerying ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
                {isQuerying ? "Running" : "Run query"}
              </Button>
            </div>
          </Field>
        </FieldGroup>
      </div>

      <Tabs defaultValue={dataset.data_model === "single_cell" ? "cells" : "expression"}>
        <TabsList>
          <TabsTrigger value="expression">Expression</TabsTrigger>
          <TabsTrigger value="cells">Single-cell</TabsTrigger>
          <TabsTrigger value="survival">Survival</TabsTrigger>
        </TabsList>
        <TabsContent value="expression" className="mt-2">
          <Card>
            <CardHeader>
              <CardTitle>Expression profile</CardTitle>
              <CardDescription>Mean expression by available group</CardDescription>
              <CardAction>
                <Badge variant="secondary">{dataset.backend}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ChartContainer config={expressionChartConfig} className="aspect-auto h-[320px] w-full">
                <BarChart data={expressionBars} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="group" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="var(--color-value)" />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="cells" className="mt-2">
          <Card>
            <CardHeader>
              <CardTitle>Cell state map</CardTitle>
              <CardDescription>UMAP preview by annotated state</CardDescription>
              <CardAction>
                <Badge variant="secondary">{dataset.data_model}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ChartContainer config={cellChartConfig} className="aspect-auto h-[320px] w-full">
                <ScatterChart accessibilityLayer margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid />
                  <XAxis dataKey="x" type="number" name="UMAP 1" tickLine={false} axisLine={false} />
                  <YAxis dataKey="y" type="number" name="UMAP 2" tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent nameKey="label" />} cursor={{ strokeDasharray: "4 4" }} />
                  <Scatter data={cellPoints}>
                    {cellPoints.map((point) => (
                      <Cell
                        key={`${point.x}-${point.y}`}
                        fill={`var(--color-cluster${point.cluster})`}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="survival" className="mt-2">
          <Card>
            <CardHeader>
              <CardTitle>Survival association</CardTitle>
              <CardDescription>Preview for high vs low feature expression</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={survivalChartConfig} className="aspect-auto h-[320px] w-full">
                <LineChart data={survivalPoints} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} domain={[0, 1]} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="high" stroke="var(--color-high)" strokeWidth={2.5} dot={false} />
                  <Line dataKey="low" stroke="var(--color-low)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ResultPreview queryResult={queryResult} />
    </div>
  );
}

function ResultPreview({ queryResult }: { queryResult: QueryResponse | null }) {
  const columns = queryResult?.meta.columns.slice(0, 6) ?? ["sample_id", "feature", "value"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Result preview</CardTitle>
        <CardDescription>
          {queryResult
            ? `${queryResult.meta.n_rows} rows from ${queryResult.meta.backend}`
            : "No query has been run"}
        </CardDescription>
        <CardAction>
          <Badge variant={queryResult?.meta.cached ? "default" : "outline"}>
            {queryResult?.meta.cached ? "cached" : "fresh"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[360px] rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(queryResult?.data.slice(0, 8) ?? []).map((row, index) => (
                <TableRow key={index}>
                  {columns.map((column) => (
                    <TableCell key={column}>{String(row[column] ?? "")}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

interface AgentPanelProps {
  dataset: DatasetSummary;
  gene: string;
  messages: ChatMessage[];
  trace: ToolTrace[];
  toolCount: number;
  onSend: (prompt: string) => Promise<void>;
}

function AgentPanel({ dataset, gene, messages, trace, toolCount, onSend }: AgentPanelProps) {
  const [draft, setDraft] = useState(`Is ${gene} associated with prognosis in ${dataset.dataset}?`);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) {
      return;
    }
    void onSend(draft);
    setDraft("");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="min-h-[600px]">
        <CardHeader>
          <CardTitle>Ask grounded biological questions</CardTitle>
          <CardDescription>
            Dataset-aware agent with visible tool calls
            {toolCount ? `; ${toolCount} tools discovered from the API` : ""}
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{dataset.dataset}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <MessageScrollerProvider>
            <MessageScroller className="h-[420px] rounded-lg border">
              <MessageScrollerViewport>
                <MessageScrollerContent className="p-4">
                  {messages.map((message, index) => {
                    const align = message.role === "user" ? "end" : "start";
                    return (
                      <MessageScrollerItem key={index} scrollAnchor={index === messages.length - 1}>
                        <Message align={align}>
                          <MessageAvatar className="size-8 text-xs">
                            {message.role === "assistant" ? "AI" : "You"}
                          </MessageAvatar>
                          <MessageContent>
                            <MessageHeader>{message.role === "assistant" ? "Agent" : "You"}</MessageHeader>
                            <Bubble align={align} variant={message.role === "assistant" ? "secondary" : "default"}>
                              <BubbleContent>{message.content}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  })}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        </CardContent>
        <CardFooter>
          <form className="w-full" onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="agent-prompt" className="sr-only">
                  Agent prompt
                </FieldLabel>
                <InputGroup className="min-h-24 items-end">
                  <InputGroupAddon align="block-start" className="border-b">
                    <MessageSquareText />
                    Ask about expression, survival, cell types, or candidate targets
                  </InputGroupAddon>
                  <InputGroupTextarea
                    id="agent-prompt"
                    rows={3}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton type="submit" variant="default" size="sm">
                      <SendHorizontal data-icon="inline-start" />
                      Send
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            </FieldGroup>
          </form>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tool trace</CardTitle>
          <CardDescription>Visible calls keep the agent auditable</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {trace.map((tool) => (
            <div key={`${tool.name}-${tool.detail}`} className="flex gap-3 rounded-lg border p-3">
              <CheckCircle2 className="mt-0.5 size-4 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{tool.name}</div>
                <div className="truncate text-xs text-muted-foreground">{tool.detail}</div>
              </div>
              <Badge variant={tool.status === "done" ? "default" : "outline"}>{tool.status}</Badge>
            </div>
          ))}
          <Separator />
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">R</div>
            <pre className="overflow-x-auto text-xs leading-relaxed">
              <code>
                toil &lt;- sn_load_data("{dataset.dataset}"){"\n"}
                toil |&gt; dplyr::filter(cancer == "PAAD") |&gt;{"\n"}
                {"  "}sn_collect(features = "{gene}")
              </code>
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface PublishPanelProps {
  adminToken: string;
  onAdminTokenChange: (value: string) => void;
  onPublished: () => Promise<void>;
}

function PublishPanel({ adminToken, onAdminTokenChange, onPublished }: PublishPanelProps) {
  const [validated, setValidated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("Prepare a registry entry, then stage it through /v1/ingest.");
  const [dataset, setDataset] = useState("pan_cancer_tcell_atlas");
  const [version, setVersion] = useState("draft");
  const [dataModel, setDataModel] = useState<DataModel>("single_cell");
  const [backend, setBackend] = useState("tiledb_soma");
  const [title, setTitle] = useState("Pan-cancer T cell atlas");
  const [citation, setCitation] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("server_path");
  const [sourcePath, setSourcePath] = useState("");
  const [uploadRole, setUploadRole] = useState("soma");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [lastIngest, setLastIngest] = useState<IngestResponse | null>(null);
  const [validationReport, setValidationReport] = useState<IngestValidationReport | null>(null);
  const publishProfile = useMemo(() => publishProfileFor(dataModel), [dataModel]);

  useEffect(() => {
    setValidated(false);
    setValidationReport(null);
    setLastIngest(null);
  }, [
    backend,
    citation,
    dataModel,
    dataset,
    sourceMode,
    sourcePath,
    title,
    uploadFile,
    uploadRole,
    version
  ]);

  useEffect(() => {
    if (!publishProfile.backends.includes(backend)) {
      setBackend(publishProfile.defaultBackend);
    }
    if (!publishProfile.roles.includes(uploadRole)) {
      setUploadRole(publishProfile.defaultRole);
    }
  }, [backend, publishProfile, uploadRole]);

  function changeDataModel(value: DataModel) {
    const profile = publishProfileFor(value);
    setDataModel(value);
    setBackend(profile.defaultBackend);
    setUploadRole(profile.defaultRole);
  }

  function buildPayload(): IngestRegistrationPayload {
    const source =
      sourceMode === "server_path" && sourcePath.trim()
        ? { [uploadRole]: sourcePath.trim() }
        : {};
    return {
      dataset,
      version,
      data_model: dataModel,
      backend,
      source,
      citation: citation.trim() || null,
      is_default: true,
      register: true,
      metadata: {
        title,
        visibility: "private",
        source_mode: sourceMode,
        publication_state: "draft",
        ...(uploadFile
          ? {
              upload_intent: {
                filename: uploadFile.name,
                size_bytes: uploadFile.size,
                role: uploadRole
              }
            }
          : {})
      }
    };
  }

  async function validateManifest() {
    if (!adminToken.trim()) {
      setValidated(false);
      setMessage("Admin API key is required for server-side validation.");
      return false;
    }
    if (!dataset.trim() || !version.trim() || !dataModel.trim() || !backend.trim()) {
      setValidated(false);
      setMessage("Dataset, version, data model, and backend are required.");
      return false;
    }
    if (sourceMode === "upload" && !uploadFile) {
      setValidated(false);
      setMessage("Choose a file before validating an upload release.");
      return false;
    }
    setMessage("Validating manifest on the server.");
    try {
      const report =
        sourceMode === "upload" && uploadFile
          ? await validateUploadDatasetFile(adminToken.trim(), {
              dataset,
              version,
              data_model: dataModel,
              backend,
              role: uploadRole,
              file: uploadFile,
              citation: citation.trim() || null,
              register: true,
              is_default: true,
              metadata: {
                title,
                visibility: "private",
                source_mode: sourceMode,
                publication_state: "draft"
              }
            })
          : await validateIngestManifest(adminToken.trim(), buildPayload());
      setValidationReport(report);
      setValidated(report.valid);
      if (!report.valid) {
        setMessage("Server validation failed. Review the issues below.");
        return false;
      }
      setMessage(
        sourceMode === "upload"
          ? "Server validation passed for the uploaded file."
          : report.queryable
            ? "Server validation passed. Dataset has a queryable source role."
            : "Server validation passed, but this is metadata-only until data is loaded."
      );
      return true;
    } catch (error) {
      setValidated(false);
      setValidationReport(null);
      setMessage(error instanceof Error ? error.message : "Server validation failed.");
      return false;
    }
  }

  async function stageRelease(event: FormEvent) {
    event.preventDefault();
    if (!adminToken.trim()) {
      setMessage("Admin API key is required to publish or register datasets.");
      return;
    }
    if (sourceMode === "upload" && !uploadFile) {
      setMessage("Choose a file before staging an upload release.");
      return;
    }
    if (!(await validateManifest())) {
      return;
    }
    setIsSubmitting(true);
    try {
      const response = sourceMode === "upload" && uploadFile
        ? await uploadDatasetFile(adminToken.trim(), {
            dataset,
            version,
            data_model: dataModel,
            backend,
            role: uploadRole,
            file: uploadFile,
            citation: citation.trim() || null,
            register: true,
            is_default: true,
            metadata: {
              title,
              visibility: "private",
              publication_state: "draft"
            }
          })
        : await publishDatasetRegistration(adminToken.trim(), buildPayload());
      setValidated(true);
      setMessage(`${response.dataset}@${response.version} ${response.registered ? "registered" : "queued"} via ${response.job_id}.`);
      setLastIngest(response);
      await onPublished();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dataset staging failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Badge variant="outline" className="w-fit">
          Publishing workflow
        </Badge>
        <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
          Stage, validate, and release lab datasets
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Register dataset versions through the real ingestion API, then let CLI or workers load backend data.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Manifest", "Create dataset manifest v1", FileUp],
          ["Storage", "Attach matrix, clinical, or SOMA paths", Database],
          ["Validate", "Run schema and release checks", Activity],
          ["Release", "Register a version with citation", Sparkles]
        ].map(([stepTitle, body, Icon], index) => (
          <Card key={stepTitle as string}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="size-4" />
                {stepTitle as string}
              </CardTitle>
              <CardDescription>{body as string}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Badge variant={validated || index < 2 ? "default" : "outline"}>
                {validated || index < 2 ? "ready" : "pending"}
              </Badge>
            </CardFooter>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Stage registry release</CardTitle>
          <CardDescription>
            This form calls the production `/v1/ingest` registration path.
          </CardDescription>
        </CardHeader>
        <form onSubmit={stageRelease}>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="publish-admin-token">Admin API key</FieldLabel>
                <InputGroup className="h-9">
                  <InputGroupInput
                    id="publish-admin-token"
                    type="password"
                    value={adminToken}
                    onChange={(event) => onAdminTokenChange(event.target.value)}
                    placeholder="X-Shennong-Admin-Key"
                  />
                </InputGroup>
                <FieldDescription>Stored only in this browser session state.</FieldDescription>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="publish-dataset">Dataset</FieldLabel>
                  <InputGroup className="h-9">
                    <InputGroupInput id="publish-dataset" value={dataset} onChange={(event) => setDataset(event.target.value)} />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="publish-version">Version</FieldLabel>
                  <InputGroup className="h-9">
                    <InputGroupInput id="publish-version" value={version} onChange={(event) => setVersion(event.target.value)} />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="publish-model">Data model</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={dataModel}
                    onValueChange={(value) => value && changeDataModel(value as DataModel)}
                    variant="outline"
                    size="sm"
                    className="flex-wrap justify-start"
                  >
                    {publishProfiles.map((profile) => (
                      <ToggleGroupItem key={profile.model} value={profile.model}>
                        {profile.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription>{publishProfile.description}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="publish-backend">Backend</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={backend}
                    onValueChange={(value) => value && setBackend(value)}
                    variant="outline"
                    size="sm"
                    className="flex-wrap justify-start"
                  >
                    {publishProfile.backends.map((item) => (
                      <ToggleGroupItem key={item} value={item}>
                        {item}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="publish-title">Title</FieldLabel>
                <InputGroup className="h-9">
                  <InputGroupInput id="publish-title" value={title} onChange={(event) => setTitle(event.target.value)} />
                </InputGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="publish-citation">Citation</FieldLabel>
                <InputGroup className="min-h-20">
                  <InputGroupTextarea
                    id="publish-citation"
                    rows={2}
                    value={citation}
                    onChange={(event) => setCitation(event.target.value)}
                    placeholder="Optional citation or data source note"
                  />
                </InputGroup>
              </Field>
              <div className="grid gap-4 md:grid-cols-[1fr_260px]">
                <Field>
                  <FieldLabel>Source mode</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={sourceMode}
                    onValueChange={(value) => value && setSourceMode(value as SourceMode)}
                    variant="outline"
                    size="sm"
                    className="flex-wrap justify-start"
                  >
                    <ToggleGroupItem value="server_path">Server path</ToggleGroupItem>
                    <ToggleGroupItem value="upload">Upload</ToggleGroupItem>
                    <ToggleGroupItem value="metadata">Metadata</ToggleGroupItem>
                  </ToggleGroup>
                  {sourceMode === "server_path" && (
                    <InputGroup className="mt-2 h-9">
                      <InputGroupInput
                        id="publish-source-path"
                        value={sourcePath}
                        onChange={(event) => setSourcePath(event.target.value)}
                        placeholder={publishProfile.pathPlaceholder}
                      />
                    </InputGroup>
                  )}
                  {sourceMode === "upload" && (
                    <Input
                      id="publish-file"
                      className="mt-2"
                      type="file"
                      onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                    />
                  )}
                  {sourceMode === "metadata" && (
                    <FieldDescription>
                      Registers a metadata-only draft; data can be attached in a later release.
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldLabel>Source role</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={uploadRole}
                    onValueChange={(value) => value && setUploadRole(value)}
                    variant="outline"
                    size="sm"
                    className="flex-wrap justify-start"
                  >
                    {publishProfile.roles.map((role) => (
                      <ToggleGroupItem key={role} value={role}>
                        {role}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              </div>
              <Field>
                <FieldTitle>Release status</FieldTitle>
                <FieldDescription>{message}</FieldDescription>
              </Field>
              {validationReport && (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={validationReport.valid ? "default" : "destructive"}>
                      {validationReport.valid ? "valid" : "invalid"}
                    </Badge>
                    <Badge variant={validationReport.queryable ? "secondary" : "outline"}>
                      {validationReport.queryable ? "queryable" : "not queryable yet"}
                    </Badge>
                    {validationReport.dataset_type && (
                      <Badge variant="outline">{validationReport.dataset_type}</Badge>
                    )}
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <div>
                      Required roles: {validationReport.required_source_roles.join(", ") || "none"}
                    </div>
                    <div>
                      Present roles: {validationReport.present_source_roles.join(", ") || "none"}
                    </div>
                  </div>
                  <ScrollArea className="max-h-44 rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Level</TableHead>
                          <TableHead>Field</TableHead>
                          <TableHead>Message</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validationReport.issues.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground">
                              No validation issues.
                            </TableCell>
                          </TableRow>
                        ) : (
                          validationReport.issues.map((issue, index) => (
                            <TableRow key={`${issue.field}-${index}`}>
                              <TableCell>{issue.level}</TableCell>
                              <TableCell>{issue.field}</TableCell>
                              <TableCell>{issue.message}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                  {validationReport.preview && (
                    <ScrollArea className="max-h-56 rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {validationReport.preview.columns.slice(0, 8).map((column) => (
                              <TableHead key={column}>{column}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {validationReport.preview.sample_rows.map((row, index) => (
                            <TableRow key={index}>
                              {validationReport.preview?.columns.slice(0, 8).map((column) => (
                                <TableCell key={column}>{String(row[column] ?? "")}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </div>
              )}
              {lastIngest?.preview && (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-sm font-medium">Upload preview</div>
                    <div className="text-xs text-muted-foreground">
                      {lastIngest.preview.filename} · {lastIngest.preview.size_bytes} bytes · {lastIngest.preview.columns.length} columns
                    </div>
                  </div>
                  {lastIngest.preview.warnings.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {lastIngest.preview.warnings.join(" ")}
                    </div>
                  )}
                  <ScrollArea className="max-h-56 rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {lastIngest.preview.columns.slice(0, 8).map((column) => (
                            <TableHead key={column}>{column}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lastIngest.preview.sample_rows.map((row, index) => (
                          <TableRow key={index}>
                            {lastIngest.preview?.columns.slice(0, 8).map((column) => (
                              <TableCell key={column}>{String(row[column] ?? "")}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}
            </FieldGroup>
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" type="button" onClick={() => void validateManifest()}>
              <CheckCircle2 data-icon="inline-start" />
              Validate manifest
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <UploadCloud data-icon="inline-start" />}
              Stage release
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

interface AdminPanelProps {
  apiStatus: ApiStatus;
  adminToken: string;
  onAdminTokenChange: (value: string) => void;
}

function AdminPanel({ apiStatus, adminToken, onAdminTokenChange }: AdminPanelProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [message, setMessage] = useState("Enter an admin key to load multi-user state.");
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("curator@example.org");
  const [displayName, setDisplayName] = useState("Dataset Curator");
  const [orgSlug, setOrgSlug] = useState("demo-lab");
  const [orgName, setOrgName] = useState("Demo Lab");

  async function loadOverview() {
    if (!adminToken.trim()) {
      setMessage("Admin API key is required.");
      return;
    }
    setIsLoading(true);
    try {
      const nextOverview = await fetchAdminOverview(adminToken.trim());
      setOverview(nextOverview);
      setMessage("Loaded admin state from /v1/admin.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load admin state.");
    } finally {
      setIsLoading(false);
    }
  }

  async function bootstrap(event: FormEvent) {
    event.preventDefault();
    if (!adminToken.trim()) {
      setMessage("Admin API key is required.");
      return;
    }
    const payload: BootstrapPayload = {
      user: {
        email,
        display_name: displayName,
        is_superuser: true
      },
      organization: {
        slug: orgSlug,
        name: orgName
      }
    };
    setIsLoading(true);
    try {
      const response = await bootstrapAccess(adminToken.trim(), payload);
      setMessage(`${response.user.email} bootstrapped as ${response.membership.role} of ${response.organization.slug}.`);
      setOverview(await fetchAdminOverview(adminToken.trim()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bootstrap failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Badge variant="outline" className="w-fit">
          Admin and access
        </Badge>
        <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
          Multi-user controls for lab publishing
        </h1>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <AdminItem icon={UsersRound} title="Users" body={`${overview?.users.length ?? 0} loaded users.`} />
        <AdminItem icon={KeyRound} title="Organizations" body={`${overview?.organizations.length ?? 0} loaded organizations.`} />
        <AdminItem icon={ShieldCheck} title="Projects" body={`${overview?.projects.length ?? 0} loaded projects.`} />
        <AdminItem
          icon={Settings2}
          title="Backend health"
          body={apiStatus.source === "live" ? "API is connected." : "API is in mock fallback mode."}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Admin API key</CardTitle>
          <CardDescription>Used for `/v1/admin` and `/v1/ingest` calls from this browser session.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="admin-token">X-Shennong-Admin-Key</FieldLabel>
              <InputGroup className="h-9">
                <InputGroupInput
                  id="admin-token"
                  type="password"
                  value={adminToken}
                  onChange={(event) => onAdminTokenChange(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton type="button" onClick={() => void loadOverview()} disabled={isLoading}>
                    {isLoading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ShieldCheck data-icon="inline-start" />}
                    Load
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>{message}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bootstrap lab access</CardTitle>
          <CardDescription>Create a first curator and organization through `/v1/admin/bootstrap`.</CardDescription>
        </CardHeader>
        <form onSubmit={bootstrap}>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="admin-email">Email</FieldLabel>
                  <InputGroup className="h-9">
                    <InputGroupInput id="admin-email" value={email} onChange={(event) => setEmail(event.target.value)} />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="admin-name">Display name</FieldLabel>
                  <InputGroup className="h-9">
                    <InputGroupInput id="admin-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="admin-org-slug">Organization slug</FieldLabel>
                  <InputGroup className="h-9">
                    <InputGroupInput id="admin-org-slug" value={orgSlug} onChange={(event) => setOrgSlug(event.target.value)} />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="admin-org-name">Organization name</FieldLabel>
                  <InputGroup className="h-9">
                    <InputGroupInput id="admin-org-name" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
                  </InputGroup>
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <UsersRound data-icon="inline-start" />}
              Bootstrap
            </Button>
            <Button type="button" variant="outline" onClick={() => void loadOverview()} disabled={isLoading}>
              Refresh overview
            </Button>
          </CardFooter>
        </form>
      </Card>
      {overview && (
        <Card>
          <CardHeader>
            <CardTitle>Audit and access overview</CardTitle>
            <CardDescription>Recent server-side access state from `/v1/admin`.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ScrollArea className="max-h-[220px] rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Display name</TableHead>
                    <TableHead>Superuser</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.users.map((user) => (
                    <TableRow key={user.user_id}>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.display_name}</TableCell>
                      <TableCell>{user.is_superuser ? "yes" : "no"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            <ScrollArea className="max-h-[220px] rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.events.map((event) => (
                    <TableRow key={event.event_id}>
                      <TableCell>{event.action}</TableCell>
                      <TableCell>{event.resource_type}/{event.resource_id}</TableCell>
                      <TableCell>{event.created_at ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ContextPanel({
  dataset,
  gene,
  onGeneChange,
  queryResult,
  onNavigate
}: {
  dataset?: DatasetSummary;
  gene: string;
  onGeneChange: (gene: string) => void;
  queryResult: QueryResponse | null;
  onNavigate: (section: Section) => void;
}) {
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [schema, setSchema] = useState<DatasetSchema | null>(null);
  const [capabilityInfo, setCapabilityInfo] = useState<DatasetCapabilities | null>(null);
  const [fields, setFields] = useState<CatalogField[]>([]);
  const [catalogMessage, setCatalogMessage] = useState("Catalog metadata has not been loaded.");

  useEffect(() => {
    if (!dataset) {
      setDetail(null);
      setSchema(null);
      setCapabilityInfo(null);
      setFields([]);
      setCatalogMessage("No dataset selected.");
      return;
    }
    let active = true;
    const version = dataset.default_version ?? "latest";
    setCatalogMessage("Loading schema and capabilities.");
    void Promise.all([
      fetchDatasetDetail(dataset.dataset),
      fetchDatasetSchema(dataset.dataset, version),
      fetchDatasetCapabilities(dataset.dataset, version),
      fetchDatasetFields(dataset.dataset, version)
    ])
      .then(([nextDetail, nextSchema, nextCapabilities, nextFields]) => {
        if (!active) {
          return;
        }
        setDetail(nextDetail);
        setSchema(nextSchema);
        setCapabilityInfo(nextCapabilities);
        setFields(nextFields);
        setCatalogMessage("Release metadata loaded from catalog.");
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setDetail(null);
        setSchema(null);
        setCapabilityInfo(null);
        setFields([]);
        setCatalogMessage(error instanceof Error ? error.message : "Catalog metadata is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [dataset?.dataset, dataset?.default_version]);

  if (!dataset) {
    return (
      <Card>
        <CardContent>
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  }
  const activeVersion = detail?.default_version ?? dataset.default_version ?? "latest";
  return (
    <Card className="xl:sticky xl:top-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4" />
          {detail?.title ?? dataset.title}
        </CardTitle>
        <CardDescription>{dataset.dataset}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={detail?.visibility === "public" ? "default" : "outline"}>
            {detail?.visibility ?? dataset.visibility}
          </Badge>
          <Badge variant="secondary">{detail?.data_model ?? dataset.data_model}</Badge>
          <Badge variant="outline">{detail?.publication_state ?? "loading"}</Badge>
        </div>
        {detail?.description && (
          <p className="text-sm text-muted-foreground">{detail.description}</p>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="context-gene">Focus gene</FieldLabel>
            <InputGroup className="h-9">
              <InputGroupInput
                id="context-gene"
                value={gene}
                onChange={(event) => onGeneChange(event.target.value)}
              />
            </InputGroup>
          </Field>
        </FieldGroup>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoCell label="Version" value={activeVersion} />
          <InfoCell label="Backend" value={detail?.backend ?? dataset.backend} />
          <InfoCell label="Rows" value={String(queryResult?.meta.n_rows ?? "pending")} />
          <InfoCell label="Status" value={detail?.status ?? "loading"} />
        </div>
        {detail && (
          <div className="flex flex-col gap-2 rounded-lg border p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Release</span>
              <Badge variant="outline">{detail.versions.length} version{detail.versions.length === 1 ? "" : "s"}</Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {detail.versions.map((version) => (
                <Badge key={version} variant={version === activeVersion ? "default" : "secondary"}>
                  {version}
                </Badge>
              ))}
            </div>
            <div className="text-muted-foreground">
              Source roles: {detail.source_roles.length ? detail.source_roles.join(", ") : "not published"}
            </div>
            {detail.citation && <div className="text-muted-foreground">Citation: {detail.citation}</div>}
            {detail.license && <div className="text-muted-foreground">License: {detail.license}</div>}
          </div>
        )}
        <Separator />
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-sm font-medium">Catalog schema</div>
            <div className="text-xs text-muted-foreground">{catalogMessage}</div>
          </div>
          {schema && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoCell label="Observation" value={schema.observation?.type ?? "unknown"} />
              <InfoCell label="Feature" value={schema.feature?.type ?? "unknown"} />
              <InfoCell label="Layers" value={(schema.layers ?? []).join(", ") || "none"} />
              <InfoCell label="Shapes" value={(schema.return_shapes ?? []).join(", ") || "none"} />
            </div>
          )}
          {capabilityInfo && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(capabilityInfo)
                .filter(([key, value]) => key.startsWith("can_") && value === true)
                .slice(0, 8)
                .map(([key]) => (
                  <Badge key={key} variant="secondary">
                    {key.replace(/^can_/, "").replace(/_/g, " ")}
                  </Badge>
                ))}
            </div>
          )}
          {fields.length > 0 && (
            <ScrollArea className="max-h-44 rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.slice(0, 8).map((field) => (
                    <TableRow key={`${field.scope}-${field.field}`}>
                      <TableCell>{field.field}</TableCell>
                      <TableCell>{field.type}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
        <Separator />
        <Tabs defaultValue="r">
          <TabsList className="w-full">
            <TabsTrigger value="r">R</TabsTrigger>
            <TabsTrigger value="api">API</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
          </TabsList>
          <TabsContent value="r" className="mt-2">
            <pre className="max-h-52 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
              <code>{rSnippet(dataset, gene)}</code>
            </pre>
          </TabsContent>
          <TabsContent value="api" className="mt-2">
            <pre className="max-h-52 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
              <code>{apiSnippet(dataset, gene)}</code>
            </pre>
          </TabsContent>
          <TabsContent value="agent" className="mt-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
              {agentPrompt(dataset, gene)}
            </div>
          </TabsContent>
        </Tabs>
        <Separator />
        <Button className="w-full justify-start" type="button" variant="outline" onClick={() => onNavigate("agent")}>
          <Bot data-icon="inline-start" />
          Chat with dataset
        </Button>
        <Button className="w-full justify-start" type="button" variant="outline" onClick={() => onNavigate("publish")}>
          <Table2 data-icon="inline-start" />
          View release plan
        </Button>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function AdminItem({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4" />
          {title}
        </CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default App;
