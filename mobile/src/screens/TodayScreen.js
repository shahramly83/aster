import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet, Linking, Animated, Easing, ScrollView, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { useNotifications } from "../NotificationsContext";
import { loadMyInterviews, loadOpenPolls, loadMyPollProgress, subscribeInterviews, subscribePoll } from "../lib/data";
import { setStatusBarStyle } from "expo-status-bar";
import { Press, Avatar, Loader, TopBar, HeaderActions, Feather } from "../components/ui";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius, shadow } from "../theme";
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
function dayNum(iso, tz) {
  const opts = { day: "numeric" };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
}
function monShort(iso, tz) {
  const opts = { month: "short" };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso)).toUpperCase();
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
  // Segmented tabs. The screen used to stack every section in one long scroll,
  // so a manager had to scroll past polls to reach past interviews. Splitting it
  // means each view is one screenful. "poll" covers both poll surfaces: the ones
  // I opened (panel progress) and the ones waiting on my own vote.
  const [tab, setTab] = useState("next");

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
  // Realtime: reload when interviews or polls change (e.g. a desktop action), so
  // the tab stays live without a manual pull-to-refresh.
  useEffect(() => {
    if (!profile?.companyId) return undefined;
    const unsubIv = subscribeInterviews(profile.companyId, () => load());
    const unsubPoll = subscribePoll(profile.companyId, () => load());
    return () => { unsubIv(); unsubPoll(); };
  }, [profile?.companyId, load]);
  // Tick the countdown once a minute so the hero stays honest.
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const tz = profile?.timezone;
  const firstName = profile?.name?.split(" ")[0] || "there";
  const { width } = useWindowDimensions();

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

  // Pending interviews (no booked time yet): awaiting the candidate's pick, or
  // needing new times after a reschedule. They have no date so they can't sit in
  // the timeline — they head a "Needs your action" list instead.
  const pending = items.filter((i) => i.status === "sent" || i.status === "reschedule" || !i.scheduledAt);
  const timelined = items.filter((i) => i.status === "scheduled" && i.scheduledAt);

  // Every UPCOMING interview shows as the same prominent hero card (soonest
  // first), so they all look consistent. PAST interviews sink to a compact "Past"
  // list at the bottom so old ones never bury the real upcoming ones.
  const sorted = [...timelined].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const isUpcoming = (i) => minutesUntil(i.scheduledAt) > -75;
  const upcoming = sorted.filter(isUpcoming);                   // hero cards, soonest first
  const past = sorted.filter((i) => !isUpcoming(i)).reverse();  // compact rows, most-recent first
  const flat = past.length ? [{ _header: "Past" }, ...past] : [];

  const weekCount = timelined.filter((i) => { const m = minutesUntil(i.scheduledAt); return m > -75 && m < 60 * 24 * 7; }).length;

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
        data={[]}
        // flex:1 makes the list take exactly the space left under the header.
        // Without it the list sized to its (tall) content and rode up over the
        // header, which is what clipped the blue behind the tab pills.
        style={{ flex: 1 }}
        keyExtractor={(item) => (item._header ? `h-${item._header}` : `iv-${item.id}`)}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingTop: space(6), paddingBottom: TAB_CLEARANCE, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListHeaderComponent={
          <View>
            {/* Tabs live INSIDE the scroll content. Pinning them above the list
                kept mis-measuring against the header and left the pills straddling
                the blue/grey edge. As list content they simply flow with the
                layout, so they can never overlap the week strip or the cards. */}
            {/* Negative margins + matching padding so the row bleeds to the screen
                edges: a pill scrolling away should slide under the edge, not stop
                short at the list's gutter. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tabsScroll}
              contentContainerStyle={styles.tabsWrap}
            >
              {[
                { k: "next", label: "Up next", n: upcoming.length },
                { k: "poll", label: "Poll", n: myPolls.length + polls.length },
                { k: "action", label: "Action", n: pending.length },
                { k: "past", label: "Past", n: past.length },
              ].map((t) => {
                const on = tab === t.k;
                return (
                  <Press key={t.k} onPress={() => setTab(t.k)} haptic="light" style={{ flex: 1 }} scaleTo={0.96}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${t.label}, ${t.n}`}>
                    <View style={[styles.tab, on && styles.tabOn]}>
                      <Text style={[styles.tabTxt, on && styles.tabTxtOn]} numberOfLines={1}>{t.label}</Text>
                      {/* Always render the count, including 0. Hiding it at zero
                          changed the pill's content width, so the row resized as
                          counts changed. A steady "0" keeps all four uniform. */}
                      <View style={[styles.tabCount, on && styles.tabCountOn]}>
                        <Text style={[styles.tabCountTxt, on && styles.tabCountTxtOn]}>{t.n > 9 ? "9+" : t.n}</Text>
                      </View>
                    </View>
                  </Press>
                );
              })}
            </ScrollView>

            {/* Week overview sits at the very top for calendar context, then the
                soonest interviews as a swipeable card carousel (slide left/right). */}
            {tab === "next" && timelined.length ? <Rise><WeekStrip items={timelined} tz={tz} /></Rise> : null}
            {tab === "next" && upcoming.length ? (
              <Rise style={{ marginBottom: space(6) }}>
                <View style={styles.upNextRow}>
                  <Text style={styles.eyebrow}>UP NEXT</Text>
                  {weekCount > 1 ? <Text style={styles.weekPill}>{weekCount} this week</Text> : null}
                </View>
                {/* Stacked, not a carousel: every upcoming interview is visible
                    at once. A horizontal slider hid the rest behind a swipe, so
                    a packed week only ever showed one card. */}
                <View style={{ gap: space(4) }}>
                  {upcoming.map((iv) => (
                    <HeroCard key={iv.id} iv={iv} tz={tz}
                      onOpen={() => navigation.navigate("CandidateProfile", { candidateId: iv.candidateId, jobId: iv.jobId, candidateName: iv.candidateName, jobTitle: iv.jobTitle })} />
                  ))}
                </View>
              </Rise>
            ) : null}

            {/* Polls I ran — panel voting progress (manager). Each candidate is its
                own card with an amber urgency accent + "waiting on N" until the
                whole panel has voted, then it flips green (ready to schedule). */}
            {tab === "poll" && myPolls.length ? (
              <Rise style={{ marginBottom: space(6) }}>
                <View style={styles.pollEyebrowRow}>
                  <Text style={styles.pollEyebrow}>TEAM AVAILABILITY POLL</Text>
                  {(() => { const w = myPolls.filter((p) => p.total > 0 && p.voted < p.total).length; return w > 0 ? (
                    <View style={styles.urgentPill}><Feather name="clock" size={11} color="#B45309" /><Text style={styles.urgentPillTxt}>{w} waiting</Text></View>
                  ) : null; })()}
                </View>
                {myPolls.slice(0, 6).map((p) => {
                  // total === 0 means NO interviewers are assigned to this role,
                  // so nobody can ever vote. That is a blocked poll, not pending
                  // work: show it neutrally and name the actual blocker instead
                  // of claiming we're "waiting on 0 interviewers".
                  const noPanel = !p.total;
                  const done = p.total > 0 && p.voted >= p.total;
                  const pct = p.total > 0 ? p.voted / p.total : 0;
                  const remaining = Math.max(0, p.total - p.voted);
                  return (
                    <Press key={p.pollId} onPress={() => navigation.navigate("Discussion", { candidateId: p.candidateId, jobId: p.jobId, candidateName: p.candidateName })} style={[styles.pollItemCard, !done && !noPanel && styles.pollItemUrgent, noPanel && styles.pollItemMuted]} scaleTo={0.98}>
                      <View style={[styles.pollAccent, { backgroundColor: noPanel ? theme.line : done ? theme.success : "#F59E0B" }]} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Avatar name={p.candidateName} size={34} />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={[type.bodyStrong, { color: theme.ink, fontSize: 15 }]} numberOfLines={1}>{p.candidateName}</Text>
                            <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{p.jobTitle}</Text>
                          </View>
                          {noPanel ? null : done ? (
                            <View style={styles.donePill}><Feather name="check" size={11} color="#fff" /><Text style={styles.donePillTxt}>All in</Text></View>
                          ) : (
                            <View style={{ alignItems: "flex-end", marginLeft: 8 }}>
                              <Text style={styles.progressCount}>{p.voted}/{p.total}</Text>
                              <Text style={styles.progressLabel}>voted</Text>
                            </View>
                          )}
                        </View>
                        {noPanel ? null : (
                          <View style={[styles.progressTrack, { marginTop: 10 }]}>
                            <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: done ? theme.success : "#F59E0B" }]} />
                          </View>
                        )}
                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 7 }}>
                          <Feather name={noPanel ? "user-x" : done ? "check-circle" : "clock"} size={12} color={noPanel ? theme.ink3 : done ? theme.success : "#B45309"} />
                          <Text style={[type.smallStrong, { color: noPanel ? theme.ink3 : done ? theme.success : "#B45309", marginLeft: 6 }]} numberOfLines={1}>
                            {noPanel
                              ? "No interviewers on this role yet"
                              : done ? "Everyone voted, ready to schedule" : `Waiting on ${remaining} interviewer${remaining === 1 ? "" : "s"} to vote`}
                          </Text>
                        </View>
                      </View>
                    </Press>
                  );
                })}
              </Rise>
            ) : null}

            {/* Availability polls awaiting my vote — tap opens the poll chat */}
            {tab === "poll" && polls.length ? (
              <Rise style={{ marginBottom: space(6) }}>
                <Text style={styles.pollEyebrow}>NEEDS YOUR INPUT</Text>
                {/* One card per person rather than a titled panel wrapping a list
                    of rows. The old header said "Pick your interview times" and
                    then repeated the count, spending the card's best space on
                    restating its own name; the person and the times they're
                    waiting on are the content. Each card is self-contained, so
                    two pending requests read as two things to do. */}
                {polls.slice(0, 5).map((p) => (
                  <View key={p.pollId} style={styles.pollCard}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Avatar name={p.candidateName} size={44} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        {/* Two lines, not one with an ellipsis: a truncated name
                            is the one thing on this card that must not be. */}
                        <Text style={styles.pollName} numberOfLines={2}>{p.candidateName}</Text>
                        <Text style={styles.pollRole} numberOfLines={1}>{p.jobTitle}</Text>
                      </View>
                    </View>

                    {p.slots?.length ? (
                      <View style={styles.slotWrap}>
                        {p.slots.slice(0, 3).map((ts) => (
                          <View key={ts} style={styles.slotChip}>
                            <Text style={styles.slotChipTxt}>{fmtInterviewTime(ts, tz)}</Text>
                          </View>
                        ))}
                        {p.slots.length > 3 ? (
                          <Text style={styles.slotMore}>+{p.slots.length - 3} more</Text>
                        ) : null}
                      </View>
                    ) : null}

                    <Press
                      onPress={() => navigation.navigate("Discussion", { candidateId: p.candidateId, jobId: p.jobId, candidateName: p.candidateName })}
                      haptic="medium"
                      style={styles.pollCta}
                    >
                      <Feather name="check-circle" size={16} color="#fff" />
                      <Text style={styles.pollCtaTxt}>Mark your availability</Text>
                    </Press>
                  </View>
                ))}
              </Rise>
            ) : null}
            {/* Interviews needing action: awaiting the candidate, or needing new
                times after a reschedule. No booked time yet, so they sit up here. */}
            {tab === "action" && pending.length ? (
              <Rise style={{ marginBottom: space(6) }}>
                <Text style={styles.pollEyebrow}>NEEDS YOUR ACTION</Text>
                <Carousel cardWidth={width - space(4) * 2} gap={space(3)}>
                  {pending.map((iv) => {
                    const resch = iv.status === "reschedule";
                    return (
                      <Press key={iv.id} onPress={() => navigation.navigate("CandidateProfile", { candidateId: iv.candidateId, jobId: iv.jobId, candidateName: iv.candidateName, jobTitle: iv.jobTitle })} style={styles.actionCard} scaleTo={0.98}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={40} />
                          <View style={[styles.actionPill, { backgroundColor: resch ? "#FEF2F2" : "#FEF3C7" }]}>
                            <Text style={[type.smallStrong, { color: resch ? "#B42318" : "#92400E" }]}>{resch ? "Reschedule" : "Awaiting"}</Text>
                          </View>
                        </View>
                        <Text style={[type.bodyStrong, { color: theme.ink, fontSize: 15, marginTop: 11 }]} numberOfLines={1}>{iv.candidateName}</Text>
                        <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]} numberOfLines={1}>{iv.jobTitle}</Text>
                      </Press>
                    );
                  })}
                </Carousel>
              </Rise>
            ) : null}

            {/* Per-tab empty state. With tabs a section can be empty while the
                others have work in them, so the global "You're all set" below
                isn't enough — it only fires when the whole screen is empty. */}
            {(() => {
              const anything = upcoming.length || pending.length || polls.length || myPolls.length || past.length;
              if (!anything) return null; // whole screen empty: ListEmptyComponent owns it
              const n = tab === "next" ? upcoming.length
                : tab === "poll" ? myPolls.length + polls.length
                : tab === "action" ? pending.length
                : past.length;
              if (n) return null;
              const copy = {
                next: { icon: "calendar", title: "Nothing coming up", sub: "Confirmed interviews appear here with a countdown and a join link." },
                poll: { icon: "check-circle", title: "No open polls", sub: "Availability polls you run, or that need your vote, show up here." },
                action: { icon: "clock", title: "Nothing needs you", sub: "Interviews waiting on a candidate reply, or needing new times, land here." },
                past: { icon: "archive", title: "No past interviews", sub: "Interviews that already happened are kept here for reference." },
              }[tab];
              // An empty tab should point at where the work actually is, not just
              // say "nothing here". Offer the fullest other tab as a one-tap exit.
              const counts = { next: upcoming.length, poll: myPolls.length + polls.length, action: pending.length, past: past.length };
              const labels = { next: "Up next", poll: "Poll", action: "Action", past: "Past" };
              const suggest = Object.keys(counts)
                .filter((k) => k !== tab && counts[k] > 0)
                .sort((a, b) => counts[b] - counts[a])[0];
              return (
                <View style={styles.tabEmpty}>
                  <View style={styles.emptyIcon}><Feather name={copy.icon} size={28} color={theme.brand} /></View>
                  <Text style={[type.h3, { color: theme.ink, marginTop: space(4), textAlign: "center" }]}>{copy.title}</Text>
                  <Text style={[type.small, { color: theme.ink3, textAlign: "center", marginTop: space(2), lineHeight: 20, maxWidth: 280 }]}>{copy.sub}</Text>
                  {suggest ? (
                    <Press onPress={() => setTab(suggest)} haptic="light" style={{ marginTop: space(5) }} scaleTo={0.96}
                      accessibilityRole="button" accessibilityLabel={`View ${labels[suggest]}, ${counts[suggest]}`}>
                      <View style={styles.emptyBtn}>
                        <Text style={styles.emptyBtnTxt}>View {labels[suggest]}</Text>
                        <View style={styles.emptyBtnCount}><Text style={styles.emptyBtnCountTxt}>{counts[suggest]}</Text></View>
                        <Feather name="arrow-right" size={14} color={theme.white} style={{ marginLeft: 6 }} />
                      </View>
                    </Press>
                  ) : null}
                </View>
              );
            })()}
          </View>
        }
        ListFooterComponent={
          tab === "past" && past.length ? (
            <Rise style={{ marginTop: space(1) }}>
              <Text style={styles.section}>PAST</Text>
              <Carousel cardWidth={width - space(4) * 2} gap={space(3)}>
                {past.map((iv) => (
                  <PastCardMini key={iv.id} iv={iv} tz={tz}
                    onPress={() => navigation.navigate("CandidateProfile", { candidateId: iv.candidateId, jobId: iv.jobId, candidateName: iv.candidateName, jobTitle: iv.jobTitle })} />
                ))}
              </Carousel>
            </Rise>
          ) : null
        }
        ListEmptyComponent={
          (upcoming.length || pending.length || polls.length || myPolls.length || past.length) ? null : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Feather name="calendar" size={40} color={theme.brand} /></View>
              <Text style={[type.h2, { color: theme.ink, marginTop: space(5) }]}>You're all set</Text>
              <Text style={[type.body, { color: theme.ink3, textAlign: "center", marginTop: space(2), lineHeight: 22, maxWidth: 300 }]}>
                No interviews scheduled yet. When you're added to a panel, it shows up here with a reminder.
              </Text>
            </View>
          )
        }
        renderItem={() => null}
      />
    </View>
  );
}

// A horizontal, snapping card swiper with paging dots. Cards are sized to leave a
// peek of the next one, so it reads as a carousel you can slide left to right.
// With a single card it just renders it (no rail, no dots).
function Carousel({ children, cardWidth, gap = space(3) }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  const [idx, setIdx] = useState(0);
  if (kids.length <= 1) return <View>{kids}</View>;
  const step = cardWidth + gap;
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setIdx(Math.max(0, Math.round(e.nativeEvent.contentOffset.x / step)))}
        contentContainerStyle={{ paddingRight: space(2) }}
      >
        {kids.map((c, i) => (
          <View key={i} style={{ width: cardWidth, marginRight: i < kids.length - 1 ? gap : 0 }}>{c}</View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {kids.map((_, i) => <View key={i} style={[styles.dot2, i === idx && styles.dot2On]} />)}
      </View>
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

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: space(3) }}>
          <View style={styles.heroAvatar}><Avatar uri={iv.avatarUrl} name={iv.candidateName} size={46} /></View>
          <View style={{ flex: 1, marginLeft: 13 }}>
            <Text style={styles.heroName} numberOfLines={1}>{iv.candidateName}</Text>
            <Text style={styles.heroRole} numberOfLines={1}>{iv.jobTitle}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
              <Feather name="calendar" size={13} color="rgba(255,255,255,0.8)" />
              <Text style={styles.heroTimeInline} numberOfLines={1}>{fmtInterviewTime(iv.scheduledAt, tz)}</Text>
            </View>
          </View>
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

// Extra upcoming interviews after the hero: compact rows with a countdown, so a
// busy week stays scannable instead of stacking full hero cards.
function UpcomingRow({ iv, tz, divider, onPress }) {
  const cd = countdown(iv.scheduledAt);
  return (
    <Press onPress={onPress} style={[styles.upRow, divider && styles.pollRowDiv]} scaleTo={0.98}>
      <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={32} />
      <View style={{ flex: 1, marginLeft: 11 }}>
        <Text style={[type.bodyStrong, { color: theme.ink, fontSize: 15 }]} numberOfLines={1}>{iv.candidateName}</Text>
        <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{timeOnly(iv.scheduledAt, tz)} · {iv.jobTitle}</Text>
      </View>
      <View style={[styles.upCount, cd.live && { backgroundColor: theme.success }]}>
        {cd.live ? <LiveDot /> : null}
        <Text style={[styles.upCountTxt, cd.live && { color: "#fff", marginLeft: 6 }]}>{cd.label}</Text>
      </View>
    </Press>
  );
}

// Compact past-interview card for the horizontal Past carousel: date top-right,
// avatar, candidate + role, and a Video tag when it was a video call.
function PastCardMini({ iv, tz, onPress }) {
  return (
    <Press onPress={onPress} style={styles.pastMini} scaleTo={0.98}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={36} />
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.pastDay}>{dayNum(iv.scheduledAt, tz)}</Text>
          <Text style={styles.pastMon}>{monShort(iv.scheduledAt, tz)}</Text>
        </View>
      </View>
      <Text style={[type.smallStrong, { color: theme.ink2, marginTop: 10 }]} numberOfLines={1}>{iv.candidateName}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
        <Text style={[type.small, { color: theme.ink4, flexShrink: 1 }]} numberOfLines={1}>{iv.jobTitle}</Text>
        {iv.meetingLink ? (
          <View style={styles.videoTag}><Feather name="video" size={11} color={theme.brand} /><Text style={styles.videoTagTxt}>Video</Text></View>
        ) : null}
      </View>
    </Press>
  );
}

// A compact card in the day-grouped timeline: a time pill on the left rail, the
// candidate on the right.
// A past (already-happened) interview: compact and quiet, with a mini date rail
// so you can see WHEN it was — since past ones span several days under one header.
function PastCard({ iv, tz, onPress }) {
  return (
    <Press onPress={onPress} style={{ marginBottom: space(2.5) }} scaleTo={0.98}>
      <View style={styles.past}>
        <View style={styles.pastDate}>
          <Text style={styles.pastDay}>{dayNum(iv.scheduledAt, tz)}</Text>
          <Text style={styles.pastMon}>{monShort(iv.scheduledAt, tz)}</Text>
        </View>
        <View style={styles.pastRule} />
        <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={36} />
        <View style={{ flex: 1, marginLeft: 11 }}>
          <Text style={[type.smallStrong, { color: theme.ink2 }]} numberOfLines={1}>{iv.candidateName}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 1 }}>
            <Text style={[type.small, { color: theme.ink4, flexShrink: 1 }]} numberOfLines={1}>{iv.jobTitle}</Text>
            {iv.meetingLink ? (
              <View style={styles.videoTag}>
                <Feather name="video" size={11} color={theme.brand} />
                <Text style={styles.videoTagTxt}>Video</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={theme.ink4} style={{ marginLeft: 6 }} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space(6), paddingBottom: space(12) },
  emptyIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  section: { ...type.label, color: theme.ink3, marginTop: space(1), marginBottom: space(1.5), marginLeft: space(1) },

  week: { flexDirection: "row", justifyContent: "space-between", backgroundColor: theme.card, borderRadius: radius.card, paddingVertical: space(2), paddingHorizontal: space(2), marginBottom: space(5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  weekDay: { alignItems: "center", flex: 1 },
  weekWd: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, color: theme.ink4, textTransform: "uppercase" },
  weekNum: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  weekNumToday: { backgroundColor: theme.brand },
  weekNumHas: { backgroundColor: theme.brandSoft },
  weekNumTxt: { fontFamily: "Inter_700Bold", fontSize: 13, color: theme.ink2, fontVariant: ["tabular-nums"] },
  weekDotBase: { width: 5, height: 5, borderRadius: 3, marginTop: 4, backgroundColor: "transparent" },
  weekDotOn: { backgroundColor: theme.brand },
  pollEyebrow: { ...type.label, color: theme.brand, marginBottom: space(1.5), marginLeft: space(1) },
  pollEyebrowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(1.5), marginHorizontal: space(1) },
  urgentPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF3C7", borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  urgentPillTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#B45309" },
  pollItemCard: { flexDirection: "row", backgroundColor: theme.card, borderRadius: radius.card, padding: space(3), marginBottom: space(2), shadowColor: "#1A1A22", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  pollItemUrgent: { borderWidth: 1, borderColor: "#FDE68A" },
  // Blocked (no panel) cards drop the amber urgency border, which used to be the
  // only thing anchoring the card edge — without it the bare Android elevation
  // shadow reads as an offset halo. Keep a neutral border so the card stays
  // contained while still looking inactive rather than urgent.
  pollItemMuted: { borderWidth: 1, borderColor: theme.line2 },
  pollAccent: { width: 4, borderRadius: 2, alignSelf: "stretch", marginRight: space(3) },
  // Generous padding and a large radius: the card carries one person, so it can
  // afford to breathe instead of packing rows into a panel.
  pollCard: {
    backgroundColor: theme.card, borderRadius: 26,
    paddingHorizontal: space(4), paddingVertical: space(4),
    marginBottom: space(3),
    shadowColor: "#1A1A22", shadowOpacity: 0.06, shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 }, elevation: 3,
  },
  pollName: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 17, lineHeight: 22, letterSpacing: -0.3, color: theme.ink },
  pollRole: { fontFamily: "Inter_400Regular", fontSize: 13, color: theme.ink3, marginTop: 2 },
  // The times being asked about, so the answer is often obvious without opening
  // anything.
  slotWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, marginTop: space(3.5) },
  slotChip: { backgroundColor: theme.bg, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 7 },
  slotChipTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12.5, color: theme.ink2 },
  slotMore: { fontFamily: "Inter_500Medium", fontSize: 12.5, color: theme.ink4 },
  // Full width, so the action is unmissable and thumb-reachable rather than a
  // small pill wedged at the end of a row.
  pollCta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.brand, borderRadius: 16, height: 50, marginTop: space(4),
  },
  pollCtaTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
  // Still used by the "up next" rows below, which stack inside one card.
  pollRowDiv: { borderTopWidth: 1, borderTopColor: theme.line2 },
  votePill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: theme.brand, borderRadius: radius.pill, paddingHorizontal: 13, height: 32 },
  actionPill: { borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5, marginLeft: 8 },
  actionCard: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(3.5), shadowColor: "#1A1A22", shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  votePillTxt: { fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: theme.line2, marginTop: 7, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  progressCount: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, color: theme.ink, fontVariant: ["tabular-nums"] },
  progressLabel: { fontFamily: "Inter_500Medium", fontSize: 10.5, color: theme.ink4, marginTop: -1 },
  donePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.success, borderRadius: radius.pill, paddingHorizontal: 10, height: 26 },
  donePillTxt: { fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" },
  upNextRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(3), marginLeft: space(1) },
  eyebrow: { ...type.label, color: theme.ink3 },

  // ---- segmented tabs (Up next / Poll / Action / Past) ----
  // Segmented control inside the blue header. Transparent wrap (inherits the
  // brand blue), 8dp touch spacing, and a 4/8dp vertical rhythm.
  // Segmented control, first row of the scroll content. 8dp touch spacing and
  // 24dp clear below so the week strip is never crowded against it.
  // Scrolls horizontally: four labels with counts do not fit a phone width, and
  // shrinking them to fit is what produced the cramped 38dp pills this replaced.
  // The reference does the same — its fourth tab is deliberately half off-screen,
  // which is also the affordance that says "there is more this way".
  // Bleed to both screen edges so a pill scrolling away slides under the edge
  // rather than stopping short at the list's gutter.
  tabsScroll: { marginHorizontal: -space(4), marginBottom: space(6) },
  tabsWrap: { alignItems: "center", gap: 10, paddingHorizontal: space(4) },
  tab: {
    // 50dp clears Apple's 44pt and Material's 48dp band. The old 38dp was under
    // both minimums, which is a real tap-accuracy problem.
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    height: 50, borderRadius: 25, paddingHorizontal: 15,
    backgroundColor: theme.card,
    // No elevation on the unselected pills. Android paints the elevation shadow
    // from shadowColor, so any real spread bloomed into a grey rectangle behind
    // each one — the halos in the last build. White on the warm grey page is
    // already separation enough; the iOS shadow values stay for the softer look
    // there, where they render as an actual blur rather than an outline.
    shadowColor: "#1A1A22", shadowOpacity: 0.06, shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 }, elevation: 0,
  },
  // Only the selected pill lifts, and it lifts against its own brand colour so
  // the shadow reads as depth rather than dirt. Kept blue rather than the
  // reference's near-black: this row shares a screen with the AI Rank button and
  // the week strip, which already use brand as "active", and a black pill would
  // introduce a second competing accent.
  tabOn: {
    backgroundColor: theme.brand,
    shadowColor: theme.brand, shadowOpacity: 0.34, shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  tabTxt: { ...type.smallStrong, color: theme.ink2 },
  tabTxtOn: { color: theme.white },
  tabCount: {
    marginLeft: 5, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9,
    backgroundColor: theme.line2, alignItems: "center", justifyContent: "center",
  },
  tabCountOn: { backgroundColor: "rgba(255,255,255,0.28)" },
  // Tabular figures so 1 and 4 occupy the same width, keeping the pills steady
  // as counts change instead of nudging by a pixel each refresh.
  tabCountTxt: { ...type.smallStrong, fontSize: 11, color: theme.ink2, fontVariant: ["tabular-nums"] },
  tabCountTxtOn: { color: theme.white },
  // Centred in a generous band instead of floating near the top with a void
  // underneath, which is what made the empty tab read as unfinished.
  tabEmpty: { alignItems: "center", justifyContent: "center", minHeight: 360, paddingHorizontal: space(6) },
  emptyBtn: {
    flexDirection: "row", alignItems: "center",
    height: 46, paddingHorizontal: space(5), borderRadius: radius.pill,
    backgroundColor: theme.brand,
  },
  emptyBtnTxt: { ...type.smallStrong, color: theme.white },
  emptyBtnCount: {
    marginLeft: 8, minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center",
  },
  emptyBtnCountTxt: { ...type.smallStrong, fontSize: 11, color: theme.white, fontVariant: ["tabular-nums"] },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: space(2) },
  dot2: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.line },
  dot2On: { width: 18, backgroundColor: theme.brand },
  upRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: space(2.5) },
  upCount: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingHorizontal: 10, height: 26, marginLeft: 8 },
  upCountTxt: { fontFamily: "Inter_700Bold", fontSize: 11.5, color: theme.brand, letterSpacing: 0.2 },
  weekPill: { ...type.smallStrong, color: theme.brand, backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, overflow: "hidden" },

  hero: { borderRadius: 22, padding: space(3.5), overflow: "hidden", shadowColor: "#0A1E9E", shadowOpacity: 0.26, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  heroMark: { position: "absolute", top: -26, right: -30 },
  countChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.pill, paddingHorizontal: 12, height: 30 },
  countChipLive: { backgroundColor: "#16A34A" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  countTxt: { fontFamily: "Inter_700Bold", fontSize: 12.5, color: "#fff", marginLeft: 7, letterSpacing: 0.2 },
  heroAvatar: { borderRadius: 30, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)" },
  heroName: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 18, letterSpacing: -0.4, color: "#fff" },
  heroRole: { fontFamily: "Inter_500Medium", fontSize: 13.5, color: "rgba(255,255,255,0.82)", marginTop: 1 },
  heroTimeRow: { flexDirection: "row", alignItems: "center", marginTop: space(3), backgroundColor: "rgba(255,255,255,0.12)", alignSelf: "flex-start", borderRadius: radius.md, paddingHorizontal: 11, paddingVertical: 7 },
  heroTime: { fontFamily: "Inter_600SemiBold", fontSize: 13.5, color: "#fff", marginLeft: 8 },
  heroTimeInline: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "rgba(255,255,255,0.9)", marginLeft: 6 },
  heroActions: { marginTop: space(3) },
  joinBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: radius.md, height: 46 },
  joinTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: theme.brand, marginLeft: 8 },
  detailsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.md, height: 46 },
  detailsTxt: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff", marginRight: 8 },

  tl: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, padding: space(3.5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  timePill: { backgroundColor: theme.brandSoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, marginRight: 12, minWidth: 62, alignItems: "center" },
  timePillTxt: { fontFamily: "Inter_700Bold", fontSize: 12.5, color: theme.brand, fontVariant: ["tabular-nums"] },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: theme.ink4, marginHorizontal: 8 },
  // Past interview: quiet, flat card with a mini date rail on the left.
  pastMini: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(3), borderWidth: 1, borderColor: theme.line },
  past: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.md, paddingVertical: space(2.5), paddingHorizontal: space(3), borderWidth: 1, borderColor: theme.line },
  pastDate: { width: 34, alignItems: "center" },
  pastDay: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 17, color: theme.ink2, lineHeight: 20 },
  pastMon: { fontFamily: "Inter_600SemiBold", fontSize: 9.5, color: theme.ink4, letterSpacing: 0.6, marginTop: -1 },
  pastRule: { width: 1, height: 30, backgroundColor: theme.line, marginHorizontal: 11 },
  videoTag: { flexDirection: "row", alignItems: "center", marginLeft: 8, backgroundColor: theme.brandSoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  videoTagTxt: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: theme.brand, marginLeft: 3, letterSpacing: 0.2 },
});
