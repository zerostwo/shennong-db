import { Suspense } from "react";
import { CatalogView } from "@/components/catalog-view";

export default function ResourcesPage() {
  return <Suspense fallback={<main className="catalog-page"><div className="table-empty">Loading Resources…</div></main>}><CatalogView /></Suspense>;
}
