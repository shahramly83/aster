import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, Modal, Keyboard, Platform, Alert, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import CalendarSheet from "../components/CalendarSheet";
import { useAuth } from "../AuthContext";
import {
  loadMessages, sendMessage, subscribeMessages, loadThreadParticipants,
  loadCandidatePoll, createPoll, togglePollVote, closePoll, subscribePoll, scheduleInterview,
  loadCandidateInterview, loadInterviewers, confirmPollSlot, createInterviewInvite, loadBookedSlots,
} from "../lib/data";
import { Avatar, Button, Loader, EmptyState, ScreenHeader, Press, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { relTime, fmtInterviewTime } from "@aster/shared";

// Human label for a proposed time range, e.g. "Tue 12 Aug · 2:00–3:00 PM".
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (d) => `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${String(d.getMinutes()).padStart(2, "0")}`;
const ampm = (d) => (d.getHours() < 12 ? "AM" : "PM");
function slotLabel(startIso, endIso) {
  const s = new Date(startIso);
  const date = `${WD[s.getDay()]} ${s.getDate()} ${MON[s.getMonth()]}`;
  if (!endIso) return `${date} · ${hm(s)} ${ampm(s)}`;
  const e = new Date(endIso);
  const sameHalf = ampm(s) === ampm(e);
  return `${date} · ${hm(s)}${sameHalf ? "" : ` ${ampm(s)}`}–${hm(e)} ${ampm(e)}`;
}

// ---- @mentions ---------------------------------------------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The teammates actually tagged in `text` = those whose "@Full Name" appears in
// it. Scanning the final text (rather than trusting what was picked) means a
// mention the author deleted is dropped, and a manually typed one is caught.
function resolveMentions(text, participants) {
  if (!text || !participants?.length) return [];
  return participants
    .filter((p) => new RegExp(`@${escapeRe(p.name)}\\b`, "i").test(text))
    .map((p) => p.id);
}
// Split a message body into plain / mention runs so the bubble can highlight the
// "@Name" tokens for people on the thread.
function splitMentions(text, participants) {
  if (!text || !participants?.length) return [{ mention: false, text }];
  const names = participants.map((p) => p.name).sort((a, b) => b.length - a.length); // longest first
  const re = new RegExp(`@(?:${names.map(escapeRe).join("|")})\\b`, "gi");
  const out = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ mention: false, text: text.slice(last, m.index) });
    out.push({ mention: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ mention: false, text: text.slice(last) });
  return out;
}

// Tracks the on-screen keyboard height so we can pad the chat above it. Edge-to-
// edge Android doesn't resize the window, so KeyboardAvoidingView is unreliable.
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEvt, (e) => setH(e.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideEvt, () => setH(0));
    return () => { s.remove(); hd.remove(); };
  }, []);
  return h;
}

// Candidate-scoped chat between the hiring manager and the interview panel, with
// an interview availability poll at the top of the thread.
export default function DiscussionScreen({ route, navigation }) {
  const { profile, manager } = useAuth();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  // Under edge-to-edge, the reported keyboard height usually excludes the nav-bar
  // inset, so add it back so the composer clears the keyboard fully.
  const bottomPad = kb > 0 ? kb + insets.bottom : insets.bottom;
  const { candidateId, jobId, candidateName } = route.params || {};
  const [messages, setMessages] = useState(null);
  const [poll, setPoll] = useState(null);
  const [pollProgress, setPollProgress] = useState(null); // { voted, total, pendingNames } for the manager
  const [interviewToken, setInterviewToken] = useState(null); // for confirming a round-2 slot
  const [confirming, setConfirming] = useState(null); // slot ts being confirmed
  const [savingSlot, setSavingSlot] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [panelMembers, setPanelMembers] = useState([]); // assigned interviewers (attendees + email)
  const [sentInterview, setSentInterview] = useState(false); // an invite is out, awaiting the candidate
  const [blockedSlots, setBlockedSlots] = useState([]); // times a panel member is already booked
  const [selected, setSelected] = useState(() => new Set()); // slot ids the HM will offer
  const [override, setOverride] = useState(false); // HM proceeds before every vote
  const [sendingOffer, setSendingOffer] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [participants, setParticipants] = useState([]); // teammates who can be @mentioned
  const [cursor, setCursor] = useState(0);              // composer caret position
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // The current "@query" the caret is sitting in (a single space-free token
  // right after an @), or null. Drives the mention picker.
  const mentionQuery = (() => {
    const before = draft.slice(0, cursor);
    const m = before.match(/(?:^|\s)@([^@\s]*)$/);
    return m ? m[1] : null;
  })();
  const suggestions = mentionQuery == null ? [] : participants.filter((p) => {
    const q = mentionQuery.toLowerCase();
    return !q || p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(" ").some((w) => w.startsWith(q));
  }).slice(0, 6);

  // Replace the in-progress "@query" with the picked teammate's "@Full Name ".
  const insertMention = (member) => {
    const atIdx = cursor - (mentionQuery?.length || 0) - 1; // position of the "@"
    if (atIdx < 0) return;
    const next = `${draft.slice(0, atIdx)}@${member.name} ${draft.slice(cursor)}`;
    const caret = atIdx + member.name.length + 2; // after "@Name "
    setDraft(next);
    setCursor(caret);
    requestAnimationFrame(() => inputRef.current?.setNativeProps?.({ selection: { start: caret, end: caret } }));
  };

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const load = useCallback(async () => {
    setMessages(await loadMessages(candidateId));
    scrollEnd();
  }, [candidateId]);

  const loadPoll = useCallback(async () => {
    const [p, iv] = await Promise.all([
      loadCandidatePoll(profile.companyId, candidateId, profile.userId),
      loadCandidateInterview(profile.companyId, candidateId),
    ]);
    // Once an invite is out (sent) or a time is booked (scheduled), the panel
    // availability poll is moot — hide it. A reschedule keeps its round-2 poll.
    const activePoll = (iv?.status === "scheduled" || iv?.status === "sent") ? null : p;
    setPoll(activePoll);
    setInterviewToken(iv?.token || null);
    setSentInterview(iv?.status === "sent");
    // For the manager (usually the poll creator), track whether the panel has
    // finished voting. Expected voters = assigned interviewers minus the creator.
    if (activePoll && manager && jobId) {
      const pool = await loadInterviewers(profile.companyId, jobId).catch(() => []);
      const panel = pool.filter((m) => m.assigned && m.id !== activePoll.createdBy);
      setPanelMembers(panel);
      const votedIds = new Set(activePoll.voterIds || []);
      const pending = panel.filter((m) => !votedIds.has(m.id));
      setPollProgress({ voted: panel.length - pending.length, total: panel.length, pendingNames: pending.map((m) => m.name) });
    } else {
      setPollProgress(null);
    }
  }, [profile?.companyId, profile?.userId, candidateId, manager, jobId]);

  useEffect(() => { load(); loadPoll(); }, [load, loadPoll]);

  // Teammates who can be @mentioned in this thread (managers + assigned panel).
  useEffect(() => {
    if (!profile?.companyId) return;
    loadThreadParticipants(profile.companyId, jobId, profile.userId).then(setParticipants).catch(() => {});
  }, [profile?.companyId, profile?.userId, jobId]);

  // Times this panel is already committed to (confirmed interviews, any other
  // candidate/position) so the poll composer's calendar can grey them out.
  useEffect(() => {
    if (!manager || !profile?.companyId || !jobId) return;
    (async () => {
      const [pool, booked] = await Promise.all([
        loadInterviewers(profile.companyId, jobId).catch(() => []),
        loadBookedSlots(profile.companyId).catch(() => []),
      ]);
      const panelIds = new Set([profile.userId, ...pool.filter((p) => p.assigned).map((p) => p.id)].filter(Boolean));
      setBlockedSlots(booked.filter((b) => b.candidateId !== candidateId && b.attendeeIds.some((id) => panelIds.has(id))).map((b) => ({ start: b.start, end: b.end })));
    })();
  }, [manager, profile?.companyId, profile?.userId, jobId, candidateId]);

  // Keep the latest message + input visible when the keyboard opens.
  useEffect(() => { if (kb) scrollEnd(); }, [kb]);

  // Live message inserts.
  useEffect(() => {
    const unsub = subscribeMessages(candidateId, (row) => {
      setMessages((prev) => {
        if (!prev || prev.some((m) => m.id === row.id)) return prev;
        return [...prev, { id: row.id, authorId: row.author_id, authorName: row.author_id === profile.userId ? "You" : "Teammate", body: row.body, mentionedIds: Array.isArray(row.mentioned_ids) ? row.mentioned_ids : [], createdAt: row.created_at }];
      });
      scrollEnd();
    });
    return unsub;
  }, [candidateId, profile?.userId]);

  // Live poll/vote changes → reload the poll.
  useEffect(() => {
    if (!profile?.companyId) return undefined;
    const unsub = subscribePoll(profile.companyId, () => loadPoll());
    return unsub;
  }, [profile?.companyId, loadPoll]);

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const mentionedIds = resolveMentions(text, participants);
    setDraft("");
    setCursor(0);
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...(prev || []), { id: tempId, authorId: profile.userId, authorName: "You", body: text, mentionedIds, createdAt: new Date().toISOString(), pending: true }]);
    scrollEnd();
    try {
      const saved = await sendMessage({ companyId: profile.companyId, candidateId, jobId, authorId: profile.userId, body: text, mentionedIds });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: saved?.id || m.id, pending: false } : m)));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true, pending: false } : m)));
    } finally {
      setSending(false);
    }
  };

  // Toggle my availability for a slot (optimistic).
  const toggleVote = async (slot) => {
    if (!poll || poll.status !== "open" || savingSlot) return;
    const on = !slot.mine;
    setSavingSlot(slot.id);
    setPoll((p) => ({
      ...p,
      slots: p.slots.map((s) => (s.id === slot.id
        ? { ...s, mine: on, count: Math.max(0, s.count + (on ? 1 : -1)), voters: on ? [...s.voters, "You"] : s.voters.filter((v) => v !== "You") }
        : s)),
    }));
    const err = await togglePollVote({ companyId: profile.companyId, pollId: poll.id, slotId: slot.id, profileId: profile.userId, voterName: profile.name, on });
    setSavingSlot(null);
    if (err) { Alert.alert("Couldn't update", err); loadPoll(); }
  };

  // HM confirms a slot from the candidate's round-2 poll → schedules the interview.
  const confirmSlot = (slot) => {
    Alert.alert(
      "Confirm this time?",
      `${slotLabel(slot.ts, slot.end)}\n\nThe candidate suggested this time, so it will be booked and everyone emailed the confirmation.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm", onPress: async () => {
            setConfirming(slot.ts);
            const res = await confirmPollSlot({ token: interviewToken, pollId: poll?.id, startIso: slot.ts });
            setConfirming(null);
            if (!res.ok) { Alert.alert("Couldn't confirm", res.error || "Try again."); return; }
            loadPoll();
            Alert.alert("Interview scheduled", "The candidate has been emailed the confirmation.");
          },
        },
      ],
    );
  };

  const onCreatePoll = async (slots) => {
    const res = await createPoll({ companyId: profile.companyId, candidateId, candidateName, jobId, createdBy: profile.userId, slots });
    if (res.ok) await loadPoll();
    return res;
  };

  // Round-1: interviewers MUST vote (the HM's own vote is optional). Once they've
  // all voted — or there are none, or the HM overrides — the HM selects >=2 times
  // and sends them straight to the candidate from here.
  const round2 = poll?.proposedBy === "candidate";
  const allVoted = pollProgress && pollProgress.total > 0 && pollProgress.voted >= pollProgress.total;
  const noPanel = pollProgress && pollProgress.total === 0;
  const selectMode = manager && !round2 && poll?.status === "open" && (allVoted || noPanel || override);

  // Default to the two most-available times when entering select mode.
  useEffect(() => {
    if (selectMode && poll && selected.size === 0) {
      const top = [...poll.slots].filter((s) => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 2).map((s) => s.id);
      if (top.length) setSelected(new Set(top));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectMode, poll?.id]);

  const toggleSelect = (slot) => setSelected((prev) => {
    const n = new Set(prev); n.has(slot.id) ? n.delete(slot.id) : n.add(slot.id); return n;
  });

  const sendOffer = async () => {
    if (!poll || sendingOffer) return;
    const chosen = poll.slots.filter((s) => selected.has(s.id)).map((s) => ({ start: s.ts, end: s.end }));
    if (chosen.length < 2) { Alert.alert("Pick at least two", "Select at least two times to offer the candidate."); return; }
    setSendingOffer(true);
    const attendees = [
      { id: profile.userId, name: profile.name || "You", email: profile.email || "" },
      ...panelMembers.map((m) => ({ id: m.id, name: m.name, email: m.email || "" })),
    ];
    const res = await createInterviewInvite({
      companyId: profile.companyId, candidateId, jobId,
      interviewerName: profile.name || "the hiring team", interviewerEmail: profile.email || "",
      slots: chosen, attendees,
    });
    if (!res.ok) { setSendingOffer(false); Alert.alert("Couldn't send", res.error || "Try again."); return; }
    await closePoll(poll.id, chosen[0].start).catch(() => {});
    setSelected(new Set());
    await loadPoll(); // hides the poll + shows the "invite sent" banner, in place
    setSendingOffer(false);
    Alert.alert("Sent to candidate", res.emailed ? `${candidateName || "The candidate"} has been emailed to pick a time.` : "Invite created. The candidate will be notified to pick a time.");
  };

  // A single mark is worse than none: it can't overlap with anything, so the
  // panel reads "1 available" and the poll stalls on a vote that was never going
  // to count. The card says so, but a warning you can walk away from is exactly
  // what people walk away from — so hold the screen until they finish or undo.
  const myMarks = poll?.status === "open" ? poll.slots.filter((s) => s.mine) : [];
  const strandedMark = myMarks.length === 1 ? myMarks[0] : null;

  useEffect(() => {
    if (!strandedMark) return;
    const stop = navigation.addListener("beforeRemove", (e) => {
      e.preventDefault(); // covers header back, hardware back and the swipe gesture
      Alert.alert(
        "Mark one more time",
        "You've only marked one slot, so it can't overlap with anyone else's and won't count. Tap at least one more.",
        [
          { text: "Keep marking", style: "cancel" },
          {
            // Always leave a way out: someone who genuinely has one slot free
            // shouldn't be trapped, they just shouldn't leave a vote that lies.
            text: "Clear my mark and leave",
            style: "destructive",
            onPress: async () => {
              await toggleVote(strandedMark);
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, strandedMark?.id]);

  const canCreate = manager && (!poll || poll.status === "closed");

  // Names to highlight in bubbles: the mentionable teammates plus me, so a
  // message that tags me shows my own "@name" lit up too.
  const mentionNames = profile ? [...participants, { id: profile.userId, name: profile.name || "You" }] : participants;

  if (messages === null) return <Loader label="Loading discussion…" />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        eyebrow="Discussion"
        title={candidateName || "Candidate"}
        onBack={() => navigation.goBack()}
        right={canCreate ? (
          <Press onPress={() => setComposerOpen(true)} haptic="light" style={styles.headerBtn}>
            <Feather name="calendar" size={18} color={theme.white} />
          </Press>
        ) : null}
      />
      <View style={{ flex: 1, paddingBottom: bottomPad }}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: space(4), paddingBottom: space(4), flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollEnd}
            ListHeaderComponent={
              <>
                {poll ? (
                  <PollCard poll={poll} tz={profile.timezone} manager={manager} progress={pollProgress} savingSlot={savingSlot} onToggle={toggleVote} onConfirm={confirmSlot} confirming={confirming}
                    selectMode={selectMode} selected={selected} onToggleSelect={toggleSelect} onSendOffer={sendOffer} sendingOffer={sendingOffer}
                    canOverride={manager && !round2 && !allVoted && !noPanel && !override} onOverride={() => setOverride(true)} />
                ) : sentInterview ? (
                  <View style={[styles.banner, { backgroundColor: "#ECFDF3", borderColor: "#A7F3D0", borderWidth: 1 }]}>
                    <Feather name="check-circle" size={14} color={theme.success} />
                    <Text style={[type.smallStrong, { color: "#166534", marginLeft: 6, flex: 1 }]}>
                      Invite sent. Waiting for {candidateName?.split(" ")[0] || "the candidate"} to pick a time.
                    </Text>
                  </View>
                ) : null}
                <View style={styles.banner}>
                  <Feather name="users" size={13} color={theme.ink3} />
                  <Text style={[type.small, { color: theme.ink3, marginLeft: 6, flex: 1 }]}>
                    Private discussion about {candidateName || "this candidate"} with your panel.
                  </Text>
                </View>
              </>
            }
            ListEmptyComponent={<View style={{ marginTop: space(8) }}><EmptyState icon="message-circle" title="No messages yet" subtitle="Start the conversation with your interview panel." /></View>}
            renderItem={({ item }) => (
              <Bubble
                m={item}
                mine={item.authorId === profile.userId}
                participants={mentionNames}
                meMentioned={Array.isArray(item.mentionedIds) && item.mentionedIds.includes(profile.userId)}
              />
            )}
          />

          {suggestions.length > 0 ? (
            <View style={styles.mentionBox}>
              {suggestions.map((p, i) => (
                <Pressable key={p.id} onPress={() => insertMention(p)} style={[styles.mentionRow, i > 0 && styles.mentionRowDiv]}>
                  <Avatar name={p.name} size={30} />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={[type.smallStrong, { color: theme.ink }]} numberOfLines={1}>{p.name}</Text>
                    {p.role ? <Text style={[type.small, { color: theme.ink4, fontSize: 11, textTransform: "capitalize" }]}>{p.role}</Text> : null}
                  </View>
                  <Feather name="at-sign" size={14} color={theme.ink4} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Message the panel… use @ to tag"
              placeholderTextColor={theme.ink4}
              value={draft} onChangeText={setDraft} multiline
              onSelectionChange={(e) => setCursor(e.nativeEvent.selection.start)}
            />
            <Pressable onPress={onSend} disabled={!draft.trim()} style={[styles.send, !draft.trim() && { opacity: 0.4 }]}>
              <Feather name="arrow-up" size={20} color={theme.white} />
            </Pressable>
          </View>
      </View>

      <PollComposer visible={composerOpen} tz={profile.timezone} onClose={() => setComposerOpen(false)} onCreate={onCreatePoll} blocked={blockedSlots} />
    </View>
  );
}

function PollCard({ poll, tz, manager, progress, savingSlot, onToggle, onConfirm, confirming,
  selectMode = false, selected, onToggleSelect, onSendOffer, sendingOffer, canOverride, onOverride }) {
  const open = poll.status === "open";
  const isCandidate = poll.proposedBy === "candidate"; // round 2: candidate suggested these
  // For the manager who ran the poll: is the panel done voting?
  const allVoted = progress && progress.total > 0 && progress.voted >= progress.total;
  const maxCount = Math.max(0, ...poll.slots.map((s) => s.count));
  const selCount = selected ? selected.size : 0;
  const myPicks = poll.slots.filter((s) => s.mine).length; // this interviewer's own marks
  return (
    <View style={[styles.pollCard, selectMode && { borderColor: theme.brand, borderWidth: 1.5 }]}>
      <View style={styles.pollHead}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Feather name={isCandidate ? "user" : "calendar"} size={15} color={theme.brand} />
          <Text style={[type.bodyStrong, { color: theme.ink, marginLeft: 8 }]}>{isCandidate ? "Candidate's suggested times" : "Interview availability"}</Text>
        </View>
        <View style={[styles.pollStatus, { backgroundColor: open ? theme.brandSoft : "#F0FDF4" }]}>
          <Text style={[type.smallStrong, { color: open ? theme.brand : "#166534" }]}>{open ? "Open" : "Scheduled"}</Text>
        </View>
      </View>

      {/* Manager sees voting progress (they created it, so they don't vote). */}
      {open && manager && !selectMode && progress && progress.total > 0 ? (
        <View style={[styles.voteProgress, allVoted && styles.voteProgressDone]}>
          <Feather name={allVoted ? "check-circle" : "clock"} size={14} color={allVoted ? theme.success : theme.brand} />
          <Text style={[type.smallStrong, { color: allVoted ? theme.success : theme.ink, marginLeft: 8, flex: 1 }]}>
            {allVoted ? "All panelists have voted" : `${progress.voted} of ${progress.total} panelists voted`}
          </Text>
        </View>
      ) : null}
      {selectMode ? (
        <Text style={[type.smallStrong, { color: theme.success, marginTop: space(2) }]}>
          {/* Same as web: drop the "Everyone's voted." claim. It shows whenever
              selection unlocks, including polls whose only votes came from the
              organiser, so it could assert a consensus that never happened. */}
          {progress && progress.pendingNames?.length ? "Proceeding without every vote. " : ""}Pick at least 2 times to offer.
        </Text>
      ) : null}

      <View style={{ marginTop: space(3), gap: 8 }}>
        {poll.slots.map((s) => {
          const chosen = !open && poll.chosenSlot === s.ts;
          const picked = selectMode ? !!(selected && selected.has(s.id)) : (s.mine && open);
          const top = s.count > 0 && s.count === maxCount;
          return (
            <View key={s.id} style={[styles.slot, picked && styles.slotMine, chosen && styles.slotChosen]}>
              <Pressable
                onPress={() => (selectMode ? onToggleSelect?.(s) : (open && onToggle(s)))}
                disabled={selectMode ? false : (!open || !!savingSlot)}
                style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
              >
                <View style={[styles.check, (picked || chosen) && styles.checkOn]}>
                  {picked || chosen ? <Feather name="check" size={12} color={theme.white} /> : null}
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[type.smallStrong, { color: theme.ink }]}>{slotLabel(s.ts, s.end)}</Text>
                  <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>
                    {s.count} available{s.voters.length ? ` · ${s.voters.slice(0, 2).join(", ")}${s.count > 2 ? ` +${s.count - 2}` : ""}` : ""}
                    {top ? <Text style={{ color: theme.brand }}>{"  ·  Most available"}</Text> : null}
                  </Text>
                </View>
              </Pressable>
              {/* Round 2: HM confirms a candidate slot directly (candidate already agreed). */}
              {!selectMode && open && manager && isCandidate ? (
                <Pressable onPress={() => onConfirm?.(s)} disabled={!!confirming} style={styles.confirmSlotBtn}>
                  {confirming === s.ts ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmSlotTxt}>Confirm</Text>}
                </Pressable>
              ) : chosen ? <Feather name="check-circle" size={18} color={theme.success} /> : null}
            </View>
          );
        })}
      </View>

      {/* Select mode → send straight to the candidate. */}
      {selectMode ? (
        <>
          <Button title={`Send ${selCount} time${selCount === 1 ? "" : "s"} to candidate`} onPress={onSendOffer} loading={sendingOffer} disabled={selCount < 2} style={{ marginTop: space(3) }} />
          <Text style={[type.small, { color: theme.ink4, marginTop: space(2), textAlign: "center" }]}>The candidate picks one, then everyone gets the calendar invite.</Text>
        </>
      ) : open ? (
        <>
          {(!manager && !isCandidate) ? (
            myPicks >= 2 ? (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: space(3) }}>
                <Feather name="check-circle" size={13} color={theme.success} />
                <Text style={[type.smallStrong, { color: theme.success, marginLeft: 6, flex: 1 }]}>You've marked {myPicks} times. Your availability is in.</Text>
              </View>
            ) : (
              <View style={styles.voteWarn}>
                <Feather name="clock" size={14} color={theme.warn} />
                <Text style={[type.small, { color: "#92400E", marginLeft: 8, flex: 1 }]}>
                  {myPicks === 0 ? "Tap at least 2 times you can make. The panel needs overlap to book." : "You've only marked 1. Tap at least one more, or your availability won't count."}
                </Text>
              </View>
            )
          ) : (
            <Text style={[type.small, { color: theme.ink4, marginTop: space(3) }]}>
              {isCandidate
                ? (manager
                    ? "The candidate offered these. Panel marks what they can make, then Confirm the best one."
                    : "The candidate suggested these. Tap at least 2 you can make.")
                : progress && progress.pendingNames?.length
                  ? `Your vote is optional. Waiting on ${progress.pendingNames.slice(0, 3).join(", ")}${progress.pendingNames.length > 3 ? ` +${progress.pendingNames.length - 3}` : ""} to vote, then you'll pick times to offer.`
                  : "Your vote is optional. Once the panel votes, you'll pick times to offer."}
            </Text>
          )}
          {canOverride ? (
            <Pressable onPress={onOverride} hitSlop={8} style={{ marginTop: space(2) }}>
              <Text style={[type.smallStrong, { color: theme.brand }]}>Proceed anyway →</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function PollComposer({ visible, tz, onClose, onCreate, blocked = [] }) {
  const insets = useSafeAreaInsets();
  const [slots, setSlots] = useState([]); // { start, end } ISO
  const [calOpen, setCalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const reset = () => { setSlots([]); setErr(null); setBusy(false); setCalOpen(false); };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const post = async () => {
    setErr(null);
    if (slots.length < 3) { setErr("Propose at least three time ranges."); return; }
    setBusy(true);
    const res = await onCreate(slots);
    setBusy(false);
    if (res?.ok === false) { setErr(res.error || "Couldn't post the poll."); return; }
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(2) }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={[type.h3, { color: theme.ink }]}>Propose interview dates</Text>
            <Pressable onPress={close} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
          </View>
          <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>Add a few time ranges. Your panel marks which they can make.</Text>

          {slots.map((s) => (
            <View key={s.start} style={styles.slotChip}>
              <Feather name="clock" size={14} color={theme.brand} />
              <Text style={[type.small, { color: theme.ink, flex: 1, marginLeft: 8 }]}>{slotLabel(s.start, s.end)}</Text>
              <Pressable onPress={() => setSlots((p) => p.filter((x) => x.start !== s.start))} hitSlop={6}><Feather name="x" size={15} color={theme.ink3} /></Pressable>
            </View>
          ))}

          <Pressable onPress={() => setCalOpen(true)} style={styles.addSlot}>
            <Feather name="plus" size={15} color={theme.brand} />
            <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 6 }]}>Add a time range</Text>
          </Pressable>

          {err ? <Text style={[type.small, { color: "#B42318", marginTop: space(2) }]}>{err}</Text> : null}
          <Button title={busy ? "Posting…" : "Post poll"} icon={busy ? undefined : "send"} onPress={post} disabled={busy || slots.length < 3} style={{ marginTop: space(4) }} />
        </View>
      </View>

      <CalendarSheet
        visible={calOpen}
        onClose={() => setCalOpen(false)}
        title="Add a time range"
        confirmLabel="Add range"
        blocked={blocked}
        onConfirm={({ startIso, endIso }) => {
          const ns = new Date(startIso).getTime(), ne = new Date(endIso).getTime();
          const clash = slots.some((x) => ns < new Date(x.end || x.start).getTime() && new Date(x.start).getTime() < ne);
          if (clash) { setErr("That range overlaps one you've already added."); return; }
          setErr(null);
          setSlots((p) => (p.some((x) => x.start === startIso) ? p : [...p, { start: startIso, end: endIso }].sort((a, b) => a.start.localeCompare(b.start))));
        }}
      />
    </Modal>
  );
}

function Bubble({ m, mine, participants = [], meMentioned = false }) {
  const runs = splitMentions(m.body, participants);
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheir]}>
      {!mine ? <Avatar name={m.authorName} size={30} /> : null}
      <View style={{ maxWidth: "78%", marginLeft: mine ? 0 : 8 }}>
        {!mine ? <Text style={[type.smallStrong, { color: theme.ink3, marginBottom: 3, marginLeft: 4 }]}>{m.authorName}</Text> : null}
        {meMentioned && !mine ? (
          <View style={styles.mentionedTag}>
            <Feather name="at-sign" size={10} color={theme.brand} />
            <Text style={[type.small, { color: theme.brand, fontSize: 10.5, fontFamily: "Inter_600SemiBold", marginLeft: 3 }]}>Mentioned you</Text>
          </View>
        ) : null}
        <View style={[styles.bubble, mine ? styles.mine : styles.their, meMentioned && !mine && styles.theirMentioned]}>
          <Text style={[type.body, { color: mine ? theme.white : theme.ink }]}>
            {runs.map((run, i) => (run.mention
              ? <Text key={i} style={{ fontFamily: "Inter_700Bold", color: mine ? theme.white : theme.brand }}>{run.text}</Text>
              : run.text))}
          </Text>
        </View>
        <Text style={[type.small, { color: theme.ink4, fontSize: 11, marginTop: 3, textAlign: mine ? "right" : "left", marginHorizontal: 4 }]}>
          {m.failed ? "Failed to send" : m.pending ? "Sending…" : relTime(m.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", alignItems: "center", backgroundColor: theme.line2, borderRadius: radius.md, padding: 12, marginBottom: space(4) },
  row: { flexDirection: "row", marginBottom: space(4), alignItems: "flex-end" },
  rowMine: { justifyContent: "flex-end" },
  rowTheir: { justifyContent: "flex-start" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg },
  mine: { backgroundColor: theme.brand, borderBottomRightRadius: 4 },
  their: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderBottomLeftRadius: 4 },
  // @mention picker (sits above the composer) + tagged-message accents
  mentionBox: { backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.line, paddingHorizontal: space(4), paddingVertical: space(1) },
  mentionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  mentionRowDiv: { borderTopWidth: 1, borderTopColor: theme.line2 },
  mentionedTag: { flexDirection: "row", alignItems: "center", marginBottom: 3, marginLeft: 4 },
  theirMentioned: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: space(4), paddingVertical: space(3), borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.card },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontFamily: "Inter_400Regular", fontSize: 15, color: theme.ink },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },

  // Poll card
  pollCard: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, padding: space(4), marginBottom: space(4) },
  pollHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pollStatus: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  voteProgress: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandSoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: space(3) },
  voteProgressDone: { backgroundColor: "#F0FDF4" },
  voteWarn: { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: space(3) },
  confirmSlotBtn: { backgroundColor: theme.success, borderRadius: radius.pill, paddingHorizontal: 14, height: 30, minWidth: 74, alignItems: "center", justifyContent: "center" },
  confirmSlotTxt: { fontFamily: "Inter_700Bold", fontSize: 12.5, color: "#fff" },
  slot: { flexDirection: "row", alignItems: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 11 },
  slotMine: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  slotChosen: { borderColor: theme.success, backgroundColor: "#F0FDF4" },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  pickBtn: { marginLeft: 10, paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },

  // Composer sheet
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3), paddingBottom: space(2) },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(3) },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(1) },
  slotChip: { flexDirection: "row", alignItems: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  addSlot: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 8 },
});
