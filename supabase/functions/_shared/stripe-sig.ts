// Stripe webhook signature verification.
// ---------------------------------------------------------------------------
// Extracted from stripe-webhook so it can be tested. This function is the only
// thing standing between the public internet and "mark this workspace paid", so
// it is worth having tests that actually forge signatures at it.
//
// Stripe-Signature: "t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>...]"
// The HMAC covers `${t}.${body}`, so the timestamp is authenticated — but a
// signature with no tolerance check stays valid forever, which is why Stripe's
// own SDKs reject anything older than 300 seconds.

export const TOLERANCE_SECONDS = 300;

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Length-independent compare. `a === b` short-circuits on the first differing
 * byte, which leaks how much of a forged signature was correct.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param nowSeconds injectable clock, so tolerance is testable without sleeping.
 */
export async function verify(
  payload: string,
  header: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;

  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find((p) => p[0] === "t")?.[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || !sigs.length) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  // Reject the future too: a clock-skewed or forged forward timestamp would
  // otherwise stay valid for as long as it is ahead of us.
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => timingSafeEqual(s, expected));
}
