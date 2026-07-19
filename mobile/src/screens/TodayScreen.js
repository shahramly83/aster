import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet, Linking, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { useNotifications } from "../NotificationsContext";
import { loadMyInterviews, loadOpenPolls, loadMyPollProgress } from "../lib/data";
import { setStatusBarStyle } from "expo-status-bar";
import { Press, Avatar, Loader, TopBar, HeaderActions, Feather } from "../components/ui";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";
import { fmtInterviewTime, minutesUntil } from "@aster/shared";

// Fade + rise entrance, staggered by index for a lively first paint.
function Rise({ children, delay = 0, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Soft pulsing dot for the "Now" live state.
function LiveDot() {
  const p = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(p, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(p, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [p]);
  return <Animated.View style={[styles.liveDot, { opacity: p }]} />;
}

// A live, human countdown to an interview. "Now" inside the interview window,
// then minutes, hours, or days out.
function countdown(iso) {
  const m = minutesUntil(iso);
  if (m <= 0 && m > -75) return { label: "Now", live: true };
  if (m <= 0) return { label: "Ended", live: false };
  if (m < 60) return { label: `in ${m}m`, live: m <= 30 };
  if (m < 60 * 24) { const h = Math.floor(m / 60), mm = m % 60; return { label: mm ? `in ${h}h ${mm}m` : `in ${h}h`, live: false }; }
  const d = Math.round(m / (60 * 24));
  return { label: `in ${d} day${d === 1 ? "" : "s"}`, live: false };
}

// Day bucket label for a scheduled time, in the company's zone.
function dayKey(iso, tz) {
  const opts = { year: "numeric", month: "2-digit", day: "2-digit" };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat("en-CA", opts).format(new Date(iso)); // YYYY-MM-DD
}
function dayLabel(iso, tz) {
  const today = dayKey(new Date().toISOString(), tz);
  const tomorrow = dayKey(new Date(Date.now() + 86400000).toISOString(), tz);
  const k = dayKey(iso, tz);
  if (k < today) return "Past";       // interviews that already happened group together
  if (k === today) return "Today";
  if (k === tomorrow) return "Tomorrow";
  const opts = { weekday: "long", day: "numeric", month: "short" };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
}
function timeOnly(iso, tz) {
  const opts = { hour: "numeric", minute: "2-digit" };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
}

// A week at a glance: seven days from today with a dot on any day that has an
// interview, and today highlighted. Gives the screen rhythm and context.
function WeekStrip({ items, tz }) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const key = dayKey(d.toISOString(), tz);
    const count = items.filter((iv) => dayKey(iv.scheduledAt, tz) === key).length;
    const wd = new Intl.DateTimeFormat(undefined, { weekday: "narrow", ...(tz ? { timeZone: tz } : {}) }).format(d);
    days.push({ d, count, wd, isToday: i === 0 });
  }
  return (
    <View style={styles.week}>
      {days.map((x, i) => (
        <View key={i} style={styles.weekDay}>
          <Text style={styles.weekWd}>{x.wd}</Text>
          <View style={[styles.weekNum, x.isToday && styles.weekNumToday, x.count > 0 && !x.isToday && styles.weekNumHas]}>
            <Text style={[styles.weekNumTxt, x.isToday && { color: "#fff" }, x.count > 0 && !x.isToday && { color: theme.brand }]}>{x.d.getDate()}</Text>
          </View>
          <View style={[styles.weekDotBase, x.count > 0 && styles.weekDotOn]} />
        </View>
      ))}
    </View>
  );
}

export default function TodayScreen({ navigation }) {
  const { profile, manager, assignedJobIds } = useAuth();
  const { unread } = useNotifications();
  const [items, setItems] = useState(null);
  const [polls, setPolls] = useState([]); // open polls awaiting MY vote (interviewer)
  const [myPolls, setMyPolls] = useState([]); // polls I created + panel voting progress (manager)
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [, force] = useState(0);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      setError("");
      const [ivs, openPolls, mine] = await Promise.all([
        loadMyInterviews(profile.companyId, profile.userId, assignedJobIds, manager),
        loadOpenPolls(profile.companyId, profile.userId),
        loadMyPollProgress(profile.companyId, profile.userId),
      ]);
      setItems(ivs);
      setPolls((openPolls || []).filter((p) => !p.voted));
      setMyPolls(mine || []);
    } catch (e) { setError(e?.message || "Could not load interviews."); setItems([]); }
  }, [profile, assignedJobIds, manager]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("dark"); load(); }, [load]));
  // Tick the countdown once a minute so the hero stays honest.
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const tz = profile?.timezone;
  const firstName = profile?.name?.split(" ")[0] || "there";

  if (items === null) return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ backgroundColor: theme.brand }}>
        <SafeAreaView edges={["top"]}>
          <TopBar mark subtitle={manager ? "Interviews you're on" : "Your panel interviews"} name={firstName}
            right={<HeaderActions unread={unread} onSettings={() => navigation.navigate("Settings")} onBell={() => navigation.navigate("Notifications")} />} />
        </SafeAreaView>
      </View>
      <Loader label="Loading your interviews…" />
    </View>
  );

  // Soonest first. The very next one becomes the hero; the rest group by day.
  const sorted = [...items].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const upcoming = sorted.filter((i) => minutesUntil(i.scheduledAt) > -75);
  const next = upcoming[0] || null;
  const rest = sorted.filter((i) => i !== next);

  // Group the remainder by day for a timeline feel.
  const groups = [];
  for (const iv of rest) {
    const label = dayLabel(iv.scheduledAt, tz);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(iv); else groups.push({ label, items: [iv] });
  }
  const flat = groups.flatMap((g) => [{ _header: g.label }, ...g.items]);

  const weekCount = items.filter((i) => { const m = minutesUntil(i.scheduledAt); return m > -75 && m < 60 * 24 * 7; }).length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ backgroundColor: theme.brand }}>
        <SafeAreaView edges={["top"]}>
          <TopBar mark subtitle={manager ? "Interviews you're on" : "Your panel interviews"} name={firstName}
            right={<HeaderActions unread={unread} onSettings={() => navigation.navigate("Settings")} onBell={() => navigation.navigate("Notifications")} />} />
        </SafeAreaView>
      </View>

      {error ? <Text style={[type.small, { color: theme.danger, paddingHorizontal: space(5), marginTop: space(3) }]}>{error}</Text> : null}

      <FlatList
        data={flat}
        keyExtractor={(item) => (item._header ? `h-${item._header}` : `iv-${item.id}`)}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: TAB_CLEARANCE, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListHeaderComponent={
          <View>
            {/* Polls I ran — panel voting progress (manager), tap opens the chat */}
            {myPolls.length ? (
              <Rise style={{ marginBottom: space(4) }}>
                <Text style={styles.pollEyebrow}>TEAM AVAILABILITY POLL</Text>
                <View style={styles.pollCard}>
                  {myPolls.slice(0, 6).map((p, i) => {
                    const done = p.total > 0 && p.voted >= p.total;
                    const pct = p.total > 0 ? p.voted / p.total : 0;
                    return (
                      <Press key={p.pollId} onPress={() => navigation.navigate("Discussion", { candidateId: p.candidateId, jobId: p.jobId, candidateName: p.candidateName })} style={[styles.pollRow, i > 0 && styles.pollRowDiv]}>
                        <Avatar name={p.candidateName} size={38} />
                        <View style={{ flex: 1, marginLeft: 11 }}>
                          <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={1}>{p.candidateName}</Text>
                          <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>Candidate · {p.jobTitle}</Text>
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: done ? theme.success : theme.brand }]} />
                          </View>
                        </View>
                        <View style={{ alignItems: "flex-end", marginLeft: 10 }}>
                          {done ? (
                            <View style={styles.donePill}><Feather name="check" size={11} color="#fff" /><Text style={styles.donePillTxt}>All in</Text></View>
                          ) : (
                            <>
                              <Text style={styles.progressCount}>{p.voted}/{p.total}</Text>
                              <Text style={styles.progressLabel}>voted</Text>
                            </>
                          )}
                        </View>
                      </Press>
                    );
                  })}
                </View>
              </Rise>
            ) : null}

            {/* Availability polls awaiting my vote — tap opens the poll chat */}
            {polls.length ? (
              <Rise style={{ marginBottom: space(4) }}>
                <Text style={styles.pollEyebrow}>NEEDS YOUR INPUT</Text>
                <View style={styles.pollCard}>
                  <View style={styles.pollHead}>
                    <View style={styles.pollHeadIcon}><Feather name="calendar" size={16} color="#fff" /></View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.pollTitle}>Pick your interview times</Text>
                      <Text style={styles.pollSubtitle}>{polls.length} candidate{polls.length === 1 ? "" : "s"} waiting on your availability</Text>
                    </View>
                  </View>
                  {polls.slice(0, 5).map((p, i) => (
                    <Press key={p.pollId} onPress={() => navigation.navigate("Discussion", { candidateId: p.candidateId, jobId: p.jobId, candidateName: p.candidateName })} style={[styles.pollRow, i > 0 && styles.pollRowDiv]}>
                      <Avatar name={p.candidateName} size={38} />
                      <View style={{ flex: 1, marginLeft: 11 }}>
                        <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={1}>{p.candidateName}</Text>
                        <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{p.jobTitle}</Text>
                      </View>
                      <View style={styles.votePill}>
                        <Feather name="check-circle" size={13} color="#fff" />
                        <Text style={styles.votePillTxt}>Vote</Text>
                      </View>
                    </Press>
                  ))}
                </View>
              </Rise>
            ) : null}
            {items.length ? <Rise><WeekStrip items={items} tz={tz} /></Rise> : null}
            {next ? (
              <Rise delay={90} style={{ marginBottom: rest.length ? space(5) : 0 }}>
                <View style={styles.upNextRow}>
                  <Text style={styles.eyebrow}>UP NEXT</Text>
                  {weekCount > 1 ? <Text style={styles.weekPill}>{weekCount} this week</Text> : null}
                </View>
                <HeroCard iv={next} tz={tz}
                  onOpen={() => navigation.navigate("InterviewDetail", { interviewId: next.id, iv: next })} />
              </Rise>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          (next || polls.length || myPolls.length) ? null : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Feather name="calendar" size={40} color={theme.brand} /></View>
              <Text style={[type.h2, { color: theme.ink, marginTop: space(5) }]}>You're all set</Text>
              <Text style={[type.body, { color: theme.ink3, textAlign: "center", marginTop: space(2), lineHeight: 22, maxWidth: 300 }]}>
                No interviews scheduled yet. When you're added to a panel, it shows up here with a reminder.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) =>
          item._header
            ? <Text style={styles.section}>{item._header}</Text>
            : <Rise delay={Math.min(index, 6) * 55}><TimelineCard iv={item} tz={tz} onPress={() => navigation.navigate("InterviewDetail", { interviewId: item.id, iv: item })} /></Rise>
        }
      />
    </View>
  );
}

// The star of the screen: the next interview as a big gradient card with a live
// countdown, and a one-tap Join when there's a meeting link.
function HeroCard({ iv, tz, onOpen }) {
  const cd = countdown(iv.scheduledAt);
  return (
    <Press onPress={onOpen} scaleTo={0.98}>
      <LinearGradient colors={["#2B5BFF", "#123AF0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={[styles.countChip, cd.live && styles.countChipLive]}>
          {cd.live ? <LiveDot /> : <Feather name="clock" size={12} color="#fff" />}
          <Text style={styles.countTxt}>{cd.label}</Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: space(4) }}>
          <View style={styles.heroAvatar}><Avatar uri={iv.avatarUrl} name={iv.candidateName} size={54} /></View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.heroName} numberOfLines={1}>{iv.candidateName}</Text>
            <Text style={styles.heroRole} numberOfLines={1}>{iv.jobTitle}</Text>
          </View>
        </View>

        <View style={styles.heroTimeRow}>
          <Feather name="calendar" size={15} color="rgba(255,255,255,0.85)" />
          <Text style={styles.heroTime}>{fmtInterviewTime(iv.scheduledAt, tz)}</Text>
        </View>

        <View style={styles.heroActions}>
          {iv.meetingLink ? (
            <Press onPress={() => Linking.openURL(iv.meetingLink)} haptic="light" style={styles.joinBtn}>
              <Feather name="video" size={16} color={theme.brand} />
              <Text style={styles.joinTxt}>Join video call</Text>
            </Press>
          ) : (
            <Press onPress={onOpen} haptic="light" style={styles.detailsBtn}>
              <Text style={styles.detailsTxt}>View details</Text>
              <Feather name="arrow-right" size={15} color="#fff" />
            </Press>
          )}
        </View>
      </LinearGradient>
    </Press>
  );
}

// A compact card in the day-grouped timeline: a time pill on the left rail, the
// candidate on the right.
function TimelineCard({ iv, tz, onPress }) {
  return (
    <Press onPress={onPress} style={{ marginBottom: space(3) }} scaleTo={0.98}>
      <View style={styles.tl}>
        <View style={styles.timePill}>
          <Text style={styles.timePillTxt}>{timeOnly(iv.scheduledAt, tz)}</Text>
        </View>
        <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={42} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={1}>{iv.candidateName}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Text style={[type.small, { color: theme.ink3 }]} numberOfLines={1}>{iv.jobTitle}</Text>
            {iv.meetingLink ? (
              <>
                <View style={styles.dot} />
                <Feather name="video" size={13} color={theme.brand} />
              </>
            ) : null}
          </View>
        </View>
        <Feather name="chevron-right" size={20} color={theme.ink4} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space(6), paddingBottom: space(12) },
  emptyIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  section: { ...type.label, color: theme.ink3, marginTop: space(2), marginBottom: space(3), marginLeft: space(1) },

  week: { flexDirection: "row", justifyContent: "space-between", backgroundColor: theme.card, borderRadius: radius.card, paddingVertical: space(3), paddingHorizontal: space(2), marginBottom: space(5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  weekDay: { alignItems: "center", flex: 1 },
  weekWd: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: theme.ink4, textTransform: "uppercase" },
  weekNum: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginTop: 6 },
  weekNumToday: { backgroundColor: theme.brand },
  weekNumHas: { backgroundColor: theme.brandSoft },
  weekNumTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: theme.ink2, fontVariant: ["tabular-nums"] },
  weekDotBase: { width: 5, height: 5, borderRadius: 3, marginTop: 5, backgroundColor: "transparent" },
  weekDotOn: { backgroundColor: theme.brand },
  pollEyebrow: { ...type.label, color: theme.brand, marginBottom: space(2), marginLeft: space(1) },
  pollCard: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), shadowColor: "#1A1A22", shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  pollHead: { flexDirection: "row", alignItems: "center", marginBottom: space(2) },
  pollHeadIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
  pollTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 16, letterSpacing: -0.3, color: theme.ink },
  pollSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12.5, color: theme.ink3, marginTop: 2 },
  pollRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  pollRowDiv: { borderTopWidth: 1, borderTopColor: theme.line2 },
  votePill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: theme.brand, borderRadius: radius.pill, paddingHorizontal: 13, height: 32 },
  votePillTxt: { fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: theme.line2, marginTop: 7, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  progressCount: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, color: theme.ink, fontVariant: ["tabular-nums"] },
  progressLabel: { fontFamily: "Inter_500Medium", fontSize: 10.5, color: theme.ink4, marginTop: -1 },
  donePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.success, borderRadius: radius.pill, paddingHorizontal: 10, height: 26 },
  donePillTxt: { fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" },
  upNextRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(3), marginLeft: space(1) },
  eyebrow: { ...type.label, color: theme.ink3 },
  weekPill: { ...type.smallStrong, color: theme.brand, backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, overflow: "hidden" },

  hero: { borderRadius: 26, padding: space(5), overflow: "hidden", shadowColor: "#0A1E9E", shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  heroMark: { position: "absolute", top: -26, right: -30 },
  countChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.pill, paddingHorizontal: 12, height: 30 },
  countChipLive: { backgroundColor: "#16A34A" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  countTxt: { fontFamily: "Inter_700Bold", fontSize: 12.5, color: "#fff", marginLeft: 7, letterSpacing: 0.2 },
  heroAvatar: { borderRadius: 30, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)" },
  heroName: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 21, letterSpacing: -0.4, color: "#fff" },
  heroRole: { fontFamily: "Inter_500Medium", fontSize: 14, color: "rgba(255,255,255,0.82)", marginTop: 2 },
  heroTimeRow: { flexDirection: "row", alignItems: "center", marginTop: space(4), backgroundColor: "rgba(255,255,255,0.12)", alignSelf: "flex-start", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  heroTime: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff", marginLeft: 8 },
  heroActions: { marginTop: space(5) },
  joinBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: radius.md, height: 48 },
  joinTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: theme.brand, marginLeft: 8 },
  detailsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.md, height: 48 },
  detailsTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff", marginRight: 8 },

  tl: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, padding: space(3.5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  timePill: { backgroundColor: theme.brandSoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, marginRight: 12, minWidth: 62, alignItems: "center" },
  timePillTxt: { fontFamily: "Inter_700Bold", fontSize: 12.5, color: theme.brand, fontVariant: ["tabular-nums"] },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: theme.ink4, marginHorizontal: 8 },
});
