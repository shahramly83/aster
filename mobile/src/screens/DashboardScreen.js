import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadAnalytics, loadRecentActivity } from "../lib/data";
import { Press, IconChip, TopBar, Loader, Feather } from "../components/ui";
import { RingGauge, MeterBar } from "../components/Gauge";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";
import { relTime } from "@aster/shared";

// Activity type → icon + on-blue tint. Falls back for unknown types.
const ACTIVITY = {
  new_application: { icon: "user-plus", tint: "#A9B8FF" },
  scorecard: { icon: "star", tint: "#FFD27D" },
  interview_scheduled: { icon: "calendar", tint: "#A9B8FF" },
  interview_requested: { icon: "calendar", tint: "#A9B8FF" },
  offer_sent: { icon: "send", tint: "#FFFFFF" },
  offer_signed: { icon: "check-circle", tint: "#7DE2A8" },
  hired: { icon: "award", tint: "#7DE2A8" },
  offer_declined: { icon: "x-circle", tint: "#FFB4A9" },
  offer_expired: { icon: "clock", tint: "rgba(255,255,255,0.55)" },
  role_requested: { icon: "briefcase", tint: "#A9B8FF" },
};
const actMeta = (t) => ACTIVITY[t] || { icon: "activity", tint: "#A9B8FF" };

// The manager's analytics home: a bold brand-blue canvas with a pipeline-health
// meter and per-metric gauges. Data-forward, styled after the reference concept.
export default function DashboardScreen({ navigation }) {
  const { profile } = useAuth();
  const [a, setA] = useState(null);
  const [activity, setActivity] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // Brand-blue screen → light status bar while focused.
  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));

  const load = useCallback(async () => {
    if (!profile) return;
    const [an, act] = await Promise.all([
      loadAnalytics(profile.companyId),
      loadRecentActivity(profile.companyId, 8),
    ]);
    setA(an);
    setActivity(act);
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (!a) return <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }}><Loader label="Loading analytics…" /></SafeAreaView>;

  const healthLabel = a.health >= 66 ? "Healthy" : a.health >= 40 ? "Fair" : a.total ? "Needs work" : "No data yet";

  // Tapping an activity jumps to the most relevant screen.
  const openActivity = (it) => {
    if (it.candidateId) navigation.navigate("CandidateProfile", { candidateId: it.candidateId, jobId: it.jobId, candidateName: it.title });
    else if (it.jobId) navigation.navigate("PositionApplicants", { jobId: it.jobId, jobTitle: it.title });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }} edges={["top"]}>
      {/* Top bar (shared with Roles) */}
      <TopBar
        name={profile?.name?.split(" ")[0] || "Welcome"}
        right={<IconChip name="bell" tint={theme.white} bg={theme.brandPanel} onPress={() => navigation.navigate("ProfileTab")} />}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        showsVerticalScrollIndicator={false}
      >
        {/* Pipeline health header */}
        <View style={styles.header}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Text style={[styles.bigTitle]}>Pipeline{"\n"}Health</Text>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[type.small, { color: theme.onBrandFaint }]}>Updated</Text>
              <Text style={[type.smallStrong, { color: theme.onBrandMuted }]}>Just now</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: space(3) }}>
            <Text style={styles.healthNum}>{a.health}</Text>
            <Text style={[type.h3, { color: theme.onBrandMuted, marginBottom: 8, marginLeft: 8 }]}>/ 100 · {healthLabel}</Text>
          </View>
          <View style={{ marginTop: space(3) }}>
            <MeterBar pct={a.health} color={theme.white} track={theme.brandTrack} ticks={38} height={26} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
              <Text style={[type.small, { color: theme.onBrandFaint }]}>Low</Text>
              <Text style={[type.small, { color: theme.onBrandFaint }]}>High</Text>
            </View>
          </View>
        </View>

        {/* Metric rows with gauges */}
        <View style={{ paddingHorizontal: space(5) }}>
          {a.metrics.map((m, i) => (
            <View key={m.key} style={[styles.metricRow, i > 0 && styles.metricDivider]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[styles.dot, { backgroundColor: m.tone }]} />
                  <Text style={[type.bodyStrong, { color: theme.onBrand }]}>{m.label}</Text>
                </View>
                <Text style={[type.small, { color: theme.onBrandMuted, marginTop: 3, marginLeft: 16 }]}>{m.desc}</Text>
                <Text style={styles.metricPct}>{m.pct}%</Text>
              </View>
              <RingGauge pct={m.pct} size={78} stroke={9} color={m.tone} track={theme.brandTrack} />
            </View>
          ))}
        </View>

        {/* Quick counts */}
        <View style={styles.countsRow}>
          <Count label="In pipeline" value={a.total} icon="users" />
          <View style={styles.countSep} />
          <Count label="Open roles" value={a.openRoles} icon="briefcase" />
          <View style={styles.countSep} />
          <Count label="New / wk" value={a.newThisWeek} icon="trending-up" />
        </View>

        {/* Recent activity feed */}
        <View style={{ paddingHorizontal: space(5), marginTop: space(6) }}>
          <Text style={[type.label, { color: theme.onBrandMuted, marginBottom: space(3) }]}>RECENT ACTIVITY</Text>
          {activity.length === 0 ? (
            <View style={styles.panel}>
              <Text style={[type.small, { color: theme.onBrandMuted }]}>Nothing yet. New applicants, scorecards and offers will show here.</Text>
            </View>
          ) : (
            <View style={styles.feed}>
              {activity.map((it, i) => {
                const m = actMeta(it.type);
                const tappable = !!(it.candidateId || it.jobId);
                return (
                  <Press key={it.id} onPress={tappable ? () => openActivity(it) : undefined} haptic={tappable ? "light" : null} scaleTo={tappable ? 0.98 : 1}>
                    <View style={[styles.actRow, i > 0 && styles.actDivider]}>
                      <View style={styles.actIcon}>
                        <Feather name={m.icon} size={16} color={m.tint} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[type.smallStrong, { color: theme.onBrand }]} numberOfLines={1}>{it.title}</Text>
                        {it.description ? <Text style={[type.small, { color: theme.onBrandMuted, marginTop: 1 }]} numberOfLines={1}>{it.description}</Text> : null}
                      </View>
                      <Text style={[type.small, { color: theme.onBrandFaint, marginLeft: 8 }]}>{relTime(it.createdAt)}</Text>
                    </View>
                  </Press>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Count({ label, value, icon }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Feather name={icon} size={16} color={theme.onBrandMuted} />
      <Text style={[styles.countVal]}>{value}</Text>
      <Text style={[type.small, { color: theme.onBrandMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space(5), paddingTop: space(2), paddingBottom: space(6) },
  bigTitle: { fontFamily: "Inter_700Bold", fontSize: 34, lineHeight: 38, letterSpacing: -0.5, color: theme.onBrand },
  healthNum: { fontFamily: "Inter_700Bold", fontSize: 60, lineHeight: 62, letterSpacing: -2, color: theme.onBrand, fontVariant: ["tabular-nums"] },
  metricRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(4) },
  metricDivider: { borderTopWidth: 1, borderTopColor: theme.brandLine },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  metricPct: { fontFamily: "Inter_700Bold", fontSize: 40, lineHeight: 46, letterSpacing: -1, color: theme.onBrand, marginTop: 6, marginLeft: 16, fontVariant: ["tabular-nums"] },
  countsRow: { flexDirection: "row", alignItems: "center", marginHorizontal: space(5), marginTop: space(5), backgroundColor: theme.brandPanel, borderRadius: radius.lg, paddingVertical: space(4) },
  countSep: { width: 1, height: 34, backgroundColor: theme.brandLine },
  countVal: { fontFamily: "Inter_700Bold", fontSize: 22, color: theme.onBrand, marginTop: 5, fontVariant: ["tabular-nums"] },
  panel: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandPanel, borderRadius: radius.lg, padding: space(4) },
  feed: { backgroundColor: theme.brandPanel, borderRadius: radius.lg, paddingHorizontal: space(4) },
  actRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(3.5) },
  actDivider: { borderTopWidth: 1, borderTopColor: theme.brandLine },
  actIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
});
