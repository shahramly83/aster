// Propose several interview times to the candidate. The hiring manager adds a few
// date/time ranges (informed by the panel availability poll), then it creates a
// booking invite and emails the candidate a link to pick one.
import React, { useState } from "react";
import { View, Text, Pressable, Modal, Alert, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createInterviewInvite, loadInterviewers } from "../lib/data";
import { Button, Feather } from "./ui";
import CalendarSheet from "./CalendarSheet";
import { theme, type, space, radius } from "../theme";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm12 = (d) => `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${String(d.getMinutes()).padStart(2, "0")}`;
const ap = (d) => (d.getHours() < 12 ? "AM" : "PM");
function slotLabel(startIso, endIso) {
  const s = new Date(startIso), e = new Date(endIso);
  const same = ap(s) === ap(e);
  return `${WD[s.getDay()]} ${s.getDate()} ${MON[s.getMonth()]} · ${hm12(s)}${same ? "" : ` ${ap(s)}`}–${hm12(e)} ${ap(e)}`;
}

export default function ProposeTimesSheet({ visible, onClose, companyId, candidateId, jobId, hm, onSent }) {
  const insets = useSafeAreaInsets();
  const [slots, setSlots] = useState([]); // { start, end }
  const [calOpen, setCalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const reset = () => { setSlots([]); setErr(null); setBusy(false); setCalOpen(false); };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const send = async () => {
    setErr(null);
    if (!slots.length) { setErr("Add at least one time option."); return; }
    setBusy(true);
    // Panel = the hiring manager plus the interviewers assigned to this role.
    const attendees = [{ id: hm?.id, name: hm?.name || "", email: hm?.email || "" }];
    try {
      const pool = await loadInterviewers(companyId, jobId);
      pool.filter((p) => p.assigned).forEach((p) => attendees.push({ id: p.id, name: p.name, email: p.email }));
    } catch { /* proceed with just the HM */ }

    const res = await createInterviewInvite({
      companyId, candidateId, jobId,
      interviewerName: hm?.name, interviewerEmail: hm?.email,
      slots, attendees,
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
          ? "Times saved, but the candidate has no email on file — share the booking link manually."
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
            <Text style={[type.h3, { color: theme.ink }]}>Propose interview times</Text>
            <Pressable onPress={close} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
          </View>
          <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>Add a few options — the candidate picks the one that suits them.</Text>

          {slots.map((s) => (
            <View key={s.start} style={styles.chip}>
              <Feather name="clock" size={14} color={theme.brand} />
              <Text style={[type.small, { color: theme.ink, flex: 1, marginLeft: 8 }]}>{slotLabel(s.start, s.end)}</Text>
              <Pressable onPress={() => setSlots((p) => p.filter((x) => x.start !== s.start))} hitSlop={6}><Feather name="x" size={15} color={theme.ink3} /></Pressable>
            </View>
          ))}

          <Pressable onPress={() => setCalOpen(true)} style={styles.add}>
            <Feather name="plus" size={15} color={theme.brand} />
            <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 6 }]}>Add a time</Text>
          </Pressable>

          {err ? <Text style={[type.small, { color: "#B42318", marginTop: space(2) }]}>{err}</Text> : null}
          <Button title={busy ? "Sending…" : "Send to candidate"} icon={busy ? undefined : "send"} onPress={send} disabled={busy || !slots.length} style={{ marginTop: space(4) }} />
        </View>
      </View>

      <CalendarSheet
        visible={calOpen}
        onClose={() => setCalOpen(false)}
        title="Add a time"
        confirmLabel="Add time"
        onConfirm={({ startIso, endIso }) => setSlots((p) => p.some((x) => x.start === startIso) ? p : [...p, { start: startIso, end: endIso }].sort((a, b) => a.start.localeCompare(b.start)))}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3) },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(3) },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(1) },
  chip: { flexDirection: "row", alignItems: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  add: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 8 },
});
