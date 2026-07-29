// Make-offer bottom sheet. Collects the same terms the web OfferModal does
// (job title, base salary, currency, employment type, start/expiry dates, an
// optional letter body) and calls data.sendOffer, which
// creates the offer, advances the candidate to the offer stage, and either
// emails the candidate a review-&-sign link or routes it through approval.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, ActivityIndicator, Alert, StyleSheet, Keyboard, Platform, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendOffer, getMyOfferSignature, saveMyOfferSignature } from "../lib/data";
import { Button, Feather } from "./ui";
import SignaturePad from "./SignaturePad";
import CalendarSheet from "./CalendarSheet";
import { theme, type, space, radius } from "../theme";

const CURRENCIES = [{ k: "myr", label: "RM" }, { k: "sgd", label: "SGD" }, { k: "usd", label: "USD" }];
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

// Up to two initials from a name (or the email's first letter), for avatars.
function initialsOf(nameOrEmail) {
  const parts = String(nameOrEmail || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  // Sign-off. Captured once and kept on the profile, so the second offer and
  // every one after it reuses it: the same rule the web app follows. Only a
  // drawn signature counts; a "typed:<name>" left over from the retired typed
  // option reads as unset, so you draw once and it is replaced.
  const [savedSig, setSavedSig] = useState(undefined);   // undefined = still loading
  const [redraw, setRedraw] = useState(false);           // "Change" tapped
  const [hasInk, setHasInk] = useState(false);
  const [sigErr, setSigErr] = useState(false);
  const toPngRef = useRef(null);
  const [body, setBody] = useState("");            // the offer letter (sent as the message)
  const [bodyEdited, setBodyEdited] = useState(false); // stop auto-syncing once hand-edited
  const [letterView, setLetterView] = useState("write"); // 'write' | 'preview'
  const [picker, setPicker] = useState(null); // null | "start" | "expires"
  const [curOpen, setCurOpen] = useState(false); // currency dropdown
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState("compose"); // 'compose' | 'upload'. Upload (own PDF + signature placement) is web-only.

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
      `EFFECTIVE DATE\nYour appointment will be subject to your reporting for duty on or before **${start}**, failing which this offer of employment shall be null and void.`,
      ...(exp ? [`VALIDITY OF OFFER\nThis offer is open for your acceptance until **${exp}**. If your signed acceptance is not received by this date, this offer shall lapse.`] : []),
      `REMUNERATION\nYou will be paid a Basic Salary of **${pay} per month** with effect from the date of commencement. All other terms and conditions enforced by the Company from time to time shall apply to you in accordance with your category.`,
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
    setErr(null); setSending(false);
    setMode("compose"); setAddOpen(false); setNewName(""); setNewEmail(""); setAddMsg(null);
  };

  const close = () => { if (!sending) { onClose(); } };

  const onPickDate = ({ ymd: picked }) => {
    if (picker === "start") setStartDate(picked);
    else if (picker === "expires") setExpiresAt(picked);
  };

  // Confirmed and not already added → tappable to add. Pending → awaiting email.



  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setRedraw(false); setHasInk(false); setSigErr(false); toPngRef.current = null;
    getMyOfferSignature().then((sig) => {
      if (alive) setSavedSig(sig && !String(sig).startsWith("typed:") ? sig : null);
    });
    return () => { alive = false; };
  }, [visible]);

  const needsSig = savedSig === null || redraw;

  const submit = async () => {
    setErr(null);
    if (!jobTitle.trim()) { setErr("Add the job title for this offer."); return; }
    if (!salary.trim()) { setErr("Add the base salary."); return; }
    if (!startDate) { setErr("Pick a start date."); return; }
    if (needsSig && !toPngRef.current) { setSigErr(true); setErr("Add your signature to sign off this offer."); return; }
    setSending(true);
    // A new drawing is saved to the profile before sending. That is what makes
    // this a one-time step: the letter is signed from the stored signature.
    if (needsSig && toPngRef.current) {
      let png = null;
      try { png = toPngRef.current(); } catch (e2) { setSending(false); setErr("Couldn't save that signature. Try drawing it again."); return; }
      const se = await saveMyOfferSignature(png);
      if (se) { setSending(false); setErr(se); return; }
      setSavedSig(png); setRedraw(false);
    }
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
      terms, message: (body && body.trim()) || null, approvers: [], emailSent: true,
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

          <ScrollView ref={scrollRef} style={{ maxHeight: kb > 0 ? 300 : 460 }} contentContainerStyle={{ paddingBottom: space(3) }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
            {/* Mode toggle: compose in Aster, or upload your own letter PDF (web only). */}
            <View style={styles.modeRow}>
              {[["compose", "file-text", "Compose in Aster"], ["upload", "upload", "Upload our letter"]].map(([k, icon, t]) => {
                const on = mode === k;
                return (
                  <Pressable key={k} onPress={() => setMode(k)} style={[styles.modeCard, on && styles.modeCardOn]}>
                    <Feather name={icon} size={14} color={on ? theme.brand : theme.ink3} />
                    <Text style={[type.smallStrong, { color: on ? theme.brand : theme.ink, marginLeft: 6 }]} numberOfLines={1}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>

            {mode === "upload" ? (
              <View style={styles.uploadInfo}>
                <View style={styles.uploadIcon}><Feather name="monitor" size={22} color={theme.brand} /></View>
                <Text style={[type.bodyStrong, { color: theme.ink, marginTop: 12, textAlign: "center" }]}>Uploading is on the web app</Text>
                <Text style={[type.small, { color: theme.ink3, textAlign: "center", marginTop: 6, lineHeight: 19 }]}>
                  Uploading your own signed PDF and placing the candidate's signature box needs a larger screen, so it lives on the Aster web app at hireaster.com. You can compose the letter right here on mobile.
                </Text>
                <Pressable onPress={() => setMode("compose")} style={styles.uploadSwitch}>
                  <Feather name="edit-3" size={15} color={theme.brand} />
                  <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 8 }]}>Compose here instead</Text>
                </Pressable>
              </View>
            ) : (<>
            <Field label="Job title">
              <TextInput value={jobTitle} onChangeText={setJobTitle} placeholder="e.g. Digital Marketing Specialist" placeholderTextColor={theme.ink4} style={styles.input} />
            </Field>

            <Field label="Base salary">
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => setCurOpen(true)} style={styles.curBtn}>
                  <Text style={[type.smallStrong, { color: theme.ink }]}>{CURRENCIES.find((c) => c.k === currency)?.label || "RM"}</Text>
                  <Feather name="chevron-down" size={15} color={theme.ink3} style={{ marginLeft: 4 }} />
                </Pressable>
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
                  <Text style={[type.small, { color: theme.ink2, lineHeight: 20 }]}>
                    {String(body).split(/(\*\*[\s\S]+?\*\*)/g).map((seg, i) => {
                      const m = /^\*\*([\s\S]+)\*\*$/.exec(seg);
                      return m ? <Text key={i} style={{ fontFamily: "Inter_700Bold", color: theme.ink }}>{m[1]}</Text> : seg;
                    })}
                  </Text>
                </View>
              )}
            </View>

            <Field label="Your signature">
              {savedSig === undefined ? (
                <View style={{ paddingVertical: space(4), alignItems: "center" }}><ActivityIndicator color={theme.brand} /></View>
              ) : needsSig ? (
                <>
                  <Text style={[type.small, { color: theme.ink3, marginTop: -3, marginBottom: 10, lineHeight: 17 }]}>
                    Sign once. Aster keeps it for your future offers and places it above your name on the letter.
                  </Text>
                  <View style={[styles.sigPad, sigErr && !hasInk && { borderColor: theme.warn }]}>
                    <SignaturePad onChange={(fn) => { toPngRef.current = fn; setHasInk(!!fn); if (fn) setSigErr(false); }} />
                  </View>
                  {savedSig ? (
                    <Pressable onPress={() => { setRedraw(false); toPngRef.current = null; setHasInk(false); setSigErr(false); }} style={{ alignSelf: "flex-start", paddingVertical: 8 }}>
                      <Text style={[type.small, { color: theme.ink3, fontFamily: "Inter_600SemiBold" }]}>Keep my current signature</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                /* Signed once already: a line of confirmation, not a task. */
                <View style={styles.sigSaved}>
                  <Image source={{ uri: savedSig }} resizeMode="contain" style={{ width: 104, height: 38 }} />
                  <Text style={[type.small, { color: theme.ink3, fontSize: 12, flex: 1, marginLeft: space(3) }]}>Your saved signature</Text>
                  <Pressable onPress={() => { setRedraw(true); setHasInk(false); toPngRef.current = null; }} hitSlop={8} style={{ paddingVertical: 6, paddingLeft: 8 }}>
                    <Text style={[type.small, { color: theme.brand, fontFamily: "Inter_600SemiBold" }]}>Change</Text>
                  </Pressable>
                </View>
              )}
            </Field>


            {err ? (
              <View style={styles.err}><Feather name="alert-circle" size={14} color="#B42318" /><Text style={[type.small, { color: "#B42318", marginLeft: 8, flex: 1 }]}>{err}</Text></View>
            ) : null}
            </>)}
          </ScrollView>

          {mode === "compose" ? (
            <View style={styles.footer}>
              <Button
                title={sending ? "Sending…" : validApprovers.length ? "Send for approval" : "Send offer"}
                icon={sending ? undefined : "send"}
                onPress={submit}
                disabled={sending}
              />
            </View>
          ) : null}
          {sending ? <View style={styles.sendingOverlay}><ActivityIndicator color={theme.white} /></View> : null}
        </View>
      </View>

      {/* Currency dropdown */}
      <Modal visible={curOpen} transparent animationType="fade" onRequestClose={() => setCurOpen(false)} statusBarTranslucent>
        <Pressable style={styles.curBackdrop} onPress={() => setCurOpen(false)}>
          <View style={styles.curMenu}>
            {CURRENCIES.map((c, i) => (
              <Pressable key={c.k} onPress={() => { setCurrency(c.k); setCurOpen(false); }} style={[styles.curOption, i > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
                <Text style={[type.body, { color: currency === c.k ? theme.brand : theme.ink, fontFamily: currency === c.k ? "Inter_700Bold" : "Inter_500Medium" }]}>{c.label}</Text>
                {currency === c.k ? <Feather name="check" size={16} color={theme.brand} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

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
  modeRow: { flexDirection: "row", gap: 10, marginTop: space(2) },
  modeCard: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 12 },
  modeCardOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  uploadInfo: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 18, borderWidth: 1, borderColor: theme.line, borderStyle: "dashed", borderRadius: radius.lg, backgroundColor: theme.bg, marginTop: space(4) },
  uploadIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  uploadSwitch: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 16, paddingVertical: 11, paddingHorizontal: 18, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.brand, backgroundColor: theme.card },
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
  curBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 14, minWidth: 78 },
  curBackdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.35)", alignItems: "center", justifyContent: "center", padding: 40 },
  curMenu: { backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, overflow: "hidden", width: 200, ...(theme.shadow || {}) },
  curOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  sigPad: { borderRadius: radius.md, borderWidth: 1, borderColor: "transparent" },
  sigSaved: { flexDirection: "row", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, paddingHorizontal: space(3), paddingVertical: space(3) },
  err: { flexDirection: "row", alignItems: "flex-start", marginTop: space(4), padding: space(3), borderRadius: radius.md, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  footer: { paddingTop: space(3), marginTop: space(1), borderTopWidth: 1, borderTopColor: theme.line },
  sendingOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.4)" },
});
