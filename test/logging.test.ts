import { describe, it, expect, vi } from "vitest";
import { log } from "../src/logging.js";

describe("Logging", () => {
  it("logs to stdout with timestamp and category", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("act", "test message", { key: "value" });
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(output).toContain("[act]");
    expect(output).toContain("test message");
    expect(output).toContain('"key":"value"');
    spy.mockRestore();
  });

  it("logs without data", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("scene", "loaded");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("[scene]");
    expect(output).toContain("loaded");
    expect(output).not.toContain("{");
    spy.mockRestore();
  });
});
