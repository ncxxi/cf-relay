import { describe, expect, it } from "vitest";
import { guardTarget, type TargetPolicy } from "../../src/target";

const policy: TargetPolicy = { allowPrivate: false, denyHosts: [] };

function check(url: string, override: Partial<TargetPolicy> = {}): void {
  guardTarget(new URL(url), { ...policy, ...override });
}

describe("guardTarget", () => {
  it("allows public targets", () => {
    expect(() => check("https://example.com/path")).not.toThrow();
    expect(() => check("http://8.8.8.8/")).not.toThrow();
    expect(() => check("http://172.32.0.1/")).not.toThrow();
    expect(() => check("http://100.128.0.1/")).not.toThrow();
    expect(() => check("http://[::ffff:8.8.8.8]/")).not.toThrow();
  });

  it("blocks private and reserved addresses", () => {
    const blocked = [
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.10/",
      "http://172.16.4.1/",
      "http://172.31.255.255/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://localhost/",
      "http://api.local/",
      "http://metadata.internal/",
    ];
    for (const url of blocked) {
      expect(() => check(url), url).toThrow();
    }
  });

  it("allows private targets when explicitly enabled", () => {
    expect(() => check("http://127.0.0.1:8787/", { allowPrivate: true })).not.toThrow();
  });

  it("applies the deny list to hosts and subdomains", () => {
    const denyHosts = ["*.workers.dev", "internal.example.com"];
    expect(() => check("https://evil.workers.dev/x", { denyHosts })).toThrow();
    expect(() => check("https://workers.dev/x", { denyHosts })).toThrow();
    expect(() => check("https://notworkers.dev/x", { denyHosts })).not.toThrow();
    expect(() => check("https://api.internal.example.com/x", { denyHosts })).toThrow();
  });

  it("rejects unsupported schemes", () => {
    expect(() => check("ftp://example.com/")).toThrow();
  });
});
