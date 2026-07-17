import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadOpenPositions } from "../lib/data";
import { Card, Loader, EmptyState, ScreenTitle } from "../components/ui";
import { theme } from "../theme";

export default function OpenPositionsScreen({ navigation }) {
  const { profile, assignedJobIds } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const rows = await loadOpenPositions(profile.companyId, assignedJobIds);
    setJobs(rows);
  }, [profile, assignedJobIds]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (jobs === null) return <SafeAreaView style={{ flex: 1 }}><Loader label="Loading positions…" /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <ScreenTitle subtitle="Roles you're on the panel for">Positions</ScreenTitle>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListEmptyComponent={
          <View style={{ marginTop: 80 }}>
            <EmptyState title="No assigned roles" subtitle="When a hiring manager adds you to a role's panel, it appears here." />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("PositionApplicants", { jobId: item.id, jobTitle: item.title })} style={{ marginBottom: 12 }}>
            <Card>
              <Text style={styles.title}>{item.title}</Text>
              <View style={{ flexDirection: "row", marginTop: 6, alignItems: "center" }}>
                {item.location ? <Text style={styles.meta}>📍 {item.location}</Text> : null}
                <Text style={[styles.meta, { marginLeft: item.location ? 12 : 0 }]}>
                  {item.status === "open" ? "🟢 Open" : "⚪ " + (item.status || "")}
                </Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", color: theme.ink },
  meta: { color: theme.ink3, fontSize: 13 },
});
