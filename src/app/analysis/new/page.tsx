import { ConfirmClient } from "./confirm-client";
export default async function ConfirmAnalysis({ searchParams }: { searchParams: Promise<{ repository?: string }> }) { const { repository = "" } = await searchParams; return <ConfirmClient repository={repository}/>; }
