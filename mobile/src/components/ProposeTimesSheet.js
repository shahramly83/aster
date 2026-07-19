// Propose several interview times to the candidate. After the panel availability
// poll, the hiring manager opens this: it shows the poll's slots ranked by how
// many interviewers can make them, the HM ticks the best ones (and can add
// extras), and it emails the candidate a link to pick one.
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, Alert, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createInterviewInvite, loadInterviewers, loadCandidatePoll, loadBookedSlots } from "../lib/data";
import { Button, Feather } from "./ui";
import CalendarSheet from "./CalendarSheet";
import { theme, type, space, radius } from "../theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm12 = (d) => `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${String(d.getMinutes()).padStart(2, "0")}`;
const ap = (d) => (d.getHours() < 12 ? "AM" : "PM");
function slotLabel(startIso, endIso) {
  const s = new Date(startIso), e = endIso ? new Date(endIso) : null;
  const date = `${WD[s.getDay()]} ${s.getDate()} ${MON[s.getMonth()]}`;
  if (!e) return `${date} · ${hm12(s)} ${ap(s)}`;
  const same = ap(s) === ap(e);
  return `${date} · ${hm12(s)}${same ? "" : ` ${ap(s)}`}–${hm12(e)} ${ap(e)}`;
}

export default function ProposeTimesSheet({ visible, onClose, companyId, candidateId, jobId, hm, onSent }) {
  const insets = useSafeAreaInsets();
  const [pollSlots, setPollSlots] = useState([]); // { start, end, count } ranked by votes
  const [selected, setSelected] = useState(new Set()); // start ISO of chosen slots
  const [extra, setExtra] = useState([]); // { start, end } added manually
  const [calOpen, setCalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [blocked, setBlocked] = useState([]); // {start,end} a panel member is already booked

  // Pull the panel poll each time the sheet opens, ranked by availability, plus
  // the times this panel is already committed to (so the calendar can grey them out).
  useEffect(() => {
    if (!visible) return;
    (async () => {
      const [poll, pool, booked] = await Promise.all([
        loadCandidatePoll(companyId, candidateId, hm?.id).catch(() => null),
        loadInterviewers(companyId, jobId).catch(() => []),
        loadBookedSlots(companyId).catch(() => []),
      ]);
      const slots = (poll?.slots || [])
        .map((s) => ({ start: s.ts, end: s.end, count: s.count }))
        .sort((a, b) => b.count - a.count);
      setPollSlots(slots);
      // Pre-tick the slots at least one interviewer can make.
      setSelected(new Set(slots.filter((s) => s.count > 0).map((s) => s.start)));
      // Block any time a member of THIS panel already has a confirmed interview
      // (any other candidate, any position) — no double-booking a person.
      const panelIds = new Set([hm?.id, ...pool.filter((p) => p.assigned).map((p) => p.id)].filter(Boolean));
      setBlocked(booked.filter((b) => b.candidateId !== candidateId && b.attendeeIds.some((id) => panelIds.has(id))).map((b) => ({ start: b.start, end: b.end })));
    })();
  }, [visible, companyId, candidateId, jobId, hm?.id]);

  const reset = () => { setExtra([]); setErr(null); setBusy(false); setCalOpen(false); };
  const close = () => { if (!busy) { reset(); onClose(); } };
  const toggle = (start) => setSelected((prev) => { const n = new Set(prev); n.has(start) ? n.delete(start) : n.add(start); return n; });

  // Reject a time range that overlaps one that's already been chosen.
  const addExtra = ({ startIso, endIso }) => {
    const ns = new Date(startIso).getTime(), ne = new Date(endIso).getTime();
    const clash = chosen.some((x) => ns < new Date(x.end || x.start).getTime() && new Date(x.start).getTime() < ne);
    if (clash) { setErr("That time overlaps one you've already picked."); return; }
    setErr(null);
    setExtra((p) => (p.some((x) => x.start === startIso) ? p : [...p, { start: startIso, end: endIso }]));
  };

  const chosen = useMemo(() => {
    const fromPoll = pollSlots.filter((s) => selected.has(s.start)).map((s) => ({ start: s.start, end: s.end }));
    return [...fromPoll, ...extra].sort((a, b) => a.start.localeCompare(b.start));
  }, [pollSlots, selected, extra]);

  const send = async () => {
    setErr(null);
    if (chosen.length < 2) { setErr("Pick at least two times for the candidate to choose from."); return; }
    setBusy(true);
    const attendees = [{ id: hm?.id, name: hm?.name || "", email: hm?.email || "", hm: true }];
    try {
      const pool = await loadInterviewers(companyId, jobId);
      pool.filter((p) => p.assigned).forEach((p) => attendees.push({ id: p.id, name: p.name, email: p.email }));
    } catch { /* proceed with just the HM */ }

    const res = await createInterviewInvite({
      companyId, candidateId, jobId,
      interviewerName: hm?.name, interviewerEmail: hm?.email,
      slots: chosen, attendees,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error || "Couldn't send."); return; }
    reset();
    onSent?.(res);
    onClose();
    Alert.alert(
      "Sent to candidate",
      res.emailed
        ? "The candidate has been emailed a link to pick a time."
        : res.skipped === "no_candidate_email"
          ? "Times saved, but the candidate has no email on file. Share the booking link manually."
          : "Interview times proposed.",
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(3) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[type.h3, { color: theme.ink }]}>Propose times to candidate</Text>
            <Pressable onPress={close} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
          </View>
          <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>Pick the best options from the panel's availability. The candidate chooses one.</Text>

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {pollSlots.length ? (
              <>
                <Text style={styles.groupLabel}>FROM THE PANEL POLL</Text>
                {pollSlots.map((s) => {
                  const on = selected.has(s.start);
                  return (
                    <Pressable key={s.start} onPress={() => toggle(s.start)} style={[styles.slot, on && styles.slotOn]}>
                      <View style={[styles.check, on && styles.checkOn]}>{on ? <Feather name="check" size={12} color={theme.white} /> : null}</View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[type.smallStrong, { color: theme.ink }]}>{slotLabel(s.start, s.end)}</Text>
                        <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>{s.count} interviewer{s.count === 1 ? "" : "s"} available</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            ) : (
              <View style={styles.hint}>
                <Feather name="info" size={14} color={theme.ink3} />
                <Text style={[type.small, { color: theme.ink3, marginLeft: 8, flex: 1 }]}>No panel poll yet. Run "Panel availability" first, or just add times below.</Text>
              </View>
            )}

            {extra.map((s) => (
              <View key={s.start} style={[styles.slot, styles.slotOn]}>
                <View style={[styles.check, styles.checkOn]}><Feather name="check" size={12} color={theme.white} /></View>
                <Text style={[type.smallStrong, { color: theme.ink, flex: 1, marginLeft: 10 }]}>{slotLabel(s.start, s.end)}</Text>
                <Pressable onPress={() => setExtra((p) => p.filter((x) => x.start !== s.start))} hitSlop={6}><Feather name="x" size={15} color={theme.ink3} /></Pressable>
              </View>
            ))}

            <Pressable onPress={() => setCalOpen(true)} style={styles.add}>
              <Feather name="plus" size={15} color={theme.brand} />
              <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 6 }]}>Add another time</Text>
            </Pressable>
          </ScrollView>

          {err ? <Text style={[type.small, { color: "#B42318", marginTop: space(2) }]}>{err}</Text> : null}
          <Button title={busy ? "Sending…" : `Send ${chosen.length || ""} time${chosen.length === 1 ? "" : "s"} to candidate`} icon={busy ? undefined : "send"} onPress={send} disabled={busy || chosen.length < 2} style={{ marginTop: space(4) }} />
        </View>
      </View>

      <CalendarSheet
        visible={calOpen}
        onClose={() => setCalOpen(false)}
        title="Add a time"
        confirmLabel="Add time"
        onConfirm={addExtra}
        blocked={blocked}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3) },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(3) },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(1) },
  groupLabel: { ...type.label, color: theme.ink4, marginBottom: space(2) },
  slot: { flexDirection: "row", alignItems: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  slotOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  add: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 8 },
  hint: { flexDirection: "row", alignItems: "flex-start", backgroundColor: theme.line2, borderRadius: radius.md, padding: 12, marginBottom: 8 },
});
