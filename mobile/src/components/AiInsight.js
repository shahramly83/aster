// AI Insight — the candidate deep-dive that mirrors the web profile: experience
// insights (total / leadership / domain, startup / enterprise / remote flags)
// and employment analysis (employers, tenure, career progression, gaps).
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { fmtYears, fmtMonths } from "@aster/shared";
import { Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

function Tile({ label, value, sub, accent }) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]}>
      <Text style={[styles.tileLabel, accent && { color: theme.brand }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.tileValue, accent && { color: theme.brand }]} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

function Flag({ label, yes }) {
  return (
    <View style={styles.flag}>
      <Text style={styles.flagLabel} numberOfLines={1}>{label}</Text>
      <View style={[styles.flagPill, yes ? styles.flagYes : styles.flagNo]}>
        <Feather name={yes ? "check" : "x"} size={11} color={yes ? "#166534" : theme.ink3} />
        <Text style={[styles.flagPillTxt, { color: yes ? "#166534" : theme.ink3 }]}>{yes ? "Yes" : "No"}</Text>
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
      <View style={styles.grid}>
        <Tile label="Total experience" value={fmtYears(ei.total_experience_years)} accent />
        <Tile label="Leadership" value={fmtYears(ei.leadership_experience_years)} />
        {(ei.domain_experience || []).map((d) => (
          <Tile key={d.domain} label={d.domain} value={fmtYears(d.years)} />
        ))}
      </View>
      <View style={styles.grid}>
        <Flag label="Startup" yes={ei.startup_experience} />
        <Flag label="Enterprise" yes={ei.enterprise_experience} />
        <Flag label="Remote work" yes={ei.remote_work_mentioned} />
      </View>

      <View style={styles.divider} />

      <GroupLabel>EMPLOYMENT ANALYSIS</GroupLabel>
      <View style={styles.grid}>
        <Tile label="Employers" value={String(ea.number_of_employers)} />
        <Tile label="Average tenure" value={fmtMonths(ea.average_tenure_months)} />
        {ea.longest_tenure ? (
          <Tile label="Longest tenure" value={fmtMonths(ea.longest_tenure.months)} sub={ea.longest_tenure.company} />
        ) : null}
      </View>

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

const GAP = 8;
const styles = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  groupLabel: { ...type.label, color: theme.ink4, marginBottom: space(2) },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, marginBottom: GAP },
  tile: { flexGrow: 1, flexBasis: "30%", minWidth: 96, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  tileAccent: { backgroundColor: theme.brandSoft, borderColor: theme.brand },
  tileLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: theme.ink3 },
  tileValue: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 16, color: theme.ink, marginTop: 3, fontVariant: ["tabular-nums"] },
  tileSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: theme.ink3, marginTop: 1 },
  flag: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexGrow: 1, flexBasis: "30%", minWidth: 96, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  flagLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: theme.ink3, flexShrink: 1 },
  flagPill: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  flagYes: { backgroundColor: "#DCFCE7" },
  flagNo: { backgroundColor: theme.line2 },
  flagPillTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  divider: { height: 1, backgroundColor: theme.line2, marginVertical: space(3) },
  progression: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: theme.brandSoft, borderWidth: 1, borderColor: theme.brand, borderRadius: radius.md, padding: 12, marginTop: 2 },
  progressionTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, color: theme.ink2 },
  gaps: { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: radius.md, padding: 12, marginTop: space(3) },
  gapsTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12.5, color: "#92400E", marginBottom: 3 },
  gapRow: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#92400E", marginTop: 1 },
  noGaps: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space(3) },
  noGapsTxt: { fontFamily: "Inter_500Medium", fontSize: 12.5, color: theme.success },
});
