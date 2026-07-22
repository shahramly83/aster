import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, ScrollView, Pressable, Modal, RefreshControl, ActivityIndicator, Alert, StyleSheet, Keyboard, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useAuth } from "../AuthContext";
import { useNotifications } from "../NotificationsContext";
import { loadApplicants, moveCandidateStage, runAiRank, loadJobRankedAt, loadInterviewers, assignInterviewer, unassignInterviewer, loadMyShortlist, setShortlisted } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { Press, Avatar, HeaderActions, StagePill, EmptyState, Feather } from "../components/ui";
import { RingFull } from "../components/Gauge";
import { theme, type, space, radius } from "../theme";
import { stageColor, relTime } from "@aster/shared";

const PIPE = ["applied", "shortlisted", "interviewing", "offer", "hired"];
// Quick source tags for the apply link (same presets as the web link modal).
const SOURCE_PRESETS = ["LinkedIn", "Career Page", "Referral", "JobStreet", "Facebook", "WhatsApp"];

const FILTERS = [
  { key: "all", label: "All" },
  { key: "applied", label: "Applied" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "interviewing", label: "Interview" },
  { key: "offer", label: "Offer" },
];

export default function JobDetailScreen({ route, navigation }) {
  const { profile } = useAuth();
  // Bottom-sheet padding must clear the Android navigation bar. Two traps here:
  // an empty <SafeAreaView edges={["bottom"]}/> spacer collapses to nothing, and
  // a React Native <Modal> renders in its OWN window on Android, so the inset
  // from the root provider frequently reports 0 inside it. Relying on the inset
  // alone left ~12px of padding and the last row sat on the system nav. Floor it
  // so the sheet always clears the bar (same guard FloatingTabBar uses).
  const insets = useSafeAreaInsets();
  const sheetPadBottom = Math.max(insets.bottom, 24) + space(4);
  const { unread } = useNotifications();
  const { jobId, jobTitle, job } = route.params || {};
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState(route.params?.initialFilter || "all");
  const [ranking, setRanking] = useState(false);
  const [rankedAtLocal, setRankedAtLocal] = useState(null);   // set the instant a run finishes
  const [serverRankedAt, setServerRankedAt] = useState(null); // jobs.ai_ranked_at, refreshed on load
  const [rankNotice, setRankNotice] = useState(null);         // { type: "ok"|"err", text }
  const [interviewers, setInterviewers] = useState(null);     // interviewer pool for this job
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingId, setSavingId] = useState(null);             // profile id mid assign/unassign
  // Application ids this user has starred. A star is a personal BOOKMARK, kept
  // in candidate_shortlists — deliberately NOT applications.stage, so marking
  // someone to look at later never advances them through the hiring funnel.
  const [starred, setStarred] = useState(() => new Set());

  const canManageInterviewers = ["owner", "admin"].includes((profile?.role || "").toLowerCase());

  // Public apply page link on the workspace's own subdomain (<slug>.hireaster.com),
  // with optional source tagging — mirrors the web buildLink module.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSource, setLinkSource] = useState("");
  const [copied, setCopied] = useState(false);
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const s = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setKb(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const applyBase = profile?.companySlug
    ? `https://${profile.companySlug}.hireaster.com/apply/${jobId}`
    : `https://hireaster.com/apply/${jobId}`;
  const slugifySource = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const applyUrl = (() => { const s = slugifySource(linkSource); return s ? `${applyBase}?source=${s}` : applyBase; })();
  const copyApplyLink = async () => {
    await Clipboard.setStringAsync(applyUrl);
    setCopied(true);
    Haptics.selectionAsync().catch(() => {});
    setTimeout(() => setCopied(false), 1800);
  };

  const load = useCallback(async () => {
    if (!profile) return;
    const [apps, jr, team, picks] = await Promise.all([
      loadApplicants(profile.companyId, jobId),
      loadJobRankedAt(jobId),
      loadInterviewers(profile.companyId, jobId),
      loadMyShortlist(profile.companyId, profile.userId),
    ]);
    setRows(apps);
    setServerRankedAt(jr);
    setInterviewers(team);
    setStarred(new Set(picks));
  }, [profile, jobId]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));
  useAutoRefresh(profile?.companyId, load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // The candidates this screen lists: strong matches still in the running. Hired,
  // rejected and declined all leave the list. "other"-fit applicants stay in the
  // talent pool; a manual shortlist overrides the AI and counts as strong.
  const OUT_OF_LIST = ["hired", "rejected", "declined"];
  const strongRows = useMemo(
    () => (rows || []).filter((r) =>
      !OUT_OF_LIST.includes(r.stage) && (r.fit !== "other" || r.stage === "shortlisted")),
    [rows]
  );

  // Hero "in pipeline" reflects exactly what's on screen (the "All" set). Hired is
  // a separate summary stat, so it still counts everyone hired for this role. We
  // show placeholders until the list loads rather than the Roles snapshot, so the
  // number never flashes the full pipeline count and then drops to strong-only.
  const loaded = rows !== null;
  const counts = useMemo(() => {
    const c = {};
    for (const a of strongRows) c[a.stage] = (c[a.stage] || 0) + 1;
    return c;
  }, [strongRows]);
  const total = loaded ? strongRows.length : null;
  const hired = loaded ? rows.filter((r) => r.stage === "hired").length : null;
  const toReview = loaded ? (counts.interviewing || 0) + (counts.offer || 0) : null;

  // Star = add/remove a personal bookmark, nothing else. It used to move the
  // candidate applied <-> shortlisted, which advanced them in the pipeline (and
  // counted as "advanced past applied" in Pipeline Health) for what the user
  // meant as "remember this one". Stage now only changes on a real pipeline
  // action. Works on any stage, not just applied/shortlisted.
  const toggleStar = async (item) => {
    const id = item.applicationId;
    if (!id) return;
    const on = !starred.has(id);
    setStarred((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    try {
      await setShortlisted({ companyId: profile.companyId, userId: profile.userId, applicationId: id, on });
    } catch (e) {
      setStarred((prev) => { const n = new Set(prev); if (on) n.delete(id); else n.add(id); return n; });
      Alert.alert("Could not update", e?.message || "Please try again.");
    }
  };

  const filtered = useMemo(
    () => strongRows.filter((r) => filter === "all" || r.stage === filter),
    [strongRows, filter]
  );

  // ---- AI Rank gating (mirrors web) ----
  // Only Applied + Shortlisted strong matches are rankable.
  const RANKABLE = ["applied", "shortlisted"];
  const activeRows = strongRows.filter((r) => RANKABLE.includes(r.stage));
  const canRank = activeRows.length >= 2;                 // needs 2+ candidates to compare
  const hasScores = (rows || []).some((r) => typeof r.matchScore === "number");
  const rankUnits = Math.max(1, Math.ceil(Math.min(activeRows.length, 40) / 10));
  // Latest of: server stamp, the snapshot from the carousel, and this session's run.
  const effRankedAt = [serverRankedAt, job?.aiRankedAt, rankedAtLocal].filter(Boolean).sort().slice(-1)[0] || null;
  // A new candidate = an application newer than the last rank; that unlocks it again.
  const hasNewSinceRank = effRankedAt ? (rows || []).some((r) => r.appliedAt && r.appliedAt > effRankedAt) : true;
  const rankLocked = !!effRankedAt && !hasNewSinceRank;

  const doRank = async () => {
    setRanking(true);
    setRankNotice(null);
    try {
      const res = await runAiRank({ companyId: profile.companyId, jobId, job });
      if (res.ok) {
        setRankedAtLocal(new Date().toISOString());
        setRankNotice({ type: "ok", text: "Rankings updated and synced." });
        await load();
      } else if (res.reason === "min") {
        setRankNotice({ type: "err", text: "AI Rank needs at least 2 candidates to rank." });
      } else if (res.reason === "limit") {
        setRankNotice({ type: "err", text: "You're out of AI Rank credits this month. Top up on the web app to run again." });
      } else {
        setRankNotice({ type: "err", text: res.error ? `Couldn't rank: ${res.error}` : "Couldn't rank these applicants. No credit was used." });
      }
    } catch (e) {
      setRankNotice({ type: "err", text: "Couldn't rank these applicants. No credit was used." });
    } finally {
      setRanking(false);
    }
  };

  const onRankPress = () => {
    if (ranking) return;
    // Clickable even when it can't run, so a tap explains WHY.
    if (!canRank) { setRankNotice({ type: "err", text: "AI Rank needs at least 2 candidates to rank. Once two or more applicants are ready, you can score them against this role." }); return; }
    if (rankLocked) { setRankNotice({ type: "err", text: "These applicants are already ranked. AI Rank unlocks again the moment a new candidate applies, so you're not charged to re-rank an unchanged list." }); return; }
    Alert.alert(
      hasScores ? "Re-run AI Rank?" : "Run AI Rank?",
      `Scores your ${Math.min(activeRows.length, 40)} candidate${activeRows.length === 1 ? "" : "s"} against this role and uses ${rankUnits} AI Rank credit${rankUnits === 1 ? "" : "s"}.`,
      [{ text: "Cancel", style: "cancel" }, { text: hasScores ? "Re-run" : "Run", onPress: doRank }]
    );
  };

  const rankLabel = ranking ? "Ranking" : rankLocked ? "Ranked" : hasScores ? "Re-run" : "AI Rank";

  // ---- Interviewers ----
  // Assignment happens through the header picker sheet, which renders the full
  // team with an `assigned` checkmark. The count rides on the header chip so the
  // page still answers "who's on this role?" without opening the sheet.
  const assignedCount = (interviewers || []).filter((m) => m.assigned).length;
  const toggleInterviewer = async (m) => {
    if (savingId) return;
    setSavingId(m.id);
    const next = !m.assigned;
    // Optimistic flip.
    setInterviewers((prev) => prev.map((x) => (x.id === m.id ? { ...x, assigned: next } : x)));
    const err = next
      ? await assignInterviewer(jobId, m.id)
      : await unassignInterviewer(jobId, m.id);
    if (err) {
      setInterviewers((prev) => prev.map((x) => (x.id === m.id ? { ...x, assigned: !next } : x)));
      Alert.alert("Couldn't update interviewers", err);
    }
    setSavingId(null);
  };

  const header = (
    <View>
      {/* Hero card */}
      <LinearGradient colors={["#123AF0", "#0B2AE0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={styles.openBadge}>
            <View style={styles.openDot} />
            <Text style={[type.smallStrong, { color: theme.white }]}>Open</Text>
          </View>
          <Pressable onPress={() => { setLinkSource(""); setCopied(false); setLinkOpen(true); }} style={styles.applyChip} hitSlop={6}>
            <Feather name="link" size={13} color={theme.white} />
            <Text style={[type.smallStrong, { color: theme.white, marginLeft: 6 }]}>Copy apply link</Text>
          </Pressable>
        </View>
        <Text style={styles.heroTitle} numberOfLines={2}>{jobTitle || "Role"}</Text>
        <Text style={styles.heroNum}>{loaded ? total : "—"}</Text>
        <Text style={[type.small, { color: "rgba(255,255,255,0.75)" }]}>candidate{total === 1 ? "" : "s"} in pipeline</Text>

        <View style={styles.heroPipe}>
          {loaded && total > 0 && PIPE.map((k) => {
            const n = counts[k] || 0;
            if (!n) return null;
            return <View key={k} style={{ flex: n, backgroundColor: stageColor(k) }} />;
          })}
        </View>

        <View style={styles.heroFoot}>
          <HeroStat label="Hired" value={loaded ? hired : "—"} />
          <HeroStat label="To review" value={loaded ? toReview : "—"} />
          <HeroStat label="Posted" value={job?.postedAt ? relTime(job.postedAt) : "—"} small />
        </View>
      </LinearGradient>

      {/* Interviewers now live in the top bar (user-plus chip), which opens the
          same picker sheet. The body card was a duplicate of that entry point. */}

      {/* AI Rank */}
      <View style={styles.rankBar}>
        <View style={styles.rankIcon}>
          <Feather name={rankLocked || (!canRank && !ranking) ? "lock" : "zap"} size={16} color={theme.brand} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[type.bodyStrong, { color: theme.ink }]}>AI Rank</Text>
        </View>
        <Pressable
          onPress={onRankPress}
          disabled={ranking}
          style={[styles.rankBtn, (rankLocked || !canRank) && styles.rankBtnMuted, ranking && { opacity: 0.7 }]}
        >
          {ranking ? (
            <ActivityIndicator color={theme.white} size="small" />
          ) : (
            <>
              <Feather name={rankLocked ? "lock" : "zap"} size={14} color={theme.white} />
              <Text style={[type.smallStrong, { color: theme.white, marginLeft: 6 }]}>{rankLabel}</Text>
            </>
          )}
        </Pressable>
      </View>
      {rankNotice ? (
        <View style={[styles.notice, rankNotice.type === "ok" ? styles.noticeOk : styles.noticeErr]}>
          <Feather name={rankNotice.type === "ok" ? "check-circle" : "alert-circle"} size={14} color={rankNotice.type === "ok" ? "#166534" : "#B42318"} />
          <Text style={[type.small, { color: rankNotice.type === "ok" ? "#166534" : "#B42318", marginLeft: 8, flex: 1 }]}>{rankNotice.text}</Text>
        </View>
      ) : null}

      {/* Filter chips */}
      {rows ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count = f.key === "all" ? strongRows.length : strongRows.filter((r) => r.stage === f.key).length;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[type.smallStrong, { color: active ? theme.white : theme.ink2 }]}>{f.label}</Text>
                <Text style={[type.smallStrong, { color: active ? "rgba(255,255,255,0.8)" : theme.ink4, marginLeft: 5, fontVariant: ["tabular-nums"] }]}>{count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Greeting header (same as Dashboard) with a back button for this pushed screen */}
      <View style={styles.topHeader}>
        <SafeAreaView edges={["top"]}>
          <View style={styles.topRow}>
            <Press onPress={() => navigation.goBack()} haptic="light" style={styles.back}>
              <Feather name="arrow-left" size={20} color={theme.white} />
            </Press>
            {/* No wordmark on this pushed screen: the role title already owns the
                page, so the logo was just repeating the brand. The space now
                pushes the actions to the right. */}
            <View style={{ flex: 1 }} />
            <HeaderActions
              unread={unread}
              onAddPeople={canManageInterviewers ? () => setPickerOpen(true) : undefined}
              addPeopleBadge={assignedCount}
              onSettings={() => navigation.navigate("Settings")}
              onBell={() => navigation.navigate("Notifications")}
            />
          </View>
        </SafeAreaView>
      </View>
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        {/* One persistent FlatList so the hero/AI-Rank header never remounts or
            reflows between loading and loaded (that caused the card to "stretch"). */}
        <FlatList
          data={rows === null ? [] : filtered}
          keyExtractor={(r) => r.applicationId}
          contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(10) }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            rows === null ? (
              <View style={{ paddingVertical: space(10), alignItems: "center" }}>
                <ActivityIndicator color={theme.brand} />
                <Text style={[type.small, { color: theme.ink3, marginTop: 12 }]}>Loading candidates…</Text>
              </View>
            ) : (
              <View style={{ marginTop: space(8) }}>
                <EmptyState icon="users" title="No candidates here" subtitle={filter === "all" ? "Applicants for this role will show here." : "No one in this stage yet."} />
              </View>
            )
          }
          renderItem={({ item }) => (
            <CandidateCard
              item={item}
              starred={starred.has(item.applicationId)}
              onStar={() => toggleStar(item)}
              onPress={() => navigation.navigate("CandidateProfile", { candidateId: item.candidateId, applicationId: item.applicationId, jobId, jobTitle, stage: item.stage, candidateName: item.name })}
            />
          )}
        />
      </SafeAreaView>

      {/* Share apply link — tenant subdomain + optional source tag (web parity) */}
      <Modal visible={linkOpen} animationType="slide" transparent onRequestClose={() => setLinkOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setLinkOpen(false)} />
          {/* iOS does NOT resize the window for the keyboard, so the sheet has to
              be lifted manually. Android DOES resize (softwareKeyboardLayoutMode
              "resize"), which already floats a flex-end sheet above the keyboard —
              adding the lift there too shoved it up a second keyboard height and
              pushed the title and source chips off-screen. */}
          <View style={[styles.sheet, { paddingBottom: sheetPadBottom, marginBottom: Platform.OS === "ios" && kb > 0 ? kb : 0 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <Text style={[type.h3, { color: theme.ink }]}>Share apply link</Text>
              <Pressable onPress={() => setLinkOpen(false)} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
            </View>
            <Text style={[type.small, { color: theme.ink3, marginBottom: space(4) }]}>Post this anywhere. Add a source to see which channel your applicants come from.</Text>

            <Text style={[type.smallStrong, { color: theme.ink2, marginBottom: 8 }]}>Tag a source (optional)</Text>
            <View style={styles.tagRow}>
              {SOURCE_PRESETS.map((s) => {
                const on = slugifySource(linkSource) === slugifySource(s);
                return (
                  <Pressable key={s} onPress={() => setLinkSource(on ? "" : s)} style={[styles.tag, on && styles.tagOn]}>
                    <Text style={[type.smallStrong, { color: on ? theme.white : theme.ink2 }]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={linkSource}
              onChangeText={setLinkSource}
              placeholder="or type a custom source"
              placeholderTextColor={theme.ink4}
              autoCapitalize="none"
              style={[styles.linkInput, { marginTop: space(3) }]}
            />

            <View style={styles.linkUrlBox}>
              <Feather name="link" size={14} color={theme.ink3} />
              <Text style={[type.small, { color: theme.ink2, flex: 1, marginLeft: 8 }]} numberOfLines={1}>{applyUrl.replace(/^https:\/\//, "")}</Text>
            </View>

            <Pressable onPress={copyApplyLink} style={[styles.linkCopyBtn, copied && { backgroundColor: theme.success }]}>
              <Feather name={copied ? "check" : "copy"} size={16} color={theme.white} />
              <Text style={[type.bodyStrong, { color: theme.white, marginLeft: 8 }]}>{copied ? "Copied to clipboard" : "Copy link"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Add-interviewers picker */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPickerOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: sheetPadBottom }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <Text style={[type.h3, { color: theme.ink }]}>Interviewers</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
            </View>
            <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>Tap a teammate to add or remove them from this role.</Text>
            {(interviewers || []).length === 0 ? (
              <View style={{ paddingVertical: space(8) }}>
                <EmptyState icon="user-plus" title="No interviewers yet" subtitle="Invite interviewers to your workspace on the web app, then assign them here." />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {(interviewers || []).map((m) => (
                  <Pressable key={m.id} onPress={() => toggleInterviewer(m)} disabled={!!savingId} style={styles.pickRow}>
                    <Avatar name={m.name} size={38} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={1}>{m.name}</Text>
                      {m.email ? <Text style={[type.small, { color: theme.ink4 }]} numberOfLines={1}>{m.email}</Text> : null}
                    </View>
                    {savingId === m.id ? (
                      <ActivityIndicator size="small" color={theme.brand} />
                    ) : (
                      <View style={[styles.pickCheck, m.assigned && styles.pickCheckOn]}>
                        {m.assigned ? <Feather name="check" size={15} color={theme.white} /> : null}
                      </View>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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

// `starred` is passed in from the caller's candidate_shortlists set. It used to
// be derived from the stage (SHORTLISTED_PLUS), which meant the star lit up for
// anyone who had merely progressed — and could only be toggled while they sat in
// applied/shortlisted. A bookmark is independent of stage, so it is now always
// toggleable and only reflects what this user actually starred.
function CandidateCard({ item, starred, onPress, onStar }) {
  const sc = stageColor(item.stage);
  return (
    <Press onPress={onPress} style={{ marginBottom: space(3) }}>
      <View style={styles.card}>
        <View style={[styles.rail, { backgroundColor: sc }]} />
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
            <Pressable onPress={onStar} hitSlop={8} style={{ padding: 3 }}
              accessibilityRole="button"
              accessibilityState={{ selected: !!starred }}
              accessibilityLabel={starred ? `Remove ${item.name} from your shortlist` : `Shortlist ${item.name}`}>
              <Ionicons name={starred ? "star" : "star-outline"} size={22} color={starred ? "#F5A623" : theme.ink4} />
            </Pressable>
            <View style={{ marginTop: 4 }}><MatchRing score={item.matchScore} /></View>
          </View>
        </View>

        {item.skills && item.skills.length ? (
          <View style={styles.skillsRow}>
            {item.skills.map((s, i) => (
              <View key={i} style={styles.skill}><Text style={[type.small, { color: theme.ink2 }]} numberOfLines={1}>{String(s)}</Text></View>
            ))}
          </View>
        ) : null}

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
  topHeader: { backgroundColor: theme.brand },
  topRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), paddingTop: space(2), paddingBottom: space(3) },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },

  hero: { borderRadius: radius.xl, padding: space(5), marginTop: space(4), shadowColor: theme.brand, shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  openBadge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  applyChip: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#7DE2A8", marginRight: 6 },
  heroTitle: { color: theme.white, fontFamily: "PlusJakartaSans_700Bold", fontSize: 23, lineHeight: 28, letterSpacing: -0.4, marginTop: space(4) },
  heroNum: { color: theme.white, fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 46, letterSpacing: -1.5, marginTop: space(3), fontVariant: ["tabular-nums"] },
  heroPipe: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", marginTop: space(4), gap: 2, backgroundColor: "rgba(255,255,255,0.18)" },
  heroFoot: { flexDirection: "row", justifyContent: "space-between", marginTop: space(5) },

  rankBar: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.xl, borderWidth: 1, borderColor: theme.line, padding: space(4), marginTop: space(4), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  rankIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: theme.brand + "14", alignItems: "center", justifyContent: "center" },
  rankBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 96, paddingHorizontal: 14, height: 38, borderRadius: radius.pill, backgroundColor: theme.brand, marginLeft: 10 },
  rankBtnMuted: { backgroundColor: theme.ink3 },
  notice: { flexDirection: "row", alignItems: "flex-start", marginTop: space(3), padding: space(3), borderRadius: radius.lg, borderWidth: 1 },
  noticeOk: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  noticeErr: { backgroundColor: "#FEF3F2", borderColor: "#FECDCA" },


  sheetBackdrop: { flex: 1, backgroundColor: "rgba(15,18,40,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3), paddingBottom: space(2) },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(4) },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  tagOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  linkInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 14, height: 48, fontFamily: "Inter_500Medium", fontSize: 14.5, color: theme.ink },
  linkUrlBox: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandSoft, borderWidth: 1, borderColor: theme.brand, borderRadius: radius.md, paddingHorizontal: 12, height: 46, marginTop: space(3) },
  linkCopyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: theme.brand, borderRadius: radius.md, height: 52, marginTop: space(4), marginBottom: space(2) },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(1) },
  pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: theme.line2 },
  pickCheck: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  pickCheckOn: { backgroundColor: theme.brand, borderColor: theme.brand },

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
