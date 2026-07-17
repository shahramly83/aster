import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadAnalytics, loadCredits } from "../lib/data";
import { Press, IconChip, TopBar, Loader, Feather } from "../components/ui";
import { RingGauge, MeterBar, CreditRings } from "../components/Gauge";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";

function daysUntil(iso) {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return d > 0 ? d : 0;
}

// The manager's analytics home: a bold brand-blue canvas with a pipeline-health
// meter and per-metric gauges. Data-forward, styled after the reference concept.
export default function DashboardScreen({ navigation }) {
  const { profile } = useAuth();
  const [a, setA] = useState(null);
  const [credits, setCredits] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Brand-blue screen → light status bar while focused.
  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));

  const load = useCallback(async () => {
    if (!profile) return;
    const [an, cr] = await Promise.all([
      loadAnalytics(profile.companyId),
      loadCredits(profile.plan),
    ]);
    setA(an);
    setCredits(cr);
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (!a) return <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }}><Loader label="Loading analytics…" /></SafeAreaView>;

  const healthLabel = a.health >= 66 ? "Healthy" : a.health >= 40 ? "Fair" : a.total ? "Needs work" : "No data yet";
  const resetDays = credits ? daysUntil(credits.resetsAt) : null;

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
          <Count label="Total hired" value={a.counts.hired} icon="award" />
          <View style={styles.countSep} />
          <Count label="Open roles" value={a.openRoles} icon="briefcase" />
          <View style={styles.countSep} />
          <Count label="New / wk" value={a.newThisWeek} icon="trending-up" />
        </View>

        {/* AI credits — concentric rings + legend */}
        <View style={{ paddingHorizontal: space(5), marginTop: space(6) }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(3) }}>
            <Text style={[type.label, { color: theme.onBrandMuted }]}>AI CREDITS</Text>
            {resetDays != null ? (
              <Text style={[type.small, { color: theme.onBrandFaint }]}>Resets in {resetDays}d</Text>
            ) : null}
          </View>
          <View style={styles.creditCard}>
            <View style={{ width: 148, height: 148, alignItems: "center", justifyContent: "center" }}>
              <CreditRings rings={credits?.items || []} size={148} stroke={13} gap={5} />
              <View style={styles.ringCenter} pointerEvents="none">
                <Feather name="zap" size={22} color="rgba(255,255,255,0.9)" />
              </View>
            </View>
            <View style={{ flex: 1, marginLeft: space(4) }}>
              {(credits?.items || []).map((it) => (
                <Press key={it.key} onPress={() => navigation.navigate("ProfileTab")} haptic="light" scaleTo={0.98}>
                  <View style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: it.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.smallStrong, { color: theme.onBrand }]} numberOfLines={1}>{it.label}</Text>
                      <Text style={[type.small, { color: theme.onBrandMuted }]}>
                        {it.unlimited ? "Unlimited" : `${it.remaining} of ${it.limit} left`}
                      </Text>
                    </View>
                  </View>
                </Press>
              ))}
            </View>
          </View>
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
  creditCard: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandPanel, borderRadius: radius.lg, padding: space(4) },
  ringCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  legendRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(2) },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
});
