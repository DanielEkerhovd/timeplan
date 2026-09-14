import { describe, expect, it } from "vitest";
import { readState, signState, verifyDiscordSignature } from "../../../api/_lib/crypto";
import { addDays, isoWeek, localNow, localToInstant, mondayOf, timeToMinutes } from "../../../api/_lib/time";
import { buildWeekMessage, pingLine } from "../../../api/_lib/message";
import type { BotWeek } from "../../../api/_lib/message";

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

describe("Discord signature", () => {
  it("accepts a real Ed25519 signature over timestamp + body, and nothing else", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = hex(await crypto.subtle.exportKey("raw", kp.publicKey));
    const body = '{"type":1}';
    const ts = "1726340400";
    const sig = hex(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(ts + body)));
    expect(await verifyDiscordSignature(pub, sig, ts, body)).toBe(true);
    expect(await verifyDiscordSignature(pub, sig, ts, body + " ")).toBe(false);
    expect(await verifyDiscordSignature(pub, sig, "1726340401", body)).toBe(false);
    expect(await verifyDiscordSignature(pub, "00" + sig.slice(2), ts, body)).toBe(false);
    expect(await verifyDiscordSignature(pub, "nope", ts, body)).toBe(false);
  });
});

describe("install state", () => {
  it("round-trips and rejects tampering and expiry", async () => {
    const s = await signState("secret", { team: "t", user: "u" }, 60);
    expect(await readState("secret", s)).toMatchObject({ team: "t", user: "u" });
    expect(await readState("other", s)).toBeNull();
    const [body, sig] = s.split(".");
    expect(await readState("secret", body + "x." + sig)).toBeNull();
    const old = await signState("secret", { team: "t" }, -1);
    expect(await readState("secret", old)).toBeNull();
  });
});

describe("team clock", () => {
  it("turns a local hour into the right instant across DST", () => {
    // Oslo is UTC+2 in September, UTC+1 in December.
    expect(localToInstant("2026-09-15", 20, 0, "Europe/Oslo").toISOString()).toBe("2026-09-15T18:00:00.000Z");
    expect(localToInstant("2026-12-15", 20, 0, "Europe/Oslo").toISOString()).toBe("2026-12-15T19:00:00.000Z");
    expect(localToInstant("2026-09-15", 20, 0, "America/New_York").toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });
  it("knows what day it is for the team, not for the server", () => {
    // 23:30 UTC on a Sunday is already Monday 01:30 in Oslo.
    const n = localNow("Europe/Oslo", new Date("2026-09-13T23:30:00Z"));
    expect(n).toEqual({ dateKey: "2026-09-14", isodow: 1, minutes: 90 });
  });
  it("picks the week for the post: Sunday → next week, Monday → this week", () => {
    expect(mondayOf(addDays("2026-09-13", 1))).toBe("2026-09-14");
    expect(mondayOf(addDays("2026-09-14", 1))).toBe("2026-09-14");
    expect(mondayOf(addDays("2026-09-19", 1))).toBe("2026-09-14");
    expect(isoWeek("2026-09-14")).toEqual({ year: 2026, week: 38 });
    expect(timeToMinutes("20:00:00")).toBe(1200);
  });
});

const week: BotWeek = {
  team: { id: "11111111-1111-4111-8111-111111111111", name: "Dogs", timezone: "Europe/Oslo" },
  week_start: "2026-09-14",
  members: [
    { name: "Per", discord_id: "100" },
    { name: "Kari", discord_id: null },
  ],
  events: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      date: "2026-09-15",
      start_hour: 20,
      end_hour: 23,
      title: "Scrim",
      opponent: "Foxes",
      color: "yellow",
      people: [{ name: "Per", discord_id: "100" }, { name: "Kari", discord_id: null }],
    },
  ],
};

describe("week message", () => {
  it("is a header card, one card per session in its own colour, and no pings on edit", () => {
    const msg = buildWeekMessage(week, { ping: null, link: null, appUrl: "https://x.test" }) as {
      flags: number;
      allowed_mentions: { parse: string[]; users?: string[] };
      components: { type: number; accent_color?: number; content?: string; components?: { type: number; content?: string; components?: { custom_id: string }[] }[] }[];
    };
    expect(msg.flags).toBe(1 << 15);
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    const [header, card, footer] = msg.components;
    expect(header.components?.[0].content).toContain("# Dogs · Week 38");
    expect(header.components?.[0].content).toContain("1 session");
    expect(card.accent_color).toBe(0xf0cf7e); // yellow, like the app
    const text = card.components?.[0].content ?? "";
    expect(text).toContain("## Scrim vs Foxes");
    expect(text).toContain("**Tuesday** <t:1789495200:t> – <t:1789506000:t>  ·  <@100> Kari");
    const row = card.components?.find((b) => b.type === 1);
    expect(row?.components?.map((c) => c.custom_id)).toEqual([`join:${week.events[0].id}`, `cant:${week.events[0].id}`]);
    expect(footer.content).toContain("Open in Gather");
  });
  it("never exceeds Discord's 40-component cap, even with a ping and a full week", () => {
    const busy: BotWeek = { ...week, events: Array.from({ length: 12 }, (_, i) => ({ ...week.events[0], id: `${i}2222222-2222-4222-8222-222222222222`.slice(0, 36), date: "2026-09-15" })) };
    const msg = buildWeekMessage(busy, { ping: "<@100> the week is up.", link: null, appUrl: "https://x.test" }) as { components: unknown[] };
    const count = (nodes: unknown[]): number => nodes.reduce<number>((n, c) => n + 1 + count(((c as { components?: unknown[] }).components ?? [])), 0);
    expect(count(msg.components)).toBeLessThanOrEqual(40);
    const text = JSON.stringify(msg);
    expect(text).toContain("+5 more in the app");
  });
  it("only the fresh weekly post pings, and only who the team chose", () => {
    const link = { team_id: "t", guild_id: "9", guild_name: null, ping_mode: "members" as const, ping_role_id: null, managed_role: false };
    const ping = pingLine(week, link);
    expect(ping).toBe("<@100> the week is up.");
    const msg = buildWeekMessage(week, { ping, link, appUrl: 'https://x.test' }) as { allowed_mentions: { users?: string[]; roles?: string[] } };
    expect(msg.allowed_mentions.users).toEqual(["100"]);
    const role = buildWeekMessage(week, { ping: "x", link: { ...link, ping_mode: "role", ping_role_id: "555" }, appUrl: "https://x.test" }) as { allowed_mentions: { roles?: string[] } };
    expect(role.allowed_mentions.roles).toEqual(["555"]);
    expect(pingLine(week, { ...link, ping_mode: "role", ping_role_id: "555" })).toBe("<@&555> the week is up.");
  });
});
