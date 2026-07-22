import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { useNotifications } from "../NotificationsContext";
import { loadAnalytics, loadCredits, loadTopSources, subscribeDashboard } from "../lib/data";
import { Press, IconChip, HeaderActions, TopBar, Button, Loader, Feather } from "../components/ui";
import { RingGauge, MeterBar, CreditRings } from "../components/Gauge";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";

function daysUntil(iso) {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return d > 0 ? d : 0;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function fmtDate(iso) {
  if (!iso) return "soon";
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function joinLabels(arr) {
  if (arr.length <= 1) return arr[0] || "";
  return arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
}

// Distinct accents for source segments (readable on the blue ground).
const SRC_COLORS = ["#7DE2A8", "#A9B8FF", "#FFD27D", "#FF9E9E", "#8BE0F0", "rgba(255,255,255,0.45)"];
function sourceIcon(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("whatsapp")) return "message-circle";
  if (n.includes("linkedin")) return "linkedin";
  if (n.includes("indeed") || n.includes("job") || n.includes("board")) return "briefcase";
  if (n.includes("referr")) return "users";
  if (n.includes("career") || n.includes("website") || n.includes("site") || n.includes("page")) return "globe";
  if (n.includes("twitter") || n.includes("x.com")) return "twitter";
  if (n.includes("facebook")) return "facebook";
  if (n.includes("instagram")) return "instagram";
  if (n.includes("email") || n.includes("mail")) return "mail";
  if (n.includes("direct")) return "navigation";
  return "link";
}

// The manager's analytics home: a bold brand-blue canvas with a pipeline-health
// meter and per-metric gauges. Data-forward, styled after the reference concept.
export default function DashboardScreen({ navigation }) {
  const { profile } = useAuth();
  const { unread } = useNotifications();
  const [a, setA] = useState(null);
  const [credits, setCredits] = useState(null);
  const [sources, setSources] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creditModal, setCreditModal] = useState(null); // the credit item tapped

  // Brand-blue screen → light status bar while focused.
  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));

  const load = useCallback(async () => {
    if (!profile) return;
    const [an, cr, src] = await Promise.all([
      loadAnalytics(profile.companyId),
      loadCredits(profile.plan),
      loadTopSources(profile.companyId),
    ]);
    setA(an);
    setCredits(cr);
    setSources(src);
  }, [profile]);

  // Refresh on focus + poll every 30s while focused (fallback for live data).
  useFocusEffect(useCallback(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]));

  // Realtime: reload (debounced) whenever the company's applications / jobs /
  // activity change, so the dashboard updates live without a manual pull.
  const debounceRef = useRef(null);
  useEffect(() => {
    if (!profile) return undefined;
    const bump = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => load(), 700);
    };
    const unsub = subscribeDashboard(profile.companyId, bump);
    return () => { clearTimeout(debounceRef.current); unsub(); };
  }, [profile, load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (!a) return <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }}><Loader label="Loading analytics…" /></SafeAreaView>;

  const healthLabel = a.health >= 66 ? "Healthy" : a.health >= 40 ? "Fair" : a.total ? "Needs work" : "No data yet";
  // Band the meter so the score reads at a glance: green healthy, amber fair,
  // red needs work — driven by the SAME thresholds as healthLabel so the colour
  // and the wording can never disagree. Brighter tints than the base theme
  // colours because this bar sits on the brand blue. An empty workspace stays
  // neutral rather than red: "no data" is not a critical pipeline.
  const healthColor = !a.total
    ? theme.onBrandMuted
    : a.health >= 66 ? "#34D399"   // green  · healthy
    : a.health >= 40 ? "#FBBF24"   // amber  · fair
    : "#FB7185";                   // red    · needs work
  const resetDays = credits ? daysUntil(credits.resetsAt) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }} edges={["top"]}>
      {/* Top bar (shared with Roles) */}
      <TopBar
        mark
        name={profile?.name?.split(" ")[0] || "Welcome"}
        right={<HeaderActions unread={unread} onSettings={() => navigation.navigate("Settings")} onBell={() => navigation.navigate("Notifications")} />}
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
            <MeterBar pct={a.health} color={healthColor} track={theme.brandTrack} ticks={38} height={26} />
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

        {/* Top sources — ranked bar chart (bars scaled to the leader) */}
        {sources && sources.total > 0 ? (
          <View style={{ paddingHorizontal: space(5), marginTop: space(7) }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(4) }}>
              <Text style={[type.label, { color: theme.onBrandMuted }]}>TOP SOURCES</Text>
              <Text style={[type.small, { color: theme.onBrandFaint }]}>{sources.total} applicants</Text>
            </View>
            {sources.sources.map((s, i) => {
              const color = SRC_COLORS[i % SRC_COLORS.length];
              const w = Math.max(6, Math.round((s.count / (sources.sources[0].count || 1)) * 100));
              return (
                <View key={s.name} style={styles.srcBarRow}>
                  <View style={styles.srcBarHead}>
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                      <View style={[styles.srcChip, { backgroundColor: color + "26" }]}>
                        <Feather name={sourceIcon(s.name)} size={13} color={color} />
                      </View>
                      <Text style={[type.smallStrong, { color: theme.onBrand }]} numberOfLines={1}>{s.name}</Text>
                    </View>
                    <Text style={[type.small, { color: theme.onBrandMuted, marginRight: 10, fontVariant: ["tabular-nums"] }]}>{s.count}</Text>
                    <Text style={styles.srcPct}>{s.pct}%</Text>
                  </View>
                  <View style={styles.srcTrack}>
                    <View style={{ width: `${w}%`, height: "100%", backgroundColor: color, borderRadius: radius.pill }} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

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
              {(credits?.items || []).map((it) => {
                const out = !it.unlimited && it.remaining <= 0;
                return (
                  <Press key={it.key} onPress={() => setCreditModal(it)} haptic="light" scaleTo={0.98}>
                    <View style={styles.legendRow}>
                      <View style={[styles.legendDot, { backgroundColor: it.color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[type.smallStrong, { color: theme.onBrand }]} numberOfLines={1}>{it.label}</Text>
                        <Text style={[type.small, { color: out ? "#FFC2C2" : theme.onBrandMuted }]}>
                          {it.unlimited ? "Unlimited" : out ? "Fully used" : `${it.remaining} of ${it.limit} left`}
                        </Text>
                      </View>
                      {out ? (
                        <View style={styles.outPill}><Text style={styles.outPillTxt}>OUT</Text></View>
                      ) : (
                        <Feather name="chevron-right" size={16} color={theme.onBrandFaint} />
                      )}
                    </View>
                  </Press>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>

      <CreditModal item={creditModal} credits={credits} onClose={() => setCreditModal(null)} />
    </SafeAreaView>
  );
}

// Out-of-credits (and per-credit) detail, styled after the CreditsState concept:
// what's used up, when it refreshes (with a progress bar), what still works, and a
// note that plans are managed on the web.
function CreditModal({ item, credits, onClose }) {
  if (!item) return null;
  const out = !item.unlimited && item.remaining <= 0;
  const days = daysUntil(credits?.resetsAt);
  const dateLabel = fmtDate(credits?.resetsAt);
  const fill = days != null ? Math.max(4, Math.min(100, Math.round(((30 - days) / 30) * 100))) : 6;
  const others = (credits?.items || [])
    .filter((x) => x.key !== item.key && (x.unlimited || x.remaining > 0))
    .map((x) => x.label);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.mBackdrop}>
        <View style={styles.mCard}>
          <View style={styles.mTop}>
            <View style={[styles.mIcon, { backgroundColor: out ? "#FFE7EA" : theme.brand + "14" }]}>
              <Feather name="zap" size={22} color={out ? "#F2526B" : theme.brand} />
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.mClose}><Feather name="x" size={18} color={theme.ink3} /></Pressable>
          </View>

          <Text style={styles.mTitle}>{out ? `Out of ${item.label} credits` : `${item.label} credits`}</Text>

          <Text style={styles.mBody}>
            {item.unlimited
              ? `${item.label} is unlimited on your plan. `
              : out
                ? `Your ${item.limit} monthly ${item.label} credits are used up. They refresh on `
                : `You have ${item.remaining} of ${item.limit} ${item.label} credits left this cycle. They refresh on `}
            {!item.unlimited ? <Text style={{ fontFamily: "Inter_700Bold", color: theme.ink }}>{dateLabel}</Text> : null}
            {!item.unlimited && days != null ? `, ${days} day${days === 1 ? "" : "s"} from now.` : !item.unlimited ? "." : ""}
          </Text>

          {!item.unlimited ? (
            <View style={styles.mBar}>
              <View style={styles.mBarHead}>
                <Text style={[type.smallStrong, { color: theme.ink }]}>Next refresh</Text>
                <Text style={[type.smallStrong, { color: theme.brand }]}>{days != null ? `${days} day${days === 1 ? "" : "s"}` : "—"}</Text>
              </View>
              <View style={styles.mBarTrack}><View style={[styles.mBarFill, { width: `${fill}%` }]} /></View>
            </View>
          ) : null}

          {out && others.length ? (
            <Text style={styles.mBody}>
              Everything else keeps working. {joinLabels(others)} still {others.length === 1 ? "has" : "have"} credits this cycle.
            </Text>
          ) : null}

          <Button title="Got it" onPress={onClose} style={{ marginTop: space(5) }} />
          <Text style={styles.mFoot}>Plans are managed from your Aster web dashboard.</Text>
        </View>
      </View>
    </Modal>
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
  bigTitle: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 34, lineHeight: 38, letterSpacing: -0.7, color: theme.onBrand },
  healthNum: { fontFamily: "Inter_700Bold", fontSize: 60, lineHeight: 62, letterSpacing: -2, color: theme.onBrand, fontVariant: ["tabular-nums"] },
  metricRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(4) },
  metricDivider: { borderTopWidth: 1, borderTopColor: theme.brandLine },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  metricPct: { fontFamily: "Inter_700Bold", fontSize: 40, lineHeight: 46, letterSpacing: -1, color: theme.onBrand, marginTop: 6, marginLeft: 16, fontVariant: ["tabular-nums"] },
  countsRow: { flexDirection: "row", alignItems: "center", marginHorizontal: space(5), marginTop: space(5), backgroundColor: theme.brandPanel, borderRadius: radius.lg, paddingVertical: space(4) },
  countSep: { width: 1, height: 34, backgroundColor: theme.brandLine },
  countVal: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 22, color: theme.onBrand, marginTop: 5, fontVariant: ["tabular-nums"] },
  panel: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandPanel, borderRadius: radius.lg, padding: space(4) },
  srcBarRow: { marginBottom: space(4) },
  srcBarHead: { flexDirection: "row", alignItems: "center", marginBottom: 9 },
  srcChip: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 10 },
  srcPct: { fontFamily: "Inter_700Bold", fontSize: 16, color: theme.onBrand, width: 44, textAlign: "right", fontVariant: ["tabular-nums"] },
  srcTrack: { height: 10, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.14)", overflow: "hidden" },
  creditCard: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandPanel, borderRadius: radius.lg, padding: space(4) },
  ringCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  legendRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(2) },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  outPill: { paddingHorizontal: 8, height: 20, borderRadius: 10, backgroundColor: "rgba(242,82,107,0.22)", alignItems: "center", justifyContent: "center" },
  outPillTxt: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.6, color: "#FFC2C2" },

  mBackdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.6)", alignItems: "center", justifyContent: "center", padding: space(5) },
  mCard: { width: "100%", maxWidth: 400, backgroundColor: theme.card, borderRadius: 26, padding: space(5) },
  mTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  mIcon: { width: 54, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  mClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.line2, alignItems: "center", justifyContent: "center" },
  mTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 25, letterSpacing: -0.5, color: theme.ink, marginTop: space(4) },
  mBody: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 23, color: theme.ink3, marginTop: space(3) },
  mBar: { backgroundColor: theme.brand + "0F", borderRadius: radius.lg, padding: space(4), marginTop: space(4) },
  mBarHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mBarTrack: { height: 8, borderRadius: radius.pill, backgroundColor: theme.brand + "22", marginTop: 12, overflow: "hidden" },
  mBarFill: { height: "100%", borderRadius: radius.pill, backgroundColor: theme.brand },
  mFoot: { fontFamily: "Inter_400Regular", fontSize: 12.5, color: theme.ink4, textAlign: "center", marginTop: space(3) },
});
