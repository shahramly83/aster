import React, { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, ScrollView, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadApplicants } from "../lib/data";
import { Press, Avatar, ScoreChip, StagePill, Loader, EmptyState, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "applied", label: "Applied" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "interviewing", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
];

export default function PositionApplicantsScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { jobId, jobTitle } = route.params || {};
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    if (!profile) return;
    setRows(await loadApplicants(profile.companyId, jobId));
  }, [profile, jobId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(
    () => (rows || []).filter((r) => filter === "all" || r.stage === filter),
    [rows, filter]
  );

  if (rows === null) return <Loader label="Loading candidates…" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["bottom"]}>
      <View style={{ paddingHorizontal: space(5), paddingTop: space(2) }}>
        <Text style={[type.small, { color: theme.ink3 }]} numberOfLines={1}>{jobTitle} · {rows.length} candidate{rows.length === 1 ? "" : "s"}</Text>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count = f.key === "all" ? rows.length : rows.filter((r) => r.stage === f.key).length;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[type.smallStrong, { color: active ? theme.white : theme.ink2 }]}>{f.label}</Text>
                <Text style={[type.smallStrong, { color: active ? theme.white : theme.ink4, marginLeft: 5, fontVariant: ["tabular-nums"] }]}>{count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.applicationId}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(8), flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListEmptyComponent={<EmptyState icon="users" title="No candidates here" subtitle={filter === "all" ? "Applicants for this role will show here." : "No one in this stage yet."} />}
        renderItem={({ item }) => (
          <Press
            onPress={() => navigation.navigate("CandidateProfile", { candidateId: item.candidateId, applicationId: item.applicationId, jobId, stage: item.stage, candidateName: item.name })}
            style={{ marginBottom: space(2.5) }}
          >
            <View style={styles.card}>
              <Avatar uri={item.avatarUrl} name={item.name} size={46} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{item.name}</Text>
                <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <StagePill stage={item.stage} small />
                  <ScoreChip score={item.matchScore} />
                </View>
              </View>
              <Feather name="chevron-right" size={20} color={theme.ink4} />
            </View>
          </Press>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: space(4), paddingVertical: space(3), gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line },
  chipActive: { backgroundColor: theme.brand, borderColor: theme.brand },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.xl, padding: space(3.5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
});
