// Make-offer bottom sheet. Collects the same terms the web OfferModal does
// (job title, base salary, currency, employment type, start/expiry dates, an
// optional letter body and optional approvers) and calls data.sendOffer, which
// creates the offer, advances the candidate to the offer stage, and either
// emails the candidate a review-&-sign link or routes it through approval.
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { sendOffer } from "../lib/data";
import { Button, Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

const CURRENCIES = [{ k: "myr", label: "RM" }, { k: "usd", label: "$" }, { k: "sgd", label: "S$" }];
const EMP_TYPES = [
  { k: "full_time", label: "Full-time" },
  { k: "part_time", label: "Part-time" },
  { k: "contract", label: "Contract" },
  { k: "internship", label: "Internship" },
];

// Date-only YYYY-MM-DD in local time (avoids the UTC off-by-one from toISOString).
function ymd(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function prettyDate(iso) {
  if (!iso) return "Select";
  const [y, m, dd] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(dd)} ${months[Number(m) - 1]} ${y}`;
}

export default function OfferSheet({ visible, onClose, companyId, candidateId, candidateName, jobId, defaults = {}, onSent }) {
  const insets = useSafeAreaInsets();
  const [jobTitle, setJobTitle] = useState(defaults.jobTitle || "");
  const [salary, setSalary] = useState("");
  const [currency, setCurrency] = useState(defaults.currency || "myr");
  const [empType, setEmpType] = useState("full_time");
  const [startDate, setStartDate] = useState(null); // YYYY-MM-DD
  const [expiresAt, setExpiresAt] = useState(null);
  const [message, setMessage] = useState("");
  const [approvers, setApprovers] = useState([]); // [{ name, email }]
  const [picker, setPicker] = useState(null); // null | "start" | "expires"
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);

  const reset = () => {
    setSalary(""); setStartDate(null); setExpiresAt(null); setMessage("");
    setApprovers([]); setErr(null); setSending(false);
  };

  const close = () => { if (!sending) { onClose(); } };

  const onPickerChange = (event, selected) => {
    const which = picker;
    setPicker(null);
    if (event.type === "dismissed" || !selected) return;
    if (which === "start") setStartDate(ymd(selected));
    else if (which === "expires") setExpiresAt(ymd(selected));
  };

  const addApprover = () => setApprovers((p) => [...p, { name: "", email: "" }]);
  const setApprover = (i, key, val) => setApprovers((p) => p.map((a, idx) => (idx === i ? { ...a, [key]: val } : a)));
  const removeApprover = (i) => setApprovers((p) => p.filter((_, idx) => idx !== i));

  const validApprovers = useMemo(() => approvers.filter((a) => a.email && a.email.includes("@")), [approvers]);

  const submit = async () => {
    setErr(null);
    if (!jobTitle.trim()) { setErr("Add the job title for this offer."); return; }
    if (!salary.trim()) { setErr("Add the base salary."); return; }
    if (!startDate) { setErr("Pick a start date."); return; }
    setSending(true);
    const terms = {
      jobTitle: jobTitle.trim(),
      baseSalary: salary.trim(),
      currency,
      employmentType: empType,
      startDate,
      expiresAt: expiresAt || null,
    };
    const res = await sendOffer({
      companyId, candidateId, candidateName, jobId,
      terms, message: message.trim() || null, approvers: validApprovers, emailSent: true,
    });
    setSending(false);
    if (!res.ok) { setErr(res.error || "Couldn't send the offer."); return; }
    reset();
    onSent?.(res);
    const msg = res.needsApproval
      ? "Sent to your approvers. The candidate is emailed to sign once everyone approves."
      : res.emailed
        ? `${candidateName || "The candidate"} has been emailed a link to review and sign.`
        : "Offer recorded.";
    Alert.alert("Offer sent", msg);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(2) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={[type.h3, { color: theme.ink }]}>Make offer</Text>
              {candidateName ? <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>To {candidateName}</Text> : null}
            </View>
            <Pressable onPress={close} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Field label="Job title">
              <TextInput value={jobTitle} onChangeText={setJobTitle} placeholder="e.g. Digital Marketing Specialist" placeholderTextColor={theme.ink4} style={styles.input} />
            </Field>

            <Field label="Base salary">
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={salary} onChangeText={setSalary} keyboardType="numeric" placeholder="5000" placeholderTextColor={theme.ink4} style={[styles.input, { flex: 1 }]} />
                <View style={styles.segment}>
                  {CURRENCIES.map((c) => (
                    <Pressable key={c.k} onPress={() => setCurrency(c.k)} style={[styles.seg, currency === c.k && styles.segOn]}>
                      <Text style={[type.smallStrong, { color: currency === c.k ? theme.white : theme.ink2 }]}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </Field>

            <Field label="Employment type">
              <View style={styles.chips}>
                {EMP_TYPES.map((e) => (
                  <Pressable key={e.k} onPress={() => setEmpType(e.k)} style={[styles.chip, empType === e.k && styles.chipOn]}>
                    <Text style={[type.smallStrong, { color: empType === e.k ? theme.white : theme.ink2 }]}>{e.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <Field label="Start date" style={{ flex: 1 }}>
                <Pressable onPress={() => setPicker("start")} style={styles.dateBtn}>
                  <Feather name="calendar" size={15} color={theme.ink3} />
                  <Text style={[type.small, { color: startDate ? theme.ink : theme.ink4, marginLeft: 8 }]}>{prettyDate(startDate)}</Text>
                </Pressable>
              </Field>
              <Field label="Expires (optional)" style={{ flex: 1 }}>
                <Pressable onPress={() => setPicker("expires")} style={styles.dateBtn}>
                  <Feather name="clock" size={15} color={theme.ink3} />
                  <Text style={[type.small, { color: expiresAt ? theme.ink : theme.ink4, marginLeft: 8 }]}>{prettyDate(expiresAt)}</Text>
                </Pressable>
              </Field>
            </View>

            <Field label="Message (optional)">
              <TextInput value={message} onChangeText={setMessage} placeholder="A short note to open the offer letter…" placeholderTextColor={theme.ink4} multiline style={[styles.input, styles.textarea]} />
            </Field>

            <Field label={`Approvers (optional)${validApprovers.length ? ` · ${validApprovers.length}` : ""}`}>
              {approvers.map((a, i) => (
                <View key={i} style={styles.approverRow}>
                  <TextInput value={a.name} onChangeText={(v) => setApprover(i, "name", v)} placeholder="Name" placeholderTextColor={theme.ink4} style={[styles.input, { flex: 1 }]} />
                  <TextInput value={a.email} onChangeText={(v) => setApprover(i, "email", v)} keyboardType="email-address" autoCapitalize="none" placeholder="email@company.com" placeholderTextColor={theme.ink4} style={[styles.input, { flex: 1.4 }]} />
                  <Pressable onPress={() => removeApprover(i)} hitSlop={6} style={styles.approverX}><Feather name="x" size={16} color={theme.ink3} /></Pressable>
                </View>
              ))}
              <Pressable onPress={addApprover} style={styles.addApprover}>
                <Feather name="plus" size={14} color={theme.brand} />
                <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 6 }]}>Add approver</Text>
              </Pressable>
              {validApprovers.length ? (
                <Text style={[type.small, { color: theme.ink4, marginTop: 6 }]}>The candidate is emailed to sign only after every approver signs off, in order.</Text>
              ) : null}
            </Field>

            {err ? (
              <View style={styles.err}><Feather name="alert-circle" size={14} color="#B42318" /><Text style={[type.small, { color: "#B42318", marginLeft: 8, flex: 1 }]}>{err}</Text></View>
            ) : null}
          </ScrollView>

          <Button
            title={sending ? "Sending…" : validApprovers.length ? "Send for approval" : "Send offer"}
            icon={sending ? undefined : "send"}
            onPress={submit}
            disabled={sending}
            style={{ marginTop: space(3) }}
          />
          {sending ? <View style={styles.sendingOverlay}><ActivityIndicator color={theme.white} /></View> : null}
        </View>
      </View>

      {picker ? (
        <DateTimePicker
          value={new Date(Date.now() + 86400000)}
          mode="date"
          minimumDate={new Date()}
          onChange={onPickerChange}
        />
      ) : null}
    </Modal>
  );
}

function Field({ label, children, style }) {
  return (
    <View style={[{ marginTop: space(4) }, style]}>
      <Text style={[type.smallStrong, { color: theme.ink2, marginBottom: 7 }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3), paddingBottom: space(2) },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(3) },
  head: { flexDirection: "row", alignItems: "center", marginBottom: space(1) },
  input: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontFamily: "Inter_500Medium", fontSize: 14.5, color: theme.ink },
  textarea: { minHeight: 74, textAlignVertical: "top", paddingTop: 11 },
  segment: { flexDirection: "row", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, overflow: "hidden" },
  seg: { paddingHorizontal: 12, justifyContent: "center", alignItems: "center" },
  segOn: { backgroundColor: theme.brand },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  dateBtn: { flexDirection: "row", alignItems: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, height: 44 },
  approverRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  approverX: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.line2, alignItems: "center", justifyContent: "center" },
  addApprover: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 6 },
  err: { flexDirection: "row", alignItems: "flex-start", marginTop: space(4), padding: space(3), borderRadius: radius.md, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  sendingOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.4)" },
});
