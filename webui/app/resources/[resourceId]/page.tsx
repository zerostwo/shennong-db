import { ResourcePageView } from "@/components/resource-page-view";

export default async function ResourcePage({ params }: { params: Promise<{ resourceId: string }> }) {
  const { resourceId } = await params;
  return <ResourcePageView id={resourceId} />;
}
