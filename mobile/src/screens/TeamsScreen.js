import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { useNotifications } from "../NotificationsContext";
import { loadTeam } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { Avatar, HeaderActions, Loader, EmptyState, Feather } from "../components/ui";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";
import { ROLE_LABELS } from "@aster/shared";

// Per-role identity: icon + colour so each member reads at a glance and the
// summary tiles are colour-coded.
const ROLE_META = {
  owner: { icon: "star", color: "#B45309", bg: "#FEF3C7", ring: "#F59E0B" },
  admin: { icon: "shield", color: theme.brand, bg: theme.brandSoft, ring: theme.brand },
  recruiter: { icon: "user-check", color: "#0F766E", bg: "#CCFBF1", ring: "#14B8A6" },
  interviewer: { icon: "users", color: "#6D28D9", bg: "#EDE9FE", ring: "#8B5CF6" },
};
const metaOf = (r) => ROLE_META[r] || { icon: "user", color: theme.ink3, bg: theme.line2, ring: theme.line };
const ROLE_ORDER = ["owner", "admin", "recruiter", "interviewer"];

function Rise({ children, delay = 0, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 400, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export default function TeamsScreen({ navigation }) {
  const { profile } = useAuth();
  const { unread } = useNotifications();
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setRows(await loadTeam(profile.companyId));
  }, [profile]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));
  useAutoRefresh(profile?.companyId, load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Group members by role, in seniority order, for a sectioned list.
  const groups = [];
  for (const role of ROLE_ORDER) {
    const members = (rows || []).filter((m) => m.role === role);
    if (members.length) groups.push({ role, members });
  }
  // Roles outside the known set (defensive) fall into one "Members" bucket.
  const others = (rows || []).filter((m) => !ROLE_ORDER.includes(m.role));
  if (others.length) groups.push({ role: "member", members: others });

  const flat = groups.flatMap((g) => [{ _section: g.role, count: g.members.length }, ...g.members]);
  const total = rows ? rows.length : 0;

  const Header = (
    <LinearGradient colors={["#123AF0", "#0B2AE0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>YOUR WORKSPACE</Text>
            <Text style={styles.title}>Team</Text>
          </View>
          <HeaderActions unread={unread} onSettings={() => navigation.navigate("Settings")} onBell={() => navigation.navigate("Notifications")} />
        </View>

        {/* Role summary tiles */}
        {rows && rows.length ? (
          <View style={styles.summary}>
            {groups.map((g) => {
              const m = metaOf(g.role);
              return (
                <View key={g.role} style={styles.sumTile}>
                  <View style={styles.sumIcon}><Feather name={m.icon} size={14} color="#fff" /></View>
                  <Text style={styles.sumCount}>{g.members.length}</Text>
                  <Text style={styles.sumLabel} numberOfLines={1}>{(ROLE_LABELS[g.role] || "Member") + (g.members.length === 1 ? "" : "s")}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.heroSub}>{rows ? "No teammates yet" : "Loading your team…"}</Text>
        )}
      </SafeAreaView>
    </LinearGradient>
  );

  if (rows === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        {Header}
        <Loader label="Loading your team…" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        data={flat}
        keyExtractor={(item) => (item._section ? `s-${item._section}` : `m-${item.id}`)}
        ListHeaderComponent={Header}
        contentContainerStyle={{ paddingBottom: TAB_CLEARANCE, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} progressViewOffset={40} />}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: "center", paddingTop: space(12) }}>
            <EmptyState icon="users" title="No teammates yet" subtitle="Invite teammates from the Aster web app and they'll appear here." />
          </View>
        }
        ListFooterComponent={rows.length ? (
          <View style={styles.footer}>
            <Feather name="info" size={13} color={theme.ink4} />
            <Text style={[type.small, { color: theme.ink4, marginLeft: 8, flex: 1 }]}>Invite and manage teammates from the Aster web app.</Text>
          </View>
        ) : null}
        renderItem={({ item, index }) => {
          if (item._section) {
            const m = metaOf(item._section);
            return (
              <View style={styles.sectionRow}>
                <View style={[styles.sectionDot, { backgroundColor: m.color }]} />
                <Text style={styles.section}>{(ROLE_LABELS[item._section] || "Members").toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{item.count}</Text>
              </View>
            );
          }
          const m = metaOf(item.role);
          const you = item.id === profile?.userId;
          return (
            <Rise delay={Math.min(index, 8) * 35}>
              <View style={styles.card}>
                <View style={[styles.avatarRing, { borderColor: m.ring }]}>
                  <Avatar name={item.name} size={44} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={1}>{item.name}</Text>
                    {you ? <View style={styles.youPill}><Text style={styles.youTxt}>You</Text></View> : null}
                  </View>
                  {item.email ? <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{item.email}</Text> : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <View style={[styles.roleTag, { backgroundColor: m.bg }]}>
                    <Feather name={m.icon} size={11} color={m.color} />
                    <Text style={[type.smallStrong, { color: m.color, marginLeft: 5 }]}>{ROLE_LABELS[item.role] || "Member"}</Text>
                  </View>
                  {item.pending ? <Text style={styles.pending}>Invite pending</Text> : null}
                </View>
              </View>
            </Rise>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space(5), paddingBottom: space(5) },
  heroTop: { flexDirection: "row", alignItems: "flex-start", paddingTop: space(2), marginBottom: space(4) },
  eyebrow: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.4, color: "rgba(255,255,255,0.7)", marginBottom: 4 },
  title: { fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 32, letterSpacing: -0.6, color: "#fff" },
  heroSub: { fontFamily: "Inter_500Medium", fontSize: 14, color: "rgba(255,255,255,0.82)" },
  summary: { flexDirection: "row", gap: 10 },
  sumTile: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 10, alignItems: "flex-start" },
  sumIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  sumCount: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 20, color: "#fff", fontVariant: ["tabular-nums"] },
  sumLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 1 },

  sectionRow: { flexDirection: "row", alignItems: "center", marginTop: space(5), marginBottom: space(2), paddingHorizontal: space(5) },
  sectionDot: { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  section: { ...type.label, color: theme.ink3 },
  sectionCount: { ...type.label, color: theme.ink4, marginLeft: 6 },

  card: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, padding: space(3.5), marginHorizontal: space(4), marginBottom: space(2.5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  avatarRing: { borderWidth: 2, borderRadius: 27, padding: 2 },
  youPill: { backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  youTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: theme.brand },
  roleTag: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  pending: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, color: theme.warn, marginTop: 5 },
  footer: { flexDirection: "row", alignItems: "center", marginHorizontal: space(4), marginTop: space(4), padding: space(3), backgroundColor: theme.line2, borderRadius: radius.md },
});
