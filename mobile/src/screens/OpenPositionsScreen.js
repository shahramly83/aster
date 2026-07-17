import React, { useCallback, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadOpenPositions } from "../lib/data";
import { Press, Loader, EmptyState, ScreenTitle, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { JOB_STAGES, stageColor } from "@aster/shared";

export default function OpenPositionsScreen({ navigation }) {
  const { profile, manager, assignedJobIds } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setJobs(await loadOpenPositions(profile.companyId, { manager, assignedJobIds }));
  }, [profile, manager, assignedJobIds]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (jobs === null) return <SafeAreaView style={{ flex: 1 }}><Loader label="Loading roles…" /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <ScreenTitle subtitle={manager ? "Every role in your workspace" : "Roles you're on the panel for"}>
        {manager ? "Roles" : "Positions"}
      </ScreenTitle>
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(8), flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListEmptyComponent={
          <EmptyState icon="briefcase" title={manager ? "No roles yet" : "No assigned roles"}
            subtitle={manager ? "Create a role on the web app and it'll appear here." : "When a hiring manager adds you to a role's panel, it appears here."} />
        }
        renderItem={({ item }) => <RoleCard job={item} onPress={() => navigation.navigate("PositionApplicants", { jobId: item.id, jobTitle: item.title })} />}
      />
    </SafeAreaView>
  );
}

function RoleCard({ job, onPress }) {
  const total = job.applicantCount || 0;
  const open = job.status === "open";
  return (
    <Press onPress={onPress} style={{ marginBottom: space(3) }}>
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{job.title}</Text>
            <View style={styles.metaRow}>
              <View style={[styles.statusDot, { backgroundColor: open ? theme.success : theme.ink4 }]} />
              <Text style={[type.small, { color: theme.ink3 }]}>{open ? "Open" : (job.status || "Closed")}</Text>
              {job.location ? (
                <>
                  <View style={styles.sep} />
                  <Feather name="map-pin" size={12} color={theme.ink4} />
                  <Text style={[type.small, { color: theme.ink3, marginLeft: 4 }]} numberOfLines={1}>{job.location}</Text>
                </>
              ) : null}
            </View>
          </View>
          <View style={styles.countPill}>
            <Text style={[type.smallStrong, { color: theme.ink2, fontVariant: ["tabular-nums"] }]}>{total}</Text>
          </View>
        </View>

        {/* Stacked pipeline bar */}
        {total > 0 ? (
          <View style={styles.track}>
            {JOB_STAGES.filter((s) => job.counts[s.key] > 0).map((s) => (
              <View key={s.key} style={{ flex: job.counts[s.key], backgroundColor: stageColor(s.key) }} />
            ))}
          </View>
        ) : (
          <Text style={[type.small, { color: theme.ink4, marginTop: space(3) }]}>No candidates in the pipeline yet.</Text>
        )}
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, padding: space(4), shadowColor: "#0B1B4D", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  sep: { width: 3, height: 3, borderRadius: 2, backgroundColor: theme.ink4, marginHorizontal: 8 },
  countPill: { minWidth: 30, height: 26, borderRadius: radius.pill, backgroundColor: theme.line2, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  track: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", marginTop: space(3.5), gap: 2 },
});
