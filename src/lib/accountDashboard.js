// Frontend wrapper for the account dashboard backend function.
import { base44 } from "@/api/base44Client";

export async function getAccountDashboard() {
  const res = await base44.functions.invoke("getAccountDashboard");
  return res?.data;
}