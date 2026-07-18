// Make-offer bottom sheet. Collects the same terms the web OfferModal does
// (job title, base salary, currency, employment type, start/expiry dates, an
// optional letter body and optional approvers) and calls data.sendOffer, which
// creates the offer, advances the candidate to the offer stage, and either
// emails the candidate a review-&-sign link or routes it through approval.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, ActivityIndicator, Alert, StyleSheet, Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendOffer } from "../lib/data";
import { Button, Feather } from "./ui";
import CalendarSheet from "./CalendarSheet";
import { theme, type, space, radius } from "../theme";

const CURRENCIES = [{ k: "myr", label: "RM" }, { k: "usd", label: "$" }, { k: "sgd", label: "S$" }];
const EMP_TYPES = [
  { k: "full_time", label: "Full-time" },
  { k: "part_time", label: "Part-time" },
  { k: "contract", label: "Contract" },
  { k: "internship", label: "Internship" },
];

// Track soft-keyboard height so the sheet can lift above it (Android edge-to-edge).
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

function prettyDate(iso) {
  if (!iso) return "Select";
  const [y, m, dd] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(dd)} ${months[Number(m) - 1]} ${y}`;
}

export default function OfferSheet({ visible, onClose, companyId, companyName, candidateId, candidateName, jobId, defaults = {}, onSent }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const scrollRef = useRef(null);
  const [jobTitle, setJobTitle] = useState(defaults.jobTitle || "");
  const [salary, setSalary] = useState("");
  const [currency, setCurrency] = useState(defaults.currency || "myr");
  const [empType, setEmpType] = useState("full_time");
  const [startDate, setStartDate] = useState(null); // YYYY-MM-DD
  const [expiresAt, setExpiresAt] = useState(null);
  const [body, setBody] = useState("");            // the offer letter (sent as the message)
  const [bodyEdited, setBodyEdited] = useState(false); // stop auto-syncing once hand-edited
  const [letterView, setLetterView] = useState("write"); // 'write' | 'preview'
  const [approvers, setApprovers] = useState([]); // [{ name, email }]
  const [picker, setPicker] = useState(null); // null | "start" | "expires"
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);

  // Keep defaults in sync if the sheet is opened for a different role.
  useEffect(() => { if (visible && defaults.jobTitle && !jobTitle) setJobTitle(defaults.jobTitle); }, [visible, defaults.jobTitle]);

  // The default letter body, composed from the terms — mirrors the web OfferModal
  // (and the server), staying in sync until the manager edits the letter by hand.
  const composeBody = () => {
    const SYM = { myr: "RM", usd: "$", sgd: "S$" };
    const fmt = (d) => { if (!d) return ""; try { return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }); } catch { return d; } };
    const role = jobTitle.trim() || "[Position]";
    const co = companyName || "[Company]";
    const start = fmt(startDate) || "[start date]";
    const pay = salary.trim() !== "" ? `${SYM[currency] || ""}${Number(salary).toLocaleString("en-US")}` : "[Basic Salary]";
    const exp = fmt(expiresAt);
    return [
      `We are pleased to confirm our conditional offer of employment as ${role} at ${co}, subject to the following terms and conditions of service:`,
      `EFFECTIVE DATE\nYour appointment will be subject to your reporting for duty on or before ${start}, failing which this offer of employment shall be null and void.`,
      ...(exp ? [`VALIDITY OF OFFER\nThis offer is open for your acceptance until ${exp}. If your signed acceptance is not received by this date, this offer shall lapse.`] : []),
      `REMUNERATION\nYou will be paid a Basic Salary of ${pay} per month with effect from the date of commencement. All other terms and conditions enforced by the Company from time to time shall apply to you in accordance with your category.`,
      `PROBATION\nYou shall serve a probationary period of three (3) months. The Company reserves the right to extend the probationary period for a further period of three (3) months, if there are justifiable reasons for doing so. During the probationary period, the employment may be terminated by the Company or the employee by giving to the other not less than two (2) weeks' notice or two (2) weeks' salary in lieu of such notice and without assigning any reasons therefor.`,
      `CONFIRMATION\nIf it is found that you are suitable in all or any particular respect for confirmation, the Company may, at its sole discretion, confirm your appointment.`,
      `BONUS\nIncentive bonus may be paid to you at the discretion of the Management depending on your personal performance and contribution towards the profitability of the Company.`,
      `ANNUAL LEAVE\nYou will be entitled to annual leave as per ${co}'s HR Policies on Terms and Conditions of Service.`,
      `TERMINATION OF EMPLOYMENT\nAfter confirmation of employment, either party maintains the right to terminate this letter of employment by giving to the other not less than two (2) calendar months' notice or salary in lieu of such notice.`,
      `COMPANY RULES\nYour appointment shall always be subject to your compliance with any conditions of service or Company rules and practices, either express or implied, for the time being in force.`,
      `NORMAL HOURS OF WORK\nThe normal hours of work shall be a total of 40 hours per week. You shall be required when necessary to work beyond the normal working hours.`,
      `You will be reporting to your immediate superior and be responsible for the duties set out in your Job Description, and for their performance, profitability, market development and budget achievement and control.`,
      `If you are agreeable with the above terms of employment, please signify your acceptance by signing where indicated below.`,
    ].join("\n\n");
  };

  // Recompose the letter as the terms change, until the manager edits it by hand.
  useEffect(() => {
    if (!bodyEdited) setBody(composeBody());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobTitle, salary, currency, startDate, expiresAt, companyName]);

  const reset = () => {
    setSalary(""); setStartDate(null); setExpiresAt(null);
    setBodyEdited(false); setLetterView("write");
    setApprovers([]); setErr(null); setSending(false);
  };

  const close = () => { if (!sending) { onClose(); } };

  const onPickDate = ({ ymd: picked }) => {
    if (picker === "start") setStartDate(picked);
    else if (picker === "expires") setExpiresAt(picked);
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
      terms, message: (body && body.trim()) || null, approvers: validApprovers, emailSent: true,
    });
    setSending(false);
    if (!res.ok) { setErr(res.error || "Couldn't send the offer."); return; }
    const msg = res.needsApproval
      ? "Sent to your approvers. The candidate is emailed to sign once everyone approves."
      : res.emailed
        ? `${candidateName || "The candidate"} has been emailed a link to review and sign.`
        : "Offer recorded.";
    reset();
    onClose();
    // Parent shows a branded success modal (not the OS alert).
    onSent?.({ ...res, title: res.needsApproval ? "Sent for approval" : "Offer sent", message: msg });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(2), marginBottom: kb > 0 ? kb : 0 }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={[type.h3, { color: theme.ink }]}>Make offer</Text>
              {candidateName ? <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>To {candidateName}</Text> : null}
            </View>
            <Pressable onPress={close} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
          </View>

          <ScrollView ref={scrollRef} style={{ maxHeight: kb > 0 ? 300 : 460 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
            <Field label="Job title">
              <TextInput value={jobTitle} onChangeText={setJobTitle} placeholder="e.g. Digital Marketing Specialist" placeholderTextColor={theme.ink4} style={styles.input} />
            </Field>

            <Field label="Base salary">
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={styles.segment}>
                  {CURRENCIES.map((c) => (
                    <Pressable key={c.k} onPress={() => setCurrency(c.k)} style={[styles.seg, currency === c.k && styles.segOn]}>
                      <Text style={[type.smallStrong, { color: currency === c.k ? theme.white : theme.ink2 }]}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput value={salary} onChangeText={setSalary} keyboardType="numeric" placeholder="e.g. 8000 / month" placeholderTextColor={theme.ink4} style={[styles.input, { flex: 1 }]} />
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

            <View style={{ marginTop: space(4) }}>
              <View style={styles.letterHead}>
                <Text style={[type.smallStrong, { color: theme.ink2 }]}>Offer letter</Text>
                <View style={styles.letterToggle}>
                  {[["write", "Write"], ["preview", "Preview"]].map(([k, l]) => (
                    <Pressable key={k} onPress={() => setLetterView(k)} style={[styles.letterTab, letterView === k && styles.letterTabOn]}>
                      <Text style={[type.small, { fontFamily: "Inter_600SemiBold", color: letterView === k ? theme.brand : theme.ink3 }]}>{l}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {letterView === "write" ? (
                <>
                  <TextInput value={body} onChangeText={(v) => { setBody(v); setBodyEdited(true); }} multiline style={[styles.input, styles.letterArea]} />
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 8 }}>
                    <Text style={[type.small, { color: theme.ink4, flex: 1 }]}>Aster adds the heading, greeting and signature automatically.</Text>
                    {bodyEdited ? (
                      <Pressable onPress={() => { setBody(composeBody()); setBodyEdited(false); }} hitSlop={6}>
                        <Text style={[type.small, { fontFamily: "Inter_600SemiBold", color: theme.brand }]}>Reset from terms</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </>
              ) : (
                <View style={styles.preview}>
                  <Text style={[type.small, { color: theme.ink2, lineHeight: 20 }]}>{body}</Text>
                </View>
              )}
            </View>

            <Field label={`Approvers (optional)${validApprovers.length ? ` · ${validApprovers.length}` : ""}`}>
              {approvers.map((a, i) => (
                <View key={i} style={styles.approverRow}>
                  <TextInput value={a.name} onChangeText={(v) => setApprover(i, "name", v)} onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)} placeholder="Name" placeholderTextColor={theme.ink4} style={[styles.input, { flex: 1 }]} />
                  <TextInput value={a.email} onChangeText={(v) => setApprover(i, "email", v)} onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)} keyboardType="email-address" autoCapitalize="none" placeholder="email@company.com" placeholderTextColor={theme.ink4} style={[styles.input, { flex: 1.4 }]} />
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

      <CalendarSheet
        visible={!!picker}
        mode="date"
        title={picker === "expires" ? "Offer expiry date" : "Start date"}
        confirmLabel={picker === "expires" ? "Set expiry" : "Set start date"}
        minDate={new Date()}
        initial={picker === "start" ? startDate : picker === "expires" ? expiresAt : null}
        onConfirm={onPickDate}
        onClose={() => setPicker(null)}
      />
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
  letterHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  letterToggle: { flexDirection: "row", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.sm, padding: 2 },
  letterTab: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.sm - 2 },
  letterTabOn: { backgroundColor: theme.card, ...(theme.shadowSm || {}) },
  letterArea: { minHeight: 220, textAlignVertical: "top", paddingTop: 11, lineHeight: 20, fontFamily: "Inter_400Regular" },
  preview: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, padding: 14 },
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
