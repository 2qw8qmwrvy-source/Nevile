import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConsoleEmailSender,
  createConsoleSmsSender,
  type DevOutboxMessage,
  devOutboxDirFromEnv,
} from "./senders.ts";

const quiet = () => {};

describe("dev outbox", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nevile-outbox-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function outbox(directory = dir): Promise<DevOutboxMessage[]> {
    const names = (await readdir(directory)).sort();
    return Promise.all(
      names.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))),
    );
  }

  it("writes each email and SMS as a JSON file when configured", async () => {
    const target = join(dir, "nested", "outbox");
    const email = createConsoleEmailSender(quiet, { outboxDir: target });
    const sms = createConsoleSmsSender(quiet, { outboxDir: target });

    await email.send({
      to: "maya@example.com",
      subject: "Confirm your email for Nevile",
      text: "Hi,\nConfirm: http://localhost:3000/verify-email?token=abc.def&x=1\nThanks",
      html: "<p>ignored</p>",
    });
    await sms.send({
      to: "+19025550123",
      body: "123456 is your Nevile sign-in code. It expires in 5 minutes.",
    });

    const names = await readdir(target);
    expect(names).toHaveLength(2);
    expect(names.every((name) => /^\d+-(email|sms)-[0-9a-f-]{36}\.json$/.test(name))).toBe(true);

    const messages = await outbox(target);
    const sent = messages.find((message) => message.kind === "email");
    expect(sent).toEqual({
      kind: "email",
      to: "maya@example.com",
      subject: "Confirm your email for Nevile",
      text: "Hi,\nConfirm: http://localhost:3000/verify-email?token=abc.def&x=1\nThanks",
      links: ["http://localhost:3000/verify-email?token=abc.def&x=1"],
      sentAt: expect.any(String),
    });
    expect(messages.find((message) => message.kind === "sms")).toMatchObject({
      to: "+19025550123",
      subject: "SMS",
      links: [],
      code: "123456",
    });
  });

  it("writes nothing when no directory is configured", async () => {
    const lines: string[] = [];
    await createConsoleEmailSender((line) => lines.push(line)).send({
      to: "a@example.com",
      subject: "Hello",
      text: "Body",
    });
    await createConsoleSmsSender((line) => lines.push(line)).send({
      to: "+19025550123",
      body: "654321 is your code",
    });
    expect(lines).toHaveLength(2);
    expect(await readdir(dir)).toEqual([]);
  });

  it("is never active in production", () => {
    expect(devOutboxDirFromEnv({ NEVILE_DEV_OUTBOX_DIR: dir, NODE_ENV: "production" })).toBe(
      undefined,
    );
    expect(devOutboxDirFromEnv({ NEVILE_DEV_OUTBOX_DIR: ` ${dir} `, NODE_ENV: "test" })).toBe(dir);
    expect(devOutboxDirFromEnv({ NEVILE_DEV_OUTBOX_DIR: "  " })).toBe(undefined);
    expect(devOutboxDirFromEnv({})).toBe(undefined);

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => createConsoleEmailSender(quiet, { outboxDir: dir })).toThrow(/production/);
      expect(() => createConsoleSmsSender(quiet, { outboxDir: dir })).toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
