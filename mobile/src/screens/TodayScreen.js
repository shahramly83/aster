import React, { useCallback, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadMyInterviews } from "../lib/data";
import { setStatusBarStyle } from "expo-status-bar";
import { Card, Press, Avatar, Loader, EmptyState, ScreenTitle, Feather } from "../components/ui";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";
import { fmtInterviewTime, minutesUntil } from "@aster/shared";

const bucket = (iso) => (minutesUntil(iso) <= 12 * 60 ? "soon" : "later");

export default function TodayScreen({ navigation }) {
  const { profile, manager } = useAuth();
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      setError("");
      setItems(await loadMyInterviews(profile.companyId, profile.userId));
    } catch (e) { setError(e?.message || "Could not load interviews."); setItems([]); }
  }, [profile]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("dark"); load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (items === null) return <SafeAreaView style={{ flex: 1 }}><Loader label="Loading your interviews…" /></SafeAreaView>;

  const soon = items.filter((i) => bucket(i.scheduledAt) === "soon");
  const later = items.filter((i) => bucket(i.scheduledAt) === "later");
  const flat = [
    ...(soon.length ? [{ _header: "Up next" }, ...soon] : []),
    ...(later.length ? [{ _header: "Later" }, ...later] : []),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <ScreenTitle subtitle={manager ? "Interviews you're on" : `${profile?.name || "Interviewer"} · ${profile?.company}`}>
        Interviews
      </ScreenTitle>
      {error ? <Text style={[type.small, { color: theme.danger, paddingHorizontal: space(5), marginBottom: 8 }]}>{error}</Text> : null}
      <FlatList
        data={flat}
        keyExtractor={(item) => (item._header ? `h-${item._header}` : `iv-${item.id}`)}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: TAB_CLEARANCE, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListEmptyComponent={
          <EmptyState icon="calendar" title="No interviews scheduled" subtitle="When you're added to an interview panel, it appears here with a reminder." />
        }
        renderItem={({ item }) =>
          item._header
            ? <Text style={styles.section}>{item._header.toUpperCase()}</Text>
            : <InterviewCard iv={item} onPress={() => navigation.navigate("InterviewDetail", { interviewId: item.id, iv: item })} />
        }
      />
    </SafeAreaView>
  );
}

function InterviewCard({ iv, onPress }) {
  const mins = minutesUntil(iv.scheduledAt);
  const soon = mins <= 30 && mins >= -15;
  return (
    <Press onPress={onPress} style={{ marginBottom: space(3) }}>
      <View style={[styles.card, soon && { borderColor: theme.brand, borderWidth: 1.5 }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={48} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{iv.candidateName}</Text>
            <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{iv.jobTitle}</Text>
          </View>
          {soon ? (
            <View style={styles.soonBadge}><Text style={[type.smallStrong, { color: theme.white }]}>{mins <= 0 ? "now" : `${mins}m`}</Text></View>
          ) : (
            <Feather name="chevron-right" size={20} color={theme.ink4} />
          )}
        </View>
        <View style={styles.metaRow}>
          <Feather name="clock" size={14} color={theme.ink3} />
          <Text style={[type.small, { color: theme.ink2, marginLeft: 6 }]}>{fmtInterviewTime(iv.scheduledAt)}</Text>
          {iv.meetingLink ? (
            <>
              <View style={styles.dot} />
              <Feather name="video" size={14} color={theme.brand} />
              <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 4 }]}>Video</Text>
            </>
          ) : null}
        </View>
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  section: { ...type.label, color: theme.ink3, marginTop: space(2), marginBottom: space(3), marginLeft: space(1) },
  card: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(4.5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: space(3.5) },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: theme.ink4, marginHorizontal: 8 },
  soonBadge: { backgroundColor: theme.brand, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
});
