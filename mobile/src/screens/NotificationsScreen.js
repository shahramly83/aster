import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadRecentActivity } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { ScreenHeader, EmptyState, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { relTime } from "@aster/shared";

// Icon + tint per activity_log type (same types the web/edge functions write).
const TYPES = {
  new_application: { icon: "user-plus", tint: "#0B2AE0" },
  interview_scheduled: { icon: "calendar", tint: "#7C3AED" },
  scorecard: { icon: "edit-3", tint: "#1D6FD6" },
  hired: { icon: "award", tint: "#12A150" },
  offer_sent: { icon: "send", tint: "#0B2AE0" },
  offer_approval_requested: { icon: "user-check", tint: "#C2710A" },
  offer_approval_step: { icon: "check", tint: "#12A150" },
  offer_approval_declined: { icon: "x-circle", tint: "#D92D20" },
  offer_approved: { icon: "check-circle", tint: "#12A150" },
  offer_signed: { icon: "check-circle", tint: "#12A150" },
  offer_expired: { icon: "clock", tint: "#B42318" },
};
const DEFAULT_TYPE = { icon: "bell", tint: "#6B7280" };

export default function NotificationsScreen({ navigation }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setRows(await loadRecentActivity(profile.companyId, 50));
  }, [profile]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));
  useAutoRefresh(profile?.companyId, load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const open = (n) => {
    if (n.candidateId) navigation.navigate("CandidateProfile", { candidateId: n.candidateId, jobId: n.jobId });
    else if (n.jobId) navigation.navigate("JobDetail", { jobId: n.jobId });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader eyebrow="Updates" title="Notifications" onBack={() => navigation.goBack()} />
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <FlatList
          data={rows === null ? [] : rows}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: space(4), paddingBottom: space(10), flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: "center", paddingTop: space(12) }}>
              <EmptyState icon="bell" title={rows === null ? "Loading…" : "You're all caught up"} subtitle={rows === null ? "" : "New applicants, interviews, offers and hires will show up here."} />
            </View>
          }
          renderItem={({ item, index }) => {
            const t = TYPES[item.type] || DEFAULT_TYPE;
            const tappable = item.candidateId || item.jobId;
            return (
              <Pressable onPress={() => tappable && open(item)} disabled={!tappable} style={[styles.row, index > 0 && styles.divider]}>
                <View style={[styles.icon, { backgroundColor: t.tint + "18" }]}>
                  <Feather name={t.icon} size={17} color={t.tint} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={2}>{item.title}</Text>
                  {item.description ? <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]} numberOfLines={2}>{item.description}</Text> : null}
                  <Text style={[type.small, { color: theme.ink4, marginTop: 3 }]}>{item.createdAt ? relTime(item.createdAt) : ""}</Text>
                </View>
                {tappable ? <Feather name="chevron-right" size={18} color={theme.ink4} style={{ marginLeft: 6 }} /> : null}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: space(3.5) },
  divider: { borderTopWidth: 1, borderTopColor: theme.line2 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginTop: 1 },
});
