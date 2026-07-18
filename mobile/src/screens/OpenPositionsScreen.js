import React, { useCallback, useRef, useState } from "react";
import { View, Text, FlatList, Dimensions, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadOpenPositions } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { Press, Loader, EmptyState, TopBar, IconChip, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { JOB_STAGES, stageColor } from "@aster/shared";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = Math.round(SCREEN_W * 0.80);
const GAP = 16;
const SNAP = CARD_W + GAP;
const SIDE = (SCREEN_W - CARD_W) / 2; // centers the active card

// Positive funnel stages for the mini pipeline bar.
const PIPE = ["applied", "shortlisted", "interviewing", "offer", "hired"];

function daysOpen(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "Today" : `${d}d open`;
}

export default function OpenPositionsScreen({ navigation }) {
  const { profile, manager, assignedJobIds } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    if (!profile) return;
    const all = await loadOpenPositions(profile.companyId, { manager, assignedJobIds });
    // Open roles only.
    setJobs(all.filter((r) => r.status === "open"));
  }, [profile, manager, assignedJobIds]);

  // Blue screen → light status bar.
  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));
  useAutoRefresh(profile?.companyId, load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (jobs === null) return <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }}><Loader label="Loading roles…" /></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.brand }} edges={["top"]}>
      {/* Same header as the Pipeline dashboard */}
      <TopBar
        mark
        name={profile?.name?.split(" ")[0] || "Welcome"}
        right={<IconChip name="bell" tint={theme.white} bg={theme.brandPanel} onPress={() => navigation.navigate("Notifications")} />}
      />
      <Text style={styles.sectionLabel}>OPEN ROLES · {jobs.length}</Text>

      {jobs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", paddingBottom: 80 }}>
          <EmptyState icon="briefcase" title="No open roles"
            subtitle={manager ? "Open a role on the web app and it'll appear here." : "You're not on any open role's panel yet."} />
        </View>
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={jobs}
            keyExtractor={(j) => j.id}
            horizontal
            style={{ flexGrow: 0 }}
            showsHorizontalScrollIndicator={false}
            snapToInterval={SNAP}
            decelerationRate="fast"
            disableIntervalMomentum
            contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: space(3) }}
            ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
            onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / SNAP))}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
            renderItem={({ item, index }) => (
              <RoleCard
                job={item}
                active={index === active}
                onPress={() => navigation.navigate("JobDetail", { jobId: item.id, jobTitle: item.title, job: item })}
              />
            )}
          />
          {/* Pagination dots */}
          <View style={styles.dots}>
            {jobs.map((j, i) => (
              <View key={j.id} style={[styles.dot, i === active && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function RoleCard({ job, onPress }) {
  const total = job.applicantCount || 0;
  const hired = job.counts.hired || 0;
  const toReview = (job.counts.interviewing || 0) + (job.counts.offer || 0);
  const shortlisted = job.counts.shortlisted || 0;
  // Every card looks the same — translucent white on the blue. The centred card
  // is shown by position + the dots, not by a colour change.
  const fgMuted = "rgba(255,255,255,0.74)";

  return (
    <Press onPress={onPress} scaleTo={0.97}>
      <View style={styles.card}>
        {/* top: status + days */}
        <View style={styles.cardTop}>
          <View style={styles.statusPill}>
            <View style={[styles.statusDot, { backgroundColor: theme.white }]} />
            <Text style={[type.smallStrong, { color: theme.white }]}>Open</Text>
          </View>
          {daysOpen(job.postedAt) ? (
            <Text style={[type.small, { color: fgMuted }]}>{daysOpen(job.postedAt)}</Text>
          ) : null}
        </View>

        {/* title */}
        <Text style={[styles.title, { color: theme.white }]} numberOfLines={3}>{job.title}</Text>
        {job.location ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
            <Feather name="map-pin" size={13} color={fgMuted} />
            <Text style={[type.small, { color: fgMuted, marginLeft: 5 }]} numberOfLines={1}>{job.location}</Text>
          </View>
        ) : null}

        <View style={{ flex: 1 }} />

        {/* hires + pipeline context */}
        <Text style={[styles.bigNum, { color: theme.white }]}>{hired}</Text>
        <Text style={[type.small, { color: fgMuted, marginTop: -2 }]}>
          hired · {total} in pipeline{shortlisted ? ` · ${shortlisted} shortlisted` : ""}
        </Text>

        {/* pipeline bar — keeps its stage colours */}
        <View style={[styles.pipe, { backgroundColor: "rgba(255,255,255,0.22)" }]}>
          {total > 0 && PIPE.map((k) => {
            const n = job.counts[k] || 0;
            if (!n) return null;
            return <View key={k} style={{ flex: n, backgroundColor: stageColor(k) }} />;
          })}
        </View>

        {/* bottom action bar */}
        <View style={styles.actionRow}>
          {toReview > 0 ? (
            <View style={styles.reviewChip}>
              <Feather name="clock" size={12} color={theme.white} />
              <Text style={[type.smallStrong, { color: theme.white, marginLeft: 5 }]}>{toReview} to review</Text>
            </View>
          ) : <View />}
          <View style={styles.viewBtn}>
            <Text style={[type.smallStrong, { color: theme.brand }]}>View</Text>
            <Feather name="arrow-right" size={16} color={theme.brand} style={{ marginLeft: 5 }} />
          </View>
        </View>
      </View>
    </Press>
  );
}

const CARD_H = Math.min(500, Math.round(Dimensions.get("window").height * 0.60));

const styles = StyleSheet.create({
  sectionLabel: { color: theme.onBrandMuted, fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.2, paddingHorizontal: space(5), paddingTop: space(1), paddingBottom: space(1) },
  card: { width: CARD_W, height: CARD_H, borderRadius: 28, padding: space(5), backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.20)" },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, lineHeight: 31, letterSpacing: -0.5, marginTop: space(4) },
  bigNum: { fontFamily: "Inter_700Bold", fontSize: 40, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  pipe: { flexDirection: "row", height: 9, borderRadius: radius.pill, overflow: "hidden", marginTop: space(4), gap: 2 },
  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space(4) },
  reviewChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.20)" },
  viewBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 40, borderRadius: radius.pill, backgroundColor: theme.white },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingTop: space(5), paddingBottom: space(4) },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotActive: { width: 22, backgroundColor: theme.white },
});
