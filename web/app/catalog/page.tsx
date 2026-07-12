import { CatalogView } from "@/components/catalog-view";
import { Suspense } from "react";

export default function CatalogPage() {
  return <Suspense fallback={<main className="catalog-page"><div className="table-empty">Loading catalog…</div></main>}><CatalogView /></Suspense>;
}
