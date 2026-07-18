import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadApplicants } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { Press, ScreenHeader, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { relTime } from "@aster/shared";

const PIPE = ["applied", "shortlisted", "interviewing", "offer", "hired"];

export default function JobDetailScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { jobId, jobTitle, job } = route.params || {};
  const [applicants, setApplicants] = useState(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setApplicants(await loadApplicants(profile.companyId, jobId));
  }, [profile, jobId]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));
  useAutoRefresh(profile?.companyId, load);

  // Derive counts from the live applicant list once it loads; fall back to the
  // snapshot passed in from the Roles carousel until then.
  const counts = useMemo(() => {
    if (!applicants) return job?.counts || {};
    const c = {};
    for (const a of applicants) c[a.stage] = (c[a.stage] || 0) + 1;
    return c;
  }, [applicants, job]);
  const total = applicants ? applicants.length : (job?.applicantCount ?? 0);
  const hired = counts.hired || 0;
  const toReview = (counts.interviewing || 0) + (counts.offer || 0);

  const goCandidates = (filter) => navigation.navigate("PositionApplicants", { jobId, jobTitle, initialFilter: filter });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader eyebrow="Role" title={jobTitle || "Role"} onBack={() => navigation.goBack()} />
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} showsVerticalScrollIndicator={false}>
          {/* Hero card — taps through to the full candidate list */}
          <Press onPress={() => goCandidates("all")} haptic="medium" scaleTo={0.98}>
            <LinearGradient colors={["#123AF0", "#0B2AE0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <View style={styles.openBadge}>
                <View style={styles.openDot} />
                <Text style={[type.smallStrong, { color: theme.white }]}>Open</Text>
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

              <View style={styles.heroCta}>
                <Text style={[type.smallStrong, { color: theme.white }]}>View all candidates</Text>
                <Feather name="arrow-right" size={16} color={theme.white} style={{ marginLeft: 6 }} />
              </View>
            </LinearGradient>
          </Press>
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

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space(5), shadowColor: theme.brand, shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  openBadge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#7DE2A8", marginRight: 6 },
  heroNum: { color: theme.white, fontFamily: "Inter_700Bold", fontSize: 46, letterSpacing: -1.5, marginTop: space(4), fontVariant: ["tabular-nums"] },
  heroPipe: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", marginTop: space(4), gap: 2, backgroundColor: "rgba(255,255,255,0.18)" },
  heroFoot: { flexDirection: "row", justifyContent: "space-between", marginTop: space(5) },
  heroCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: space(5), paddingTop: space(4), borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" },
});
