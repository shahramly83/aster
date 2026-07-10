import { describe, it, expect } from "vitest";
import { verify, hmacHex, timingSafeEqual, TOLERANCE_SECONDS } from "./stripe-sig.ts";

const SECRET = "whsec_test_deadbeef";
const NOW = 1_700_000_000;
const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

// Build the header Stripe would send for a given body/time/secret.
async function sign(payload: string, t: number, secret = SECRET) {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}

describe("stripe signature verify", () => {
  it("accepts a correctly signed, fresh event", async () => {
    expect(await verify(body, await sign(body, NOW), SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered body (the whole point)", async () => {
    const header = await sign(body, NOW);
    const forged = JSON.stringify({ id: "evt_1", type: "invoice.paid", amount: 999999 });
    expect(await verify(forged, header, SECRET, NOW)).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const header = await sign(body, NOW, "whsec_attacker");
    expect(await verify(body, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a replay outside the 300s window", async () => {
    const header = await sign(body, NOW);                       // signed at NOW
    const later = NOW + TOLERANCE_SECONDS + 1;                  // captured, replayed 5m1s later
    expect(await verify(body, header, SECRET, later)).toBe(false);
  });

  it("accepts right at the tolerance edge", async () => {
    const header = await sign(body, NOW);
    expect(await verify(body, header, SECRET, NOW + TOLERANCE_SECONDS)).toBe(true);
  });

  it("rejects a future timestamp beyond tolerance (forward skew)", async () => {
    const header = await sign(body, NOW + TOLERANCE_SECONDS + 1);
    expect(await verify(body, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a signature whose t was altered (t is authenticated)", async () => {
    // Take a valid header, then lie about the timestamp. The HMAC covered the
    // original t, so moving it invalidates the signature.
    const header = await sign(body, NOW);
    const moved = header.replace(`t=${NOW}`, `t=${NOW + 1}`);
    expect(await verify(body, moved, SECRET, NOW + 1)).toBe(false);
  });

  it("rejects malformed / empty headers", async () => {
    for (const h of ["", "garbage", "t=,v1=", `v1=${await hmacHex(SECRET, `${NOW}.${body}`)}`, `t=${NOW}`]) {
      expect(await verify(body, h, SECRET, NOW)).toBe(false);
    }
  });

  it("accepts when any one of several v1 signatures matches (key rotation)", async () => {
    const good = await hmacHex(SECRET, `${NOW}.${body}`);
    const header = `t=${NOW},v1=deadbeef,v1=${good}`;
    expect(await verify(body, header, SECRET, NOW)).toBe(true);
  });
});

describe("timingSafeEqual", () => {
  it("true only for identical equal-length strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });
  it("false for different lengths without throwing", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "x")).toBe(false);
  });
});
