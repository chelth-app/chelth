import { afterEach, describe, expect, it } from "vitest";

import { logger, setLogLevel, setLogSinks, type LogRecord } from "@/lib/logging";

describe("logger", () => {
  afterEach(() => {
    setLogLevel("info");
  });

  it("redacts context before it reaches any sink", () => {
    const records: LogRecord[] = [];
    setLogSinks([(record) => records.push(record)]);
    logger.info("sign-in attempt", { email: "a@b.com", password: "pw", attempt: 2 });
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records[0])).not.toContain("a@b.com");
    expect(JSON.stringify(records[0])).not.toContain('"pw"');
    expect(records[0]?.context).toMatchObject({ attempt: 2 });
  });

  it("respects the minimum level", () => {
    const records: LogRecord[] = [];
    setLogSinks([(record) => records.push(record)]);
    setLogLevel("warn");
    logger.info("ignored");
    logger.error("kept");
    expect(records.map((record) => record.message)).toEqual(["kept"]);
  });

  it("isolates failing sinks", () => {
    const records: LogRecord[] = [];
    setLogSinks([
      () => {
        throw new Error("sink down");
      },
      (record) => records.push(record),
    ]);
    expect(() => logger.error("still logged")).not.toThrow();
    expect(records).toHaveLength(1);
  });
});
