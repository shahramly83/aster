import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadPipelineSummary, loadOpenPositions } from "../lib/data";
import { Card, Avatar, IconChip, HeroBanner, StatTile, SectionHeader, Loader, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { JOB_STAGES, stageLabel, stageColor } from "@aster/shared";

// The manager's home, styled after the reference concept: a light airy canvas
// with a top bar, a bold hero banner for the thing that needs attention, and
// soft rounded cards for the pipeline snapshot.
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

  const funnel = JOB_STAGES.filter((s) => ["applied", "shortlisted", "interviewing", "offer", "hired"].includes(s.key));
  const funnelMax = Math.max(1, ...funnel.map((s) => summary.byStage[s.key] || 0));
  const attention = roles
    .map((r) => ({ ...r, active: (r.counts.interviewing || 0) + (r.counts.offer || 0) }))
    .sort((a, b) => b.active - a.active)
    .filter((r) => r.active > 0)
    .slice(0, 4);
  const topRole = attention[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Avatar name={profile?.name || profile?.email} size={44} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[type.small, { color: theme.ink3 }]}>{greeting()}</Text>
          <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{profile?.name?.split(" ")[0] || "Welcome"}</Text>
        </View>
        <IconChip name="briefcase" tint={theme.ink2} onPress={() => navigation.navigate("PositionsTab")} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(6) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero banner — the thing that needs attention */}
        {summary.awaitingDecision > 0 ? (
          <HeroBanner
            icon="clock"
            title={`${summary.awaitingDecision} awaiting your decision`}
            subtitle={topRole ? `Top: ${topRole.title}` : "Across your open roles"}
            onPress={() => topRole && navigation.navigate("PositionApplicants", { jobId: topRole.id, jobTitle: topRole.title })}
          />
        ) : (
          <HeroBanner icon="check" title="You're all caught up" subtitle="No candidates waiting on a decision" onPress={() => navigation.navigate("PositionsTab")} />
        )}

        {/* Stats */}
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <StatTile label="In pipeline" value={summary.total} icon="users" tint={theme.brand} />
          <StatTile label="Open roles" value={summary.openRoles} icon="briefcase" tint="#7C3AED" />
        </View>
        <View style={{ flexDirection: "row", gap: space(3), marginTop: space(3) }}>
          <StatTile label="New this week" value={summary.newThisWeek} icon="trending-up" tint={theme.success} />
          <StatTile label="To decide" value={summary.awaitingDecision} icon="clock" tint={theme.warn} />
        </View>

        {/* Funnel */}
        <View style={{ marginTop: space(6) }}>
          <SectionHeader>Pipeline funnel</SectionHeader>
          <Card>
            {funnel.map((s, i) => {
              const n = summary.byStage[s.key] || 0;
              return (
                <View key={s.key} style={{ marginTop: i === 0 ? 0 : space(3.5) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 7 }}>
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
        {attention.length ? (
          <View style={{ marginTop: space(6) }}>
            <SectionHeader action="All roles" onAction={() => navigation.navigate("PositionsTab")}>Needs attention</SectionHeader>
            {attention.map((r) => (
              <Card key={r.id} onPress={() => navigation.navigate("PositionApplicants", { jobId: r.id, jobTitle: r.title })} style={{ marginBottom: space(3), flexDirection: "row", alignItems: "center", paddingVertical: space(4) }}>
                <IconChip name="users" tint={theme.brand} bg={theme.brandSoft} size={42} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{r.title}</Text>
                  <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]}>{r.applicantCount} candidate{r.applicantCount === 1 ? "" : "s"} · {r.active} to decide</Text>
                </View>
                <View style={styles.badge}><Text style={[type.smallStrong, { color: theme.warn }]}>{r.active}</Text></View>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), paddingTop: space(1), paddingBottom: space(4) },
  track: { height: 9, borderRadius: radius.pill, backgroundColor: theme.line2, overflow: "hidden" },
  badge: { minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 8, backgroundColor: theme.warnBg, alignItems: "center", justifyContent: "center" },
});
