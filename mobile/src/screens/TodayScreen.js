import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadMyInterviews } from "../lib/data";
import { Card, Avatar, Loader, EmptyState, ScreenTitle } from "../components/ui";
import { theme } from "../theme";
import { fmtInterviewTime, minutesUntil } from "@aster/shared";

// Groups: interviews starting in the next 12h are "Up next", the rest "Later".
function bucket(iso) {
  const m = minutesUntil(iso);
  if (m <= 12 * 60) return "soon";
  return "later";
}

export default function TodayScreen({ navigation }) {
  const { profile } = useAuth();
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      setError("");
      const rows = await loadMyInterviews(profile.companyId, profile.userId);
      setItems(rows);
    } catch (e) {
      setError(e?.message || "Could not load interviews.");
      setItems([]);
    }
  }, [profile]);

  // Reload on focus + on visibility (matches the web app's focus-refresh model).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (items === null) return <SafeAreaView style={{ flex: 1 }}><Loader label="Loading your interviews…" /></SafeAreaView>;

  const soon = items.filter((i) => bucket(i.scheduledAt) === "soon");
  const later = items.filter((i) => bucket(i.scheduledAt) === "later");
  const sections = [
    ...(soon.length ? [{ header: "Up next", data: soon }] : []),
    ...(later.length ? [{ header: "Later", data: later }] : []),
  ];
  const flat = sections.flatMap((s) => [{ _header: s.header }, ...s.data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <ScreenTitle subtitle={profile ? `${profile.name || profile.roleLabel} · ${profile.company}` : ""}>
        Today
      </ScreenTitle>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={flat}
        keyExtractor={(item, i) => item._header ? `h-${item._header}` : `iv-${item.id}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListEmptyComponent={
          <View style={{ marginTop: 80 }}>
            <EmptyState title="No interviews scheduled" subtitle="When you're added to an interview panel, it shows up here with a reminder." />
          </View>
        }
        renderItem={({ item }) => {
          if (item._header) return <Text style={styles.sectionHeader}>{item._header}</Text>;
          return <InterviewCard iv={item} onPress={() => navigation.navigate("InterviewDetail", { interviewId: item.id, iv: item })} />;
        }}
      />
    </SafeAreaView>
  );
}

function InterviewCard({ iv, onPress }) {
  const mins = minutesUntil(iv.scheduledAt);
  const soon = mins <= 30 && mins >= -15;
  return (
    <Pressable onPress={onPress} style={{ marginBottom: 12 }}>
      <Card style={soon ? { borderColor: theme.brand, borderWidth: 1.5 } : null}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Avatar uri={iv.avatarUrl} name={iv.candidateName} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.name}>{iv.candidateName}</Text>
            <Text style={styles.role}>{iv.jobTitle}</Text>
          </View>
          {soon ? <View style={styles.soonBadge}><Text style={styles.soonText}>{mins <= 0 ? "now" : `${mins}m`}</Text></View> : null}
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.time}>🕑 {fmtInterviewTime(iv.scheduledAt)}</Text>
          {iv.meetingLink ? <Text style={styles.link}>· Video link</Text> : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { color: theme.ink3, fontWeight: "700", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8, marginBottom: 8, marginLeft: 4 },
  name: { fontSize: 16, fontWeight: "700", color: theme.ink },
  role: { color: theme.ink2, marginTop: 1 },
  timeRow: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  time: { color: theme.ink2, fontSize: 13 },
  link: { color: theme.brand, fontSize: 13, marginLeft: 6, fontWeight: "600" },
  soonBadge: { backgroundColor: theme.brand, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 4 },
  soonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  error: { color: theme.danger, paddingHorizontal: 20, marginBottom: 8 },
});
