import { createElement } from "react";
import { reownReady } from "@/lib/reown";

// Mounts the Reown AppKit modal web component once AppKit is initialized. When
// Reown is not configured, renders nothing so the rest of the app is unaffected.
export default function ReownMount() {
  if (!reownReady) return null;
  return createElement("appkit-modal");
}