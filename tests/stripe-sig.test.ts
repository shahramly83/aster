// The Stripe webhook signature verifier is the only thing between the public
// internet and "mark this workspace paid". These tests forge signatures at it.
//
// It shipped for weeks parsing the timestamp and throwing it away, which meant a
// single captured (body, signature) pair stayed valid forever. `replays a
// captured signature` is the regression test for that.
import { describe, it, expect } from "vitest";
import { verify, hmacHex, timingSafeEqual, TOLERANCE_SECONDS } from "../supabase/functions/_shared/stripe-sig.ts";

const SECRET = "whsec_test_do_not_use_in_production";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const NOW = 1_800_000_000;

const sign = async (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;

describe("verify", () => {
  it("accepts a well-formed, current signature", async () => {
    expect(await verify(BODY, await sign(BODY, NOW), SECRET, NOW)).toBe(true);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const header = await sign(BODY, NOW, "whsec_attacker");
    expect(await verify(BODY, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a tampered body (the signature covers it)", async () => {
    const header = await sign(BODY, NOW);
    const tampered = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
    expect(await verify(tampered, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a tampered timestamp (the signature covers it too)", async () => {
    const header = await sign(BODY, NOW);
    const moved = header.replace(`t=${NOW}`, `t=${NOW + 1}`);
    expect(await verify(BODY, moved, SECRET, NOW)).toBe(false);
  });

  // The bug this whole file exists for.
  it("replays a captured signature: valid inside the window, dead outside it", async () => {
    const header = await sign(BODY, NOW);
    expect(await verify(BODY, header, SECRET, NOW + TOLERANCE_SECONDS - 1)).toBe(true);
    expect(await verify(BODY, header, SECRET, NOW + T