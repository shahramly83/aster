import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, planLimits, PLAN_TIER_ALIASES } from "./plan.js";

describe("planLimits — fails closed", () => {
  // The bug that started this whole audit: the fallback was PLAN_LIMITS.professional
  // (later renamed away, so `undefined`), which meant an unknown tier silently got
  // the MOST generous limits. It must fall back to the LEAST generous.
  it("an unknown tier gets Launch limits, never Elite", () => {
    for (const bad of ["", "free", "growth", "pro", "professional", "starter", "nonsense", null, undefined]) {
      const L = planLimits(bad);
      expect(L).toBe(PLAN_LIMITS.launch);
      expect(L.maxJobs).toBe(1);            // launch, not elite's 10
      expect(L.aiRunsPerMonth).toBe(5);     // launch, not elite's 100
    }
  });

  it("never returns undefined (the crash that surfaced the bug)", () => {
    for (const p of ["launch", "scale", "elite", "enterprise", "???"]) {
      expect(planLimits(p)).toBeTruthy();
      expect(typeof planLimits(p).resumeUploads).toBe("number");
    }
  });

  it("known tiers resolve to their own row", () => {
    expect(planLimits("launch")).toBe(PLAN_LIMITS.launch);
    expect(planLimits("scale")).toBe(PLAN_LIMITS.scale);
    expect(planLimits("elite")).toBe(PLAN_LIMITS.elite);
    expect(planLimits("enterprise")).toBe(PLAN_LIMITS.enterprise);
  });
});

describe("plan tiers are strictly increasing where they should be", () => {
  it("limits rise launch -> scale -> elite", () => {
    const order = ["launch", "scale", "elite"];
    for (const key of ["maxJobs", "parseApplicant", "resumeUploads", "aiRunsPerMonth", "aiInsightsPerMonth"]) {
      const vals = order.map((t) => PLAN_LIMITS[t][key]);
      expect(vals[0]).toBeLessThan(vals[1]);
      expect(vals[1]).toBeLessThan(vals[2]);
    }
  });

  it("enterprise is unlimited on every metered dimension", () => {
    const e = PLAN_LIMITS.enterprise;
    for (const key of ["maxJobs", "seats", "parseApplicant", "resumeUploads", "aiRunsPerMonth"]) {
      expect(e[key]).toBe(Infinity);
    }
  });
});

describe("PLAN_TIER_ALIASES — tolerate a pre-0040 database", () => {
  it("maps the old enum labels to the new ones", () => {
    expect(PLAN_TIER_ALIASES.free).toBe("launch");
    expect(PLAN_TIER_ALIASES.growth).toBe("scale");
    expect(PLAN_TIER_ALIASES.pro).toBe("elite");
  });

  it("an aliased old value resolves to a real limit row", () => {
    // loadCustomerSession does: PLAN_TIER_ALIASES[co.plan] || co.plan || "launch"
    const resolve = (dbValue) => planLimits(PLAN_TIER_ALIASES[dbValue] || dbValue || "launch");
    expect(resolve("growth")).toBe(PLAN_LIMITS.scale);
    expect(resolve("pro")).toBe(PLAN_LIMITS.elite);
    expect(resolve("launch")).toBe(PLAN_LIMITS.launch);
    expect(resolve(null)).toBe(PLAN_LIMITS.launch);
  });
});
