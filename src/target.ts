import { RelayError } from "./errors";

export interface TargetPolicy {
  allowPrivate: boolean;
  denyHosts: string[];
}

export function guardTarget(target: URL, policy: TargetPolicy): void {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new RelayError("BAD_TARGET", `unsupported scheme "${target.protocol}"`);
  }

  const host = target.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (matchesAny(host, policy.denyHosts)) {
    throw new RelayError("BLOCKED_TARGET", `host "${host}" is denied`);
  }
  if (!policy.allowPrivate && isPrivateHost(host)) {
    throw new RelayError("BLOCKED_TARGET", `host "${host}" is local or private`);
  }
}

function matchesAny(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const base = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
    return host === base || host.endsWith(`.${base}`);
  });
}

function isPrivateHost(host: string): boolean {
  if (host.includes(":")) return isPrivateIPv6(host);
  const ipv4 = parseIPv4(host);
  if (ipv4) return isPrivateIPv4(ipv4);
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");
}

type IPv4 = [number, number, number, number];

function parseIPv4(host: string): IPv4 | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets as IPv4;
}

function isPrivateIPv4(ip: IPv4): boolean {
  const [a, b, c] = ip;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  if (/^f[cd]/.test(host)) return true;
  if (/^fe[89ab]/.test(host)) return true;

  const mapped = /^::ffff:(.+)$/.exec(host);
  if (!mapped) return false;

  const rest = mapped[1] ?? "";
  const dotted = parseIPv4(rest);
  if (dotted) return isPrivateIPv4(dotted);

  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!hex) return false;
  const hi = parseInt(hex[1] ?? "0", 16);
  const lo = parseInt(hex[2] ?? "0", 16);
  return isPrivateIPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
}
