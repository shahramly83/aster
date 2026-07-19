import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, Modal, Keyboard, Platform, Alert, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import CalendarSheet from "../components/CalendarSheet";
import { useAuth } from "../AuthContext";
import {
  loadMessages, sendMessage, subscribeMessages,
  loadCandidatePoll, createPoll, togglePollVote, closePoll, subscribePoll, scheduleInterview,
  loadCandidateInterview, loadInterviewers,
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
  const [savingSlot, setSavingSlot] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

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
    // Once the candidate has confirmed a time, the availability poll is moot — hide it.
    const activePoll = iv?.status === "scheduled" ? null : p;
    setPoll(activePoll);
    // For the manager (usually the poll creator), track whether the panel has
    // finished voting. Expected voters = assigned interviewers minus the creator.
    if (activePoll && manager && jobId) {
      const pool = await loadInterviewers(profile.companyId, jobId).catch(() => []);
      const panel = pool.filter((m) => m.assigned && m.id !== activePoll.createdBy);
      const votedIds = new Set(activePoll.voterIds || []);
      const pending = panel.filter((m) => !votedIds.has(m.id));
      setPollProgress({ voted: panel.length - pending.length, total: panel.length, pendingNames: pending.map((m) => m.name) });
    } else {
      setPollProgress(null);
    }
  }, [profile?.companyId, profile?.userId, candidateId, manager, jobId]);

  useEffect(() => { load(); loadPoll(); }, [load, loadPoll]);

  // Keep the latest message + input visible when the keyboard opens.
  useEffect(() => { if (kb) scrollEnd(); }, [kb]);

  // Live message inserts.
  useEffect(() => {
    const unsub = subscribeMessages(candidateId, (row) => {
      setMessages((prev) => {
        if (!prev || prev.some((m) => m.id === row.id)) return prev;
        return [...prev, { id: row.id, authorId: row.author_id, authorName: row.author_id === profile.userId ? "You" : "Teammate", body: row.body, createdAt: row.created_at }];
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
    setDraft("");
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...(prev || []), { id: tempId, authorId: profile.userId, authorName: "You", body: text, createdAt: new Date().toISOString(), pending: true }]);
    scrollEnd();
    try {
      const saved = await sendMessage({ companyId: profile.companyId, candidateId, jobId, authorId: profile.userId, body: text });
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

  const onCreatePoll = async (slots) => {
    const res = await createPoll({ companyId: profile.companyId, candidateId, candidateName, jobId, createdBy: profile.userId, slots });
    if (res.ok) await loadPoll();
    return res;
  };

  const canCreate = manager && (!poll || poll.status === "closed");

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
                  <PollCard poll={poll} tz={profile.timezone} manager={manager} progress={pollProgress} savingSlot={savingSlot} onToggle={toggleVote} />
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
            renderItem={({ item }) => <Bubble m={item} mine={item.authorId === profile.userId} />}
          />

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Message the panel…"
              placeholderTextColor={theme.ink4}
              value={draft} onChangeText={setDraft} multiline
            />
            <Pressable onPress={onSend} disabled={!draft.trim()} style={[styles.send, !draft.trim() && { opacity: 0.4 }]}>
              <Feather name="arrow-up" size={20} color={theme.white} />
            </Pressable>
          </View>
      </View>

      <PollComposer visible={composerOpen} tz={profile.timezone} onClose={() => setComposerOpen(false)} onCreate={onCreatePoll} />
    </View>
  );
}

function PollCard({ poll, tz, manager, progress, savingSlot, onToggle }) {
  const open = poll.status === "open";
  // For the manager who ran the poll: is the panel done voting?
  const allVoted = progress && progress.total > 0 && progress.voted >= progress.total;
  return (
    <View style={styles.pollCard}>
      <View style={styles.pollHead}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Feather name="calendar" size={15} color={theme.brand} />
          <Text style={[type.bodyStrong, { color: theme.ink, marginLeft: 8 }]}>Interview availability</Text>
        </View>
        <View style={[styles.pollStatus, { backgroundColor: open ? theme.brandSoft : "#F0FDF4" }]}>
          <Text style={[type.smallStrong, { color: open ? theme.brand : "#166534" }]}>{open ? "Open" : "Scheduled"}</Text>
        </View>
      </View>

      {/* Manager sees voting progress (they created it, so they don't vote). */}
      {open && manager && progress && progress.total > 0 ? (
        <View style={[styles.voteProgress, allVoted && styles.voteProgressDone]}>
          <Feather name={allVoted ? "check-circle" : "clock"} size={14} color={allVoted ? theme.success : theme.brand} />
          <Text style={[type.smallStrong, { color: allVoted ? theme.success : theme.ink, marginLeft: 8, flex: 1 }]}>
            {allVoted ? "All panelists have voted" : `${progress.voted} of ${progress.total} panelists voted`}
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: space(3), gap: 8 }}>
        {poll.slots.map((s) => {
          const chosen = !open && poll.chosenSlot === s.ts;
          return (
            <View key={s.id} style={[styles.slot, s.mine && open && styles.slotMine, chosen && styles.slotChosen]}>
              <Pressable onPress={() => open && onToggle(s)} disabled={!open || !!savingSlot} style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                <View style={[styles.check, (s.mine || chosen) && styles.checkOn]}>
                  {s.mine || chosen ? <Feather name="check" size={12} color={theme.white} /> : null}
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[type.smallStrong, { color: theme.ink }]}>{slotLabel(s.ts, s.end)}</Text>
                  <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>
                    {s.count} available{s.voters.length ? ` · ${s.voters.slice(0, 2).join(", ")}${s.count > 2 ? ` +${s.count - 2}` : ""}` : ""}
                  </Text>
                </View>
              </Pressable>
              {chosen ? <Feather name="check-circle" size={18} color={theme.success} /> : null}
            </View>
          );
        })}
      </View>

      {open ? (
        <Text style={[type.small, { color: theme.ink4, marginTop: space(3) }]}>
          {!manager
            ? "Tap the slots you're available for."
            : allVoted
              ? "Everyone's in. Propose the best times to the candidate from their profile → Interview."
              : progress && progress.pendingNames?.length
                ? `Waiting on ${progress.pendingNames.slice(0, 3).join(", ")}${progress.pendingNames.length > 3 ? ` +${progress.pendingNames.length - 3}` : ""}. Then propose the best times to the candidate.`
                : "Panel marks their availability, then propose the best times to the candidate."}
        </Text>
      ) : null}
    </View>
  );
}

function PollComposer({ visible, tz, onClose, onCreate }) {
  const insets = useSafeAreaInsets();
  const [slots, setSlots] = useState([]); // { start, end } ISO
  const [calOpen, setCalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const reset = () => { setSlots([]); setErr(null); setBusy(false); setCalOpen(false); };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const post = async () => {
    setErr(null);
    if (slots.length < 2) { setErr("Add at least two time ranges."); return; }
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
          <Button title={busy ? "Posting…" : "Post poll"} icon={busy ? undefined : "send"} onPress={post} disabled={busy || slots.length < 2} style={{ marginTop: space(4) }} />
        </View>
      </View>

      <CalendarSheet
        visible={calOpen}
        onClose={() => setCalOpen(false)}
        title="Add a time range"
        confirmLabel="Add range"
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

function Bubble({ m, mine }) {
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheir]}>
      {!mine ? <Avatar name={m.authorName} size={30} /> : null}
      <View style={{ maxWidth: "78%", marginLeft: mine ? 0 : 8 }}>
        {!mine ? <Text style={[type.smallStrong, { color: theme.ink3, marginBottom: 3, marginLeft: 4 }]}>{m.authorName}</Text> : null}
        <View style={[styles.bubble, mine ? styles.mine : styles.their]}>
          <Text style={[type.body, { color: mine ? theme.white : theme.ink }]}>{m.body}</Text>
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
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: space(4), paddingVertical: space(3), borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.card },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontFamily: "Inter_400Regular", fontSize: 15, color: theme.ink },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },

  // Poll card
  pollCard: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, padding: space(4), marginBottom: space(4) },
  pollHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pollStatus: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  voteProgress: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandSoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: space(3) },
  voteProgressDone: { backgroundColor: "#F0FDF4" },
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
