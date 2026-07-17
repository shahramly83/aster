import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadPipelineSummary, loadOpenPositions } from "../lib/data";
import { Card, Press, Avatar, StatTile, SectionHeader, ScreenTitle, Loader, EmptyState, StagePill, Feather } from "../components/ui";
import { AsterMark } from "../components/Logo";
import { theme, type, space, radius } from "../theme";
import { JOB_STAGES, stageLabel, stageColor } from "@aster/shared";

// The manager's home: a snapshot of the whole hiring pipeline plus the roles
// that need attention. Everything here is a company-wide view.
export default function DashboardScreen({ navigation }) {
  const { profile } = useAuth();
  const [summary, setSummary] = useState(null);
  const [roles, setRoles] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [s, r] = await Promise.all([
      loadPipelineSummary(profile.companyId),
      loadOpenPositions(profile.companyId, { manager: true }),
    ]);
    setSummary(s);
    setRoles(r);
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (!summary) return <SafeAreaView style={{ flex: 1 }}><Loader label="Loading your pipeline…" /></SafeAreaView>;

  // Funnel stages worth showing on the dashboard (skip declined/rejected here).
  const funnel = JOB_STAGES.filter((s) => ["applied", "shortlisted", "interviewing", "offer", "hired"].includes(s.key));
  const funnelMax = Math.max(1, ...funnel.map((s) => summary.byStage[s.key] || 0));
  const rolesNeedingAttention = roles
    .map((r) => ({ ...r, active: (r.counts.interviewing || 0) + (r.counts.offer || 0) }))
    .sort((a, b) => b.active - a.active)
    .slice(0, 4);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <ScreenTitle
        subtitle={`${profile.company}`}
        right={<View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" }}><AsterMark size={26} color={theme.brand} /></View>}
      >
        {greeting()}{profile.name ? `, ${profile.name.split(" ")[0]}` : ""}
      </ScreenTitle>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(8) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Headline stats */}
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <StatTile label="In pipeline" value={summary.total} icon="users" tint={theme.brand} />
          <StatTile label="Open roles" value={summary.openRoles} icon="briefcase" tint="#7C3AED" />
        </View>
        <View style={{ flexDirection: "row", gap: space(3), marginTop: space(3) }}>
          <StatTile label="New this week" value={summary.newThisWeek} icon="trending-up" tint={theme.success} />
          <StatTile label="Awaiting decision" value={summary.awaitingDecision} icon="clock" tint={theme.warn} />
        </View>

        {/* Funnel */}
        <View style={{ marginTop: space(6) }}>
          <SectionHeader>Pipeline funnel</SectionHeader>
          <Card>
            {funnel.map((s, i) => {
              const n = summary.byStage[s.key] || 0;
              return (
                <View key={s.key} style={{ marginTop: i === 0 ? 0 : space(3) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={[type.smallStrong, { color: theme.ink2 }]}>{stageLabel(s.key)}</Text>
                    <Text style={[type.smallStrong, { color: theme.ink, fontVariant: ["tabular-nums"] }]}>{n}</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={{ width: `${(n / funnelMax) * 100}%`, height: "100%", backgroundColor: stageColor(s.key), borderRadius: radius.pill }} />
                  </View>
                </View>
              );
            })}
          </Card>
        </View>

        {/* Roles needing attention */}
        <View style={{ marginTop: space(6) }}>
          <SectionHeader action="All roles" onAction={() => navigation.navigate("PositionsTab")}>Needs attention</SectionHeader>
          {rolesNeedingAttention.length === 0 ? (
            <Card><Text style={[type.small, { color: theme.ink3 }]}>Nothing waiting on a decision. You're all caught up.</Text></Card>
          ) : (
            rolesNeedingAttention.map((r) => (
              <Card key={r.id} onPress={() => navigation.navigate("PositionApplicants", { jobId: r.id, jobTitle: r.title })} style={{ marginBottom: space(2.5), flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{r.title}</Text>
                  <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]}>{r.applicantCount} candidate{r.applicantCount === 1 ? "" : "s"} · {r.active} awaiting decision</Text>
                </View>
                {r.active > 0 ? <View style={styles.badge}><Text style={[type.smallStrong, { color: theme.warn }]}>{r.active}</Text></View> : null}
                <Feather name="chevron-right" size={20} color={theme.ink4} style={{ marginLeft: 8 }} />
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, backgroundColor: theme.line2, overflow: "hidden" },
  badge: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, backgroundColor: theme.warnBg, alignItems: "center", justifyContent: "center" },
});
