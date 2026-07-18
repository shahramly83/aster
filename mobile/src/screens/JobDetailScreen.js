import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, Share, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadApplicants } from "../lib/data";
import { Press, Avatar, ScreenHeader, Loader, EmptyState, Feather } from "../components/ui";
import { AsterMark } from "../components/Logo";
import { theme, type, space, radius } from "../theme";
import { JOB_STAGES, stageColor, stageLabel, relTime } from "@aster/shared";

const PIPE = ["applied", "shortlisted", "interviewing", "offer", "hired"];

export default function JobDetailScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { jobId, jobTitle, job } = route.params || {};
  const [applicants, setApplicants] = useState(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setApplicants(await loadApplicants(profile.companyId, jobId));
  }, [profile, jobId]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); load(); }, [load]));

  const counts = job?.counts || {};
  const total = job?.applicantCount ?? (applicants ? applicants.length : 0);
  const hired = counts.hired || 0;
  const toReview = (counts.interviewing || 0) + (counts.offer || 0);
  const recent = (applicants || []).slice().sort((a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0)).slice(0, 5);

  const goCandidates = (filter) => navigation.navigate("PositionApplicants", { jobId, jobTitle, initialFilter: filter });
  const share = () => Share.share({ message: `Apply for ${jobTitle} at ${profile?.company || "our team"} — https://hireaster.com` }).catch(() => {});

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader eyebrow="Role" title={jobTitle || "Role"} onBack={() => navigation.goBack()} />
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} showsVerticalScrollIndicator={false}>
          {/* Hero card */}
          <LinearGradient colors={["#123AF0", "#0B2AE0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={styles.openBadge}>
                <View style={styles.openDot} />
                <Text style={[type.smallStrong, { color: theme.white }]}>Open</Text>
              </View>
              <AsterMark size={30} color="rgba(255,255,255,0.9)" />
            </View>
            <Text style={styles.heroNum}>{total}</Text>
            <Text style={[type.small, { color: "rgba(255,255,255,0.75)" }]}>candidate{total === 1 ? "" : "s"} in pipeline</Text>

            {/* pipeline bar */}
            <View style={styles.heroPipe}>
              {total > 0 && PIPE.map((k, i) => {
                const n = counts[k] || 0;
                if (!n) return null;
                return <View key={k} style={{ flex: n, backgroundColor: `rgba(255,255,255,${0.95 - i * 0.15})` }} />;
              })}
            </View>

            <View style={styles.heroFoot}>
              <HeroStat label="Hired" value={hired} />
              <HeroStat label="To review" value={toReview} />
              <HeroStat label="Posted" value={job?.postedAt ? relTime(job.postedAt) : "—"} small />
            </View>
          </LinearGradient>

          {/* Quick actions */}
          <View style={styles.actions}>
            <Action icon="users" label="Candidates" onPress={() => goCandidates("all")} />
            <Action icon="star" label="Shortlist" onPress={() => goCandidates("shortlisted")} />
            <Action icon="calendar" label="Interviews" onPress={() => goCandidates("interviewing")} />
            <Action icon="share-2" label="Share" onPress={share} />
          </View>

          {/* Recent applicants */}
          <View style={styles.sheet}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(3) }}>
              <Text style={[type.h3, { color: theme.ink }]}>Recent applicants</Text>
              <Press onPress={() => goCandidates("all")} haptic="light"><Text style={[type.smallStrong, { color: theme.brand }]}>View all</Text></Press>
            </View>
            {applicants === null ? (
              <Loader />
            ) : recent.length === 0 ? (
              <EmptyState icon="users" title="No candidates yet" subtitle="Applicants for this role will show here." />
            ) : (
              recent.map((a, i) => (
                <Press key={a.applicationId} onPress={() => navigation.navigate("CandidateProfile", { candidateId: a.candidateId, applicationId: a.applicationId, jobId, stage: a.stage, candidateName: a.name })} haptic="light">
                  <View style={[styles.appRow, i > 0 && styles.appDivider]}>
                    <Avatar uri={a.avatarUrl} name={a.name} size={42} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={1}>{a.name}</Text>
                      <Text style={[type.small, { color: theme.ink4, marginTop: 1 }]}>{a.appliedAt ? `Applied ${relTime(a.appliedAt)}` : stageLabel(a.stage)}</Text>
                    </View>
                    {typeof a.matchScore === "number" ? (
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.score, { color: a.matchScore >= 75 ? theme.success : a.matchScore >= 50 ? theme.warn : theme.ink3 }]}>{Math.round(a.matchScore)}</Text>
                        <Text style={[type.small, { color: theme.ink4, fontSize: 10 }]}>match</Text>
                      </View>
                    ) : (
                      <View style={[styles.stageMini, { backgroundColor: stageColor(a.stage) + "1A" }]}>
                        <Text style={[type.smallStrong, { color: theme.ink2, fontSize: 11 }]}>{stageLabel(a.stage)}</Text>
                      </View>
                    )}
                  </View>
                </Press>
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function HeroStat({ label, value, small }) {
  return (
    <View>
      <Text style={[type.label, { color: "rgba(255,255,255,0.6)", marginBottom: 3 }]}>{label.toUpperCase()}</Text>
      <Text style={[{ color: theme.white, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] }, small ? { fontSize: 14 } : { fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

function Action({ icon, label, onPress }) {
  return (
    <Press onPress={onPress} haptic="light" style={{ alignItems: "center", flex: 1 }}>
      <View style={styles.actionBtn}><Feather name={icon} size={20} color={theme.brand} /></View>
      <Text style={[type.small, { color: theme.ink2, marginTop: 7 }]}>{label}</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space(5), shadowColor: theme.brand, shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  openBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#7DE2A8", marginRight: 6 },
  heroNum: { color: theme.white, fontFamily: "Inter_700Bold", fontSize: 46, letterSpacing: -1.5, marginTop: space(4), fontVariant: ["tabular-nums"] },
  heroPipe: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", marginTop: space(4), gap: 2, backgroundColor: "rgba(255,255,255,0.18)" },
  heroFoot: { flexDirection: "row", justifyContent: "space-between", marginTop: space(5) },
  actions: { flexDirection: "row", marginTop: space(5), marginBottom: space(2) },
  actionBtn: { width: 52, height: 52, borderRadius: radius.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center", shadowColor: "#1A1A22", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  sheet: { backgroundColor: theme.card, borderRadius: radius.xl, padding: space(4), marginTop: space(4), borderWidth: 1, borderColor: theme.line },
  appRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(3) },
  appDivider: { borderTopWidth: 1, borderTopColor: theme.line2 },
  score: { fontFamily: "Inter_700Bold", fontSize: 17, fontVariant: ["tabular-nums"] },
  stageMini: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
});
