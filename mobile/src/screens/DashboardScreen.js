import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadAnalytics, loadOpenPositions } from "../lib/data";
import { Press, IconChip, Loader, Feather } from "../components/ui";
import { RingGauge, MeterBar } from "../components/Gauge";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";

// The manager's analytics home: a bold brand-blue canvas with a pipeline-health
// meter and per-metric gauges. Data-forward, styled after the reference concept.
export default function DashboardScreen({ navigation }) {
  const { profile } = useAuth();
  const [a, setA] = useState(null);
  const [roles, setRoles] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // Brand-blue screen → light status bar while focused.
  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));

  const load = useCallback(async () => {
    if (!profile) return;
    const [an, r] = await Promise.all([
      loadAnalytics(profile.companyId),
      loadOpenPositions(profile.companyId, { manager: true }),
    ]);
    setA(an);
    setRoles(r);
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (!a) return <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }}><Loader label="Loading analytics…" /></SafeAreaView>;

  // Open positions only. Roles that still have candidates to decide on surface
  // first, but every open role is listed.
  const openRoles = roles
    .filter((r) => r.status === "open")
    .map((r) => ({ ...r, active: (r.counts.interviewing || 0) + (r.counts.offer || 0) }))
    .sort((x, y) => y.active - x.active)
    .slice(0, 6);
  const healthLabel = a.health >= 66 ? "Healthy" : a.health >= 40 ? "Fair" : a.total ? "Needs work" : "No data yet";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }} edges={["top"]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={[type.small, { color: theme.onBrandMuted }]}>{greeting()}</Text>
          <Text style={[type.h2, { color: theme.onBrand }]} numberOfLines={1}>{profile?.name?.split(" ")[0] || "Welcome"}</Text>
        </View>
        <IconChip name="briefcase" tint={theme.white} bg={theme.brandPanel} onPress={() => navigation.navigate("PositionsTab")} />
      </View>

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

        {/* Open positions */}
        {openRoles.length ? (
          <View style={{ paddingHorizontal: space(5), marginTop: space(6) }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(3) }}>
              <Text style={[type.label, { color: theme.onBrandMuted }]}>OPEN POSITIONS</Text>
              <Press onPress={() => navigation.navigate("PositionsTab")}><Text style={[type.smallStrong, { color: theme.white }]}>All roles</Text></Press>
            </View>
            {openRoles.map((r) => (
              <Press key={r.id} onPress={() => navigation.navigate("PositionApplicants", { jobId: r.id, jobTitle: r.title })} style={{ marginBottom: space(3) }}>
                <View style={styles.panel}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.h3, { color: theme.onBrand }]} numberOfLines={1}>{r.title}</Text>
                    <Text style={[type.small, { color: theme.onBrandMuted, marginTop: 2 }]}>
                      {r.applicantCount} candidate{r.applicantCount === 1 ? "" : "s"} in pipeline
                    </Text>
                  </View>
                  {r.active > 0 ? (
                    <View style={styles.pending}>
                      <Feather name="clock" size={12} color="#FFD27D" />
                      <Text style={[type.smallStrong, { color: "#FFD27D", marginLeft: 5 }]}>{r.active} to review</Text>
                    </View>
                  ) : null}
                  <Feather name="chevron-right" size={20} color={theme.onBrandFaint} style={{ marginLeft: 8 }} />
                </View>
              </Press>
            ))}
          </View>
        ) : (
          <View style={{ paddingHorizontal: space(5), marginTop: space(6) }}>
            <Text style={[type.label, { color: theme.onBrandMuted, marginBottom: space(3) }]}>OPEN POSITIONS</Text>
            <View style={styles.panel}>
              <Text style={[type.small, { color: theme.onBrandMuted }]}>No open roles right now.</Text>
            </View>
          </View>
        )}
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(5), paddingTop: space(1), paddingBottom: space(3) },
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
  pending: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,210,125,0.15)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
});
