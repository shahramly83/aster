import React, { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, ScrollView, Pressable, RefreshControl, Alert, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../AuthContext";
import { loadApplicants, moveCandidateStage } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { Press, Avatar, StagePill, Loader, EmptyState, Feather } from "../components/ui";
import { RingFull } from "../components/Gauge";
import { theme, type, space, radius } from "../theme";
import { stageColor, relTime } from "@aster/shared";

const SHORTLISTED_PLUS = ["shortlisted", "interviewing", "offer", "hired"];

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
  const [filter, setFilter] = useState(route.params?.initialFilter || "all");

  const load = useCallback(async () => {
    if (!profile) return;
    setRows(await loadApplicants(profile.companyId, jobId));
  }, [profile, jobId]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));
  useAutoRefresh(profile?.companyId, load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Star toggles a candidate between applied and shortlisted (web-safe stage move).
  const toggleStar = async (item) => {
    const next = item.stage === "applied" ? "shortlisted" : item.stage === "shortlisted" ? "applied" : null;
    if (!next) return; // already past shortlist
    setRows((prev) => prev.map((r) => (r.candidateId === item.candidateId ? { ...r, stage: next } : r)));
    try {
      await moveCandidateStage({ companyId: profile.companyId, candidateId: item.candidateId, candidateName: item.name, stage: next });
    } catch (e) {
      setRows((prev) => prev.map((r) => (r.candidateId === item.candidateId ? { ...r, stage: item.stage } : r)));
      Alert.alert("Could not update", e?.message || "Please try again.");
    }
  };

  const filtered = useMemo(
    () => (rows || []).filter((r) => filter === "all" || r.stage === filter),
    [rows, filter]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Blue header — minimal title block */}
      <View style={styles.header}>
        <SafeAreaView edges={["top"]}>
          <View style={styles.headRow}>
            <Press onPress={() => navigation.goBack()} haptic="light" style={styles.back}>
              <Feather name="arrow-left" size={20} color={theme.white} />
            </Press>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.eyebrow}>
                {rows ? `${rows.length} CANDIDATE${rows.length === 1 ? "" : "S"}` : "LOADING"}
              </Text>
              <Text style={styles.headTitle} numberOfLines={2}>{jobTitle || "Candidates"}</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* Light body */}
      {rows === null ? (
        <Loader label="Loading candidates…" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.applicationId}
          contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(10), flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
          ListHeaderComponent={
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const count = f.key === "all" ? rows.length : rows.filter((r) => r.stage === f.key).length;
                return (
                  <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[type.smallStrong, { color: active ? theme.white : theme.ink2 }]}>{f.label}</Text>
                    <Text style={[type.smallStrong, { color: active ? "rgba(255,255,255,0.8)" : theme.ink4, marginLeft: 5, fontVariant: ["tabular-nums"] }]}>{count}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          }
          ListEmptyComponent={<View style={{ marginTop: space(10) }}><EmptyState icon="users" title="No candidates here" subtitle={filter === "all" ? "Applicants for this role will show here." : "No one in this stage yet."} /></View>}
          renderItem={({ item }) => <CandidateCard item={item} onStar={() => toggleStar(item)} onPress={() => navigation.navigate("CandidateProfile", { candidateId: item.candidateId, applicationId: item.applicationId, jobId, stage: item.stage, candidateName: item.name })} />}
        />
      )}
    </View>
  );
}

function CandidateCard({ item, onPress, onStar }) {
  const sc = stageColor(item.stage);
  const starred = SHORTLISTED_PLUS.includes(item.stage);
  const canToggle = item.stage === "applied" || item.stage === "shortlisted";
  return (
    <Press onPress={onPress} style={{ marginBottom: space(3) }}>
      <View style={styles.card}>
        <View style={[styles.rail, { backgroundColor: sc }]} />
        {/* top: identity + star + match ring */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[styles.avatarRing, { borderColor: sc }]}>
            <Avatar uri={item.avatarUrl} name={item.name} size={50} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[type.h3, { color: theme.ink }]} numberOfLines={1}>{item.name}</Text>
            {item.title ? <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{item.title}</Text> : null}
            <View style={styles.metaRow}>
              <StagePill stage={item.stage} small />
              {item.years != null ? (
                <View style={styles.metaPill}><Text style={[type.smallStrong, { color: theme.ink3 }]}>{item.years}y exp</Text></View>
              ) : null}
            </View>
          </View>
          <View style={{ alignItems: "center", marginLeft: 8 }}>
            <Pressable onPress={canToggle ? onStar : undefined} disabled={!canToggle} hitSlop={8} style={{ padding: 3 }}>
              <Ionicons name={starred ? "star" : "star-outline"} size={22} color={starred ? "#F5A623" : theme.ink4} />
            </Pressable>
            <View style={{ marginTop: 4 }}><MatchRing score={item.matchScore} /></View>
          </View>
        </View>

        {/* skills */}
        {item.skills && item.skills.length ? (
          <View style={styles.skillsRow}>
            {item.skills.map((s, i) => (
              <View key={i} style={styles.skill}><Text style={[type.small, { color: theme.ink2 }]} numberOfLines={1}>{String(s)}</Text></View>
            ))}
          </View>
        ) : null}

        {/* footer */}
        <View style={styles.footer}>
          <Text style={[type.small, { color: theme.ink4 }]}>
            {item.appliedAt ? `Applied ${relTime(item.appliedAt)}` : "In pipeline"}
          </Text>
          <View style={styles.viewRow}>
            <Text style={[type.smallStrong, { color: theme.brand }]}>View profile</Text>
            <Feather name="arrow-right" size={15} color={theme.brand} style={{ marginLeft: 5 }} />
          </View>
        </View>
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
  header: { backgroundColor: theme.brand },
  headRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(5) },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  eyebrow: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.4, color: "rgba(255,255,255,0.72)", marginBottom: 5 },
  headTitle: { fontFamily: "Inter_700Bold", fontSize: 23, lineHeight: 28, letterSpacing: -0.3, color: theme.white },
  filters: { paddingVertical: space(4), gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line },
  chipActive: { backgroundColor: theme.brand, borderColor: theme.brand },
  card: { backgroundColor: theme.card, borderRadius: radius.xl, padding: space(4), paddingLeft: space(5), overflow: "hidden", shadowColor: "#1A1A22", shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  rail: { position: "absolute", left: 0, top: 16, bottom: 16, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  avatarRing: { padding: 2.5, borderRadius: 31, borderWidth: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 },
  metaPill: { backgroundColor: theme.line2, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  skillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: space(3.5) },
  skill: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space(4), paddingTop: space(3), borderTopWidth: 1, borderTopColor: theme.line2 },
  viewRow: { flexDirection: "row", alignItems: "center" },
  matchWrap: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  matchCenter: { position: "absolute", alignItems: "center" },
  matchNum: { fontFamily: "Inter_700Bold", fontSize: 15, lineHeight: 16, fontVariant: ["tabular-nums"] },
  matchLbl: { fontFamily: "Inter_500Medium", fontSize: 8, color: theme.ink4, letterSpacing: 0.3, marginTop: 1 },
});
