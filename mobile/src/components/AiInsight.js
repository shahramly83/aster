// AI Insight — the candidate deep-dive that mirrors the web profile: experience
// insights (total / leadership / domain, startup / enterprise / remote flags)
// and employment analysis (employers, tenure, career progression, gaps).
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { fmtYears, fmtMonths } from "@aster/shared";
import { Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

// One fact per line: label left, value right. Every figure used to sit in its
// own filled, bordered tile inside an already-bordered card, two to a row —
// box-in-box chrome that cost more space than the numbers did, and squeezed the
// labels until real ones truncated ("Software Developm…"). A row gives the label
// the full width and lets type carry the hierarchy instead.
function Row({ label, value, sub, accent, last }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={[styles.rowLabel, accent && { color: theme.brand }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Text style={[styles.rowValue, accent && styles.rowValueAccent]}>{value}</Text>
    </View>
  );
}

function Flag({ label, yes, last }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <Text style={[styles.rowLabel, { flex: 1, paddingRight: 12 }]}>{label}</Text>
      {/* Icon + word, never colour alone. */}
      <View style={styles.flagVal}>
        <Feather name={yes ? "check" : "x"} size={13} color={yes ? theme.success : theme.ink4} />
        <Text style={[styles.flagTxt, { color: yes ? theme.success : theme.ink3 }]}>{yes ? "Yes" : "No"}</Text>
      </View>
    </View>
  );
}

function GroupLabel({ children }) {
  return <Text style={styles.groupLabel}>{children}</Text>;
}

export default function AiInsight({ insights }) {
  const ei = insights?.experience_insights;
  const ea = insights?.employment_analysis;
  if (!ei || !ea) return null;

  return (
    <View style={styles.card}>
      <GroupLabel>EXPERIENCE INSIGHTS</GroupLabel>
      <Row label="Total experience" value={fmtYears(ei.total_experience_years)} accent />
      <Row label="Leadership" value={fmtYears(ei.leadership_experience_years)} />
      {(ei.domain_experience || []).map((d) => (
        <Row key={d.domain} label={d.domain} value={fmtYears(d.years)} />
      ))}
      <Flag label="Startup" yes={ei.startup_experience} />
      <Flag label="Enterprise" yes={ei.enterprise_experience} />
      <Flag label="Remote work" yes={ei.remote_work_mentioned} last />

      <View style={styles.divider} />

      <GroupLabel>EMPLOYMENT ANALYSIS</GroupLabel>
      <Row label="Employers" value={String(ea.number_of_employers)} />
      <Row label="Average tenure" value={fmtMonths(ea.average_tenure_months)} />
      {ea.longest_tenure ? (
        <Row label="Longest tenure" value={fmtMonths(ea.longest_tenure.months)} sub={ea.longest_tenure.company} last />
      ) : null}

      {ea.career_progression ? (
        <View style={styles.progression}>
          <Feather name="trending-up" size={14} color={theme.brand} style={{ marginTop: 1 }} />
          <Text style={styles.progressionTxt}>{ea.career_progression}</Text>
        </View>
      ) : null}

      {ea.employment_gaps && ea.employment_gaps.length ? (
        <View style={styles.gaps}>
          <Text style={styles.gapsTitle}>Employment gaps</Text>
          {ea.employment_gaps.map((g, i) => (
            <Text key={i} style={styles.gapRow}>{g.start} to {g.end} <Text style={{ color: "#B45309" }}>({fmtMonths(g.duration_months)})</Text></Text>
          ))}
        </View>
      ) : (
        <View style={styles.noGaps}>
          <Feather name="check" size={13} color={theme.success} />
          <Text style={styles.noGapsTxt}>No employment gaps of 3+ months detected.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  groupLabel: { ...type.label, color: theme.ink4, marginBottom: space(1) },
  // A hairline between rows is the only separator: enough to scan by, without
  // drawing a container around every number.
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line2 },
  // No numberOfLines: a real domain name ("Furniture Manufacturing") should wrap
  // rather than truncate, and on a row it has the width to do so.
  rowLabel: { fontFamily: "Inter_500Medium", fontSize: 13.5, color: theme.ink2, lineHeight: 19 },
  rowSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: theme.ink4, marginTop: 1 },
  rowValue: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, color: theme.ink, fontVariant: ["tabular-nums"], textAlign: "right" },
  // Colour alone carries the emphasis. A larger size pushed the first figure off
  // the baseline every other value lines up on, which read as a misalignment
  // rather than as emphasis.
  rowValueAccent: { color: theme.brand },
  flagVal: { flexDirection: "row", alignItems: "center", gap: 5 },
  flagTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },
  // Stronger than the row hairlines, so the section break outranks them.
  divider: { height: 1, backgroundColor: theme.line, marginTop: space(3), marginBottom: space(3) },
  progression: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: theme.brandSoft, borderRadius: radius.md, padding: 12, marginTop: space(3) },
  progressionTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, color: theme.ink2 },
  gaps: { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: radius.md, padding: 12, marginTop: space(3) },
  gapsTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12.5, color: "#92400E", marginBottom: 3 },
  gapRow: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#92400E", marginTop: 1 },
  noGaps: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space(3) },
  noGapsTxt: { fontFamily: "Inter_500Medium", fontSize: 12.5, color: theme.success },
});
