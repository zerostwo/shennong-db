import { Database, Layers3, Loader2, Play, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ApiStatus,
  DatasetSummary,
  QueryResponse,
  buildMockQuery,
  fetchDatasets,
  queryDataset
} from "./lib/api";

type Section = "resources" | "explore";

function routeFromLocation(): Section {
  return typeof window !== "undefined" && window.location.pathname === "/explore" ? "explore" : "resources";
}

function App() {
  const [section, setSection] = useState<Section>(routeFromLocation);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedId, setSelectedId] = useState("toil");
  const [search, setSearch] = useState("");
  const [gene, setGene] = useState("ENSG00000242268.2");
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [status, setStatus] = useState<ApiStatus>({ ok: false, source: "mock", message: "Loading" });

  useEffect(() => {
    void fetchDatasets().then(({ datasets: nextDatasets, status: nextStatus }) => {
      setDatasets(nextDatasets);
      setStatus(nextStatus);
      if (nextDatasets.length && !nextDatasets.some((dataset) => dataset.dataset === selectedId)) {
        setSelectedId(nextDatasets[0].dataset);
      }
    });
  }, []);

  const selected = datasets.find((dataset) => dataset.dataset === selectedId) ?? datasets[0];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? datasets.filter((dataset) => `${dataset.dataset} ${dataset.title} ${dataset.data_model}`.toLowerCase().includes(term))
      : datasets;
  }, [datasets, search]);

  function navigate(next: Section) {
    setSection(next);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", next === "explore" ? "/explore" : "/");
    }
  }

  async function runQuery() {
    if (!selected) return;
    setIsQuerying(true);
    try {
      setResult(await queryDataset(selected, gene));
    } catch (error) {
      setResult(buildMockQuery(selected, gene));
      setStatus((current) => ({
        ...current,
        message: error instanceof Error ? error.message : "Query adapter unavailable"
      }));
    } finally {
      setIsQuerying(false);
    }
  }

  const columns = result?.meta.columns ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 lg:grid-cols-[220px_1fr]">
        <aside className="border-b bg-sidebar p-4 lg:border-r lg:border-b-0">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary font-semibold text-sidebar-primary-foreground">S</div>
            <div>
              <p className="font-semibold">ShennongDB</p>
              <p className="text-xs text-muted-foreground">Resource API v1</p>
            </div>
          </div>
          <div className="flex gap-2 lg:flex-col">
            <Button className="justify-start" variant={section === "resources" ? "secondary" : "ghost"} onClick={() => navigate("resources")}>
              <Database data-icon="inline-start" /> Resources
            </Button>
            <Button className="justify-start" variant={section === "explore" ? "secondary" : "ghost"} onClick={() => navigate("explore")}>
              <Layers3 data-icon="inline-start" /> Explore
            </Button>
          </div>
          <Badge className="mt-8" variant={status.source === "live" ? "default" : "outline"}>
            {status.source === "live" ? "Live API" : "Mock mode"}
          </Badge>
        </aside>

        <section className="p-4 md:p-8">
          <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{section === "resources" ? "Resources" : "Explore resource"}</h1>
              <p className="text-sm text-muted-foreground">{status.message}</p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search resources" />
            </div>
          </header>

          {section === "resources" ? (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((dataset) => (
                <Card key={dataset.dataset} className={dataset.dataset === selectedId ? "border-primary" : undefined}>
                  <CardHeader>
                    <CardTitle>{dataset.title}</CardTitle>
                    <CardDescription>{dataset.dataset}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2"><Badge variant="secondary">{dataset.data_model}</Badge><Badge variant="outline">{dataset.visibility}</Badge></div>
                    <Button size="sm" onClick={() => { setSelectedId(dataset.dataset); navigate("explore"); }}>Explore</Button>
                  </CardContent>
                </Card>
              ))}
              {!filtered.length && <Card><CardContent className="p-6 text-sm text-muted-foreground">No matching resources.</CardContent></Card>}
            </div>
          ) : selected ? (
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>{selected.title}</CardTitle>
                  <CardDescription>{selected.dataset} - {selected.backend} - {selected.default_version ?? "latest"}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row">
                  <Input value={gene} onChange={(event) => setGene(event.target.value)} aria-label="Gene symbol" />
                  <Button disabled={isQuerying} onClick={() => void runQuery()}>
                    {isQuerying ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Play data-icon="inline-start" />} Query expression
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Query result</CardTitle>
                  <CardDescription>{result ? `${result.meta.n_rows} rows from ${result.meta.backend}` : "Run a bounded expression query."}</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {result ? <Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{result.data.slice(0, 20).map((row, index) => <TableRow key={index}>{columns.map((column) => <TableCell key={column}>{String(row[column] ?? "")}</TableCell>)}</TableRow>)}</TableBody></Table> : null}
                </CardContent>
              </Card>
            </div>
          ) : <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading resources.</CardContent></Card>}
        </section>
      </div>
    </main>
  );
}

export default App;
