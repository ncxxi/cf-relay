import { RelayError } from "./errors";

export function checkRelayKey(provided: string | null, relayKey: string): void {
  if (relayKey === "") return;
  if (provided === null) throw new RelayError("AUTH_REQUIRED", "relay key required");
  if (provided !== relayKey) throw new RelayError("AUTH_FAILED", "invalid relay key");
}
