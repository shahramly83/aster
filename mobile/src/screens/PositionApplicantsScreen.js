import React, { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, ScrollView, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadApplicants } from "../lib/data";
import { Press, Avatar, StagePill, Loader, EmptyState, Feather } from "../components/ui";
import { RingFull } from "../components/Gauge";
import { theme, type, space, radius } from "../theme";
import { stageColor } from "@aster/shared";

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

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(
    () => (rows || []).filter((r) => filter === "all" || r.stage === filter),
    [rows, filter]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Blue header (only the header is blue) */}
      <View style={styles.header}>
        <SafeAreaView edges={["top"]}>
          <View style={styles.headRow}>
            <Press onPress={() => navigation.goBack()} haptic="light" style={styles.back}>
              <Feather name="chevron-left" size={22} color={theme.white} />
            </Press>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={[type.h2, { color: theme.white }]} numberOfLines={1}>{jobTitle || "Candidates"}</Text>
              <Text style={[type.small, { color: "rgba(255,255,255,0.72)", marginTop: 1 }]}>
                {rows ? `${rows.length} candidate${rows.length === 1 ? "" : "s"}` : "Loading…"}
              </Text>
            </View>
          </View>

          {rows ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const count = f.key === "all" ? rows.length : rows.filter((r) => r.stage === f.key).length;
                return (
                  <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[type.smallStrong, { color: active ? theme.brand : theme.white }]}>{f.label}</Text>
                    <Text style={[type.smallStrong, { color: active ? theme.brand : "rgba(255,255,255,0.6)", marginLeft: 5, fontVariant: ["tabular-nums"] }]}>{count}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>

      {/* Light body */}
      {rows === null ? (
        <Loader label="Loading candidates…" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.applicationId}
          contentContainerStyle={{ padding: space(4), paddingBottom: space(10), flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
          ListEmptyComponent={<View style={{ marginTop: space(12) }}><EmptyState icon="users" title="No candidates here" subtitle={filter === "all" ? "Applicants for this role will show here." : "No one in this stage yet."} /></View>}
          renderItem={({ item }) => <CandidateCard item={item} onPress={() => navigation.navigate("CandidateProfile", { candidateId: item.candidateId, applicationId: item.applicationId, jobId, stage: item.stage, candidateName: item.name })} />}
        />
      )}
    </View>
  );
}

function CandidateCard({ item, onPress }) {
  const sc = stageColor(item.stage);
  return (
    <Press onPress={onPress} style={{ marginBottom: space(3) }}>
      <View style={styles.card}>
        {/* stage-colored accent rail */}
        <View style={[styles.rail, { backgroundColor: sc }]} />
        {/* avatar with stage ring */}
        <View style={[styles.avatarRing, { borderColor: sc }]}>
          <Avatar uri={item.avatarUrl} name={item.name} size={48} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{item.name}</Text>
          {item.title ? <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{item.title}</Text> : null}
          <View style={{ marginTop: 8 }}><StagePill stage={item.stage} small /></View>
        </View>
        <MatchRing score={item.matchScore} />
      </View>
    </Press>
  );
}

function MatchRing({ score }) {
  if (typeof score !== "number") {
    return <Feather name="chevron-right" size={22} color={theme.ink4} />;
  }
  const v = Math.round(score);
  const color = v >= 75 ? theme.success : v >= 50 ? theme.warn : theme.ink3;
  return (
    <View style={styles.matchWrap}>
      <RingFull pct={v} size={52} stroke={5} color={color} track="#EDEFF5" />
      <View style={styles.matchCenter} pointerEvents="none">
        <Text style={[styles.matchNum, { color: theme.ink }]}>{v}</Text>
        <Text style={styles.matchLbl}>match</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: theme.brand, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingBottom: space(3) },
  headRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), paddingTop: space(1), paddingBottom: space(2) },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  filters: { paddingHorizontal: space(4), paddingTop: space(1), gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.15)" },
  chipActive: { backgroundColor: theme.white },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.xl, padding: space(3.5), paddingLeft: space(4), overflow: "hidden", shadowColor: "#1A1A22", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  rail: { position: "absolute", left: 0, top: 14, bottom: 14, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  avatarRing: { padding: 2.5, borderRadius: 30, borderWidth: 2 },
  matchWrap: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  matchCenter: { position: "absolute", alignItems: "center" },
  matchNum: { fontFamily: "Inter_700Bold", fontSize: 15, lineHeight: 16, fontVariant: ["tabular-nums"] },
  matchLbl: { fontFamily: "Inter_500Medium", fontSize: 8, color: theme.ink4, letterSpacing: 0.3, marginTop: 1 },
});
