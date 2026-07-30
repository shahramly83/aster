// Make-offer bottom sheet. Collects the same terms the web OfferModal does
// (job title, base salary, currency, employment type, start/expiry dates, an
// optional letter body and optional approvers) and calls data.sendOffer, which
// creates the offer, advances the candidate to the offer stage, and either
// emails the candidate a review-&-sign link or routes it through approval.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, ActivityIndicator, Alert, StyleSheet, Keyboard, Platform, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendOffer, loadApprovers, addApprover, getMyOfferSignatory, saveMyOfferSignatory, listOfferSignatories } from "../lib/data";
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

// Toggle **bold** around [a,b). Same rules as the web toolbar (resume-ai-preview
// toggleBoldRange) so bolding behaves identically on both: unwrap when the
// selection is already bold, unwrap when it sits just inside the markers,
// otherwise wrap. The markers stay in the stored text, which is what the server
// renderer and every offer already written expect.
function toggleBoldRange(text, a, b) {
  if (a === b) return null;
  const sel = text.slice(a, b), before = text.slice(0, a), after = text.slice(b);
  if (sel.length > 4 && sel.startsWith("**") && sel.endsWith("**")) {
    const inner = sel.slice(2, -2);
    return { text: before + inner + after, start: a, end: a + inner.length };
  }
  if (before.endsWith("**") && after.startsWith("**")) {
    return { text: before.slice(0, -2) + sel + after.slice(2), start: a - 2, end: b - 2 };
  }
  return { text: before + "**" + sel + "**" + after, start: a + 2, end: b + 2 };
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
  const [sigName, setSigName] = useState("");       // name printed under it
  const [bodySel, setBodySel] = useState({ start: 0, end: 0 });
  // Folded by default once there is nothing to do in them: a saved signature and
  // no approvers are the common case, and both were pushing Send offer far down.
  const [sigOpen, setSigOpen] = useState(false);
  const [apprOpen, setApprOpen] = useState(false);
  const bodyRef = useRef(null);
  // Same choice the web offer screen gives: anyone in the workspace who has
  // drawn their own signature can be the one who signs this letter.
  const [signatories, setSignatories] = useState([]);
  const [signBy, setSignBy] = useState(null);      // chosen id, null = me
  const [sigTitle, setSigTitle] = useState(null);   // job title printed under it
  const toPngRef = useRef(null);
  const [body, setBody] = useState("");            // the offer letter (sent as the message)
  const [bodyEdited, setBodyEdited] = useState(false); // stop auto-syncing once hand-edited
  const [letterView, setLetterView] = useState("write"); // 'write' | 'preview'
  const [approvers, setApprovers] = useState([]); // selected [{ id, name, email }]
  const [approverPool, setApproverPool] = useState([]); // all approvers [{id,name,email,status}]
  const [addOpen, setAddOpen] = useState(false); // inline "invite new approver" form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState(null); // { type:'ok'|'err', text }
  const [picker, setPicker] = useState(null); // null | "start" | "expires"
  const [curOpen, setCurOpen] = useState(false); // currency dropdown
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState("compose"); // 'compose' | 'upload'. Upload (own PDF + signature placement) is web-only.

  // Keep defaults in sync if the sheet is opened for a different role.
  useEffect(() => { if (visible && defaults.jobTitle && !jobTitle) setJobTitle(defaults.jobTitle); }, [visible, defaults.jobTitle]);

  // Load the company's approvers (confirmed = pickable, pending = awaiting email).
  useEffect(() => {
    if (!visible || !companyId) return;
    let alive = true;
    loadApprovers(companyId).then((r) => { if (alive) setApproverPool(r); });
    return () => { alive = false; };
  }, [visible, companyId]);
  const reloadApprovers = () => { if (companyId) loadApprovers(companyId).then(setApproverPool); };

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
    setApprovers([]); setErr(null); setSending(false);
    setMode("compose"); setAddOpen(false); setNewName(""); setNewEmail(""); setAddMsg(null);
  };

  const close = () => { if (!sending) { onClose(); } };

  const onPickDate = ({ ymd: picked }) => {
    if (picker === "start") setStartDate(picked);
    else if (picker === "expires") setExpiresAt(picked);
  };

  const pickApprover = (m) => setApprovers((p) => [...p, { id: m.id, name: m.name, email: m.email }]);
  const removeApprover = (i) => setApprovers((p) => p.filter((_, idx) => idx !== i));
  // Confirmed and not already added → tappable to add. Pending → awaiting email.
  const selectedEmails = useMemo(() => new Set(approvers.map((a) => (a.email || "").toLowerCase())), [approvers]);
  const availableApprovers = useMemo(
    () => approverPool.filter((m) => m.status === "confirmed" && !selectedEmails.has(m.email.toLowerCase())),
    [approverPool, selectedEmails],
  );
  const pendingApprovers = useMemo(() => approverPool.filter((m) => m.status !== "confirmed"), [approverPool]);

  const submitNewApprover = async () => {
    const e = newEmail.trim().toLowerCase();
    if (!e.includes("@")) { setAddMsg({ type: "err", text: "Enter a valid email." }); return; }
    setAddBusy(true); setAddMsg(null);
    const res = await addApprover({ email: e, name: newName.trim() || null });
    setAddBusy(false);
    if (!res.ok) { setAddMsg({ type: "err", text: res.error || "Couldn't send the invite." }); return; }
    setNewName(""); setNewEmail(""); setAddOpen(false);
    setAddMsg({ type: "ok", text: res.already ? "Already a confirmed approver." : "Invite sent. They'll appear once they confirm." });
    reloadApprovers();
  };

  const validApprovers = useMemo(() => approvers.filter((a) => a.email && a.email.includes("@")), [approvers]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setRedraw(false); setHasInk(false); setSigErr(false); toPngRef.current = null;
    setSignBy(null);
    getMyOfferSignatory().then(({ signature, name, title }) => {
      if (!alive) return;
      setSavedSig(signature && !String(signature).startsWith("typed:") ? signature : null);
      setSigName(name || ""); setSigTitle(title || null);
    });
    listOfferSignatories().then((rows) => { if (alive) setSignatories(rows); });
    // Nothing saved means a signature is required before this can send, so the
    // section opens itself rather than hiding the one blocking step.
    getMyOfferSignatory().then(({ signature }) => {
      if (alive && !(signature && !String(signature).startsWith("typed:"))) setSigOpen(true);
    });
    return () => { alive = false; };
  }, [visible]);

  const chosenSignatory = signBy ? signatories.find((r) => r.id === signBy) || null : null;
  const needsSig = !chosenSignatory && (savedSig === null || redraw);

  const boldSelection = () => {
    const r = toggleBoldRange(body, bodySel.start, bodySel.end);
    if (!r) return;
    setBody(r.text); setBodyEdited(true);
    // Put the caret back where the writer left it, once RN has the new value.
    setTimeout(() => bodyRef.current?.setNativeProps?.({ selection: { start: r.start, end: r.end } }), 0);
  };

  const submit = async () => {
    setErr(null);
    if (!jobTitle.trim()) { setErr("Add the job title for this offer."); return; }
    if (!salary.trim()) { setErr("Add the base salary."); return; }
    if (!startDate) { setErr("Pick a start date."); return; }
    if (needsSig && !toPngRef.current) { setSigErr(true); setSigOpen(true); setErr("Add your signature to sign off this offer."); return; }
    setSending(true);
    // A new drawing is saved to the profile before sending. That is what makes
    // this a one-time step: the letter is signed from the stored signature.
    if (needsSig && toPngRef.current) {
      let png = null;
      try { png = toPngRef.current(); } catch (e2) { setSending(false); setErr("Couldn't save that signature. Try drawing it again."); return; }
      const se = await saveMyOfferSignatory(png, sigName, sigTitle);
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
      signatoryName: (chosenSignatory ? chosenSignatory.name : sigName) || null,
      signatoryTitle: (chosenSignatory ? chosenSignatory.title : sigTitle) || null,
      signatorySignature: (chosenSignatory ? chosenSignatory.signature : savedSig) || null,
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
                  <View style={styles.lvBar}>
                    <Pressable
                      onPress={boldSelection}
                      accessibilityLabel="Bold the selected text"
                      style={({ pressed }) => [styles.boldBtn, pressed && { backgroundColor: theme.bg }]}
                    >
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: theme.ink2 }}>B</Text>
                    </Pressable>
                    <Text style={[type.small, { color: theme.ink4, fontSize: 11.5, flex: 1, marginLeft: 8 }]}>Select text, then Bold</Text>
                  </View>
                  <TextInput
                    ref={bodyRef}
                    value={body}
                    onChangeText={(v) => { setBody(v); setBodyEdited(true); }}
                    onSelectionChange={(e) => setBodySel(e.nativeEvent.selection)}
                    multiline
                    style={[styles.input, styles.letterArea]}
                  />
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

            {signatories.length > 1 ? (
              <Field label="Signed by">
                {signatories.map((r) => {
                  const on = signBy ? signBy === r.id : r.signature === savedSig;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => { setSignBy(r.id); setSigErr(false); }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [styles.sbRow, on && styles.sbRowOn, pressed && { opacity: 0.85 }]}
                    >
                      <View style={[styles.sbDot, on && { borderColor: theme.brand }]}>
                        {on ? <View style={styles.sbDotIn} /> : null}
                      </View>
                      <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                        <Text numberOfLines={1} style={[type.smallStrong, { color: theme.ink }]}>{r.name}</Text>
                        <Text numberOfLines={1} style={[type.small, { color: theme.ink3, fontSize: 12 }]}>{r.title || "No title set"}</Text>
                      </View>
                      <Image source={{ uri: r.signature }} resizeMode="contain" style={{ width: 74, height: 28 }} />
                    </Pressable>
                  );
                })}
              </Field>
            ) : null}

            <FoldField
              label="Your signature"
              open={sigOpen}
              onToggle={() => setSigOpen((v) => !v)}
              summary={chosenSignatory ? `Signed by ${chosenSignatory.name}` : savedSig ? (sigName || "Saved signature") : "Not set"}
            >
              {chosenSignatory ? (
                <Text style={[type.small, { color: theme.ink3, marginTop: -3, lineHeight: 17 }]}>
                  {chosenSignatory.name} signs this letter. Your own signature is not used.
                </Text>
              ) : savedSig === undefined ? (
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
                  <Image source={{ uri: savedSig }} resizeMode="contain" style={{ width: 92, height: 34 }} />
                  {/* Name and title, so you can see the sign-off this letter will
                      carry without opening Settings to check. */}
                  <View style={{ flex: 1, minWidth: 0, marginLeft: space(3) }}>
                    <Text numberOfLines={1} style={[type.smallStrong, { color: theme.ink, fontSize: 13 }]}>{sigName || "No name set"}</Text>
                    <Text numberOfLines={1} style={[type.small, { color: theme.ink3, fontSize: 11.5 }]}>{sigTitle || "No title set"}</Text>
                  </View>
                  <Pressable onPress={() => { setRedraw(true); setHasInk(false); toPngRef.current = null; }} hitSlop={8} style={{ paddingVertical: 6, paddingLeft: 8 }}>
                    <Text style={[type.small, { color: theme.brand, fontFamily: "Inter_600SemiBold" }]}>Change</Text>
                  </Pressable>
                </View>
              )}

              {/* Name and title live here too, not only in Settings. Web puts the
                  same three fields in its offer modal, and a signature captured
                  here without them would print a mark over a bare account name. */}
              {!chosenSignatory && savedSig !== undefined ? (
                <>
                  <Text style={styles.sigFieldLabel}>Full name</Text>
                  <TextInput
                    value={sigName}
                    onChangeText={setSigName}
                    placeholder="Name as it should appear on the letter"
                    placeholderTextColor={theme.ink4}
                    style={styles.input}
                  />
                  <Text style={styles.sigFieldLabel}>Job title</Text>
                  <TextInput
                    value={sigTitle || ""}
                    onChangeText={setSigTitle}
                    placeholder="e.g. Talent Acquisition Lead"
                    placeholderTextColor={theme.ink4}
                    style={styles.input}
                  />
                  <Text style={[type.small, { color: theme.ink3, marginTop: 6, fontSize: 11.5 }]}>
                    Used on offer letters only, so they can differ from your account name.
                  </Text>
                </>
              ) : null}
            </FoldField>

            <FoldField
              label="Approvers"
              open={apprOpen}
              onToggle={() => setApprOpen((v) => !v)}
              summary={approvers.length ? `${approvers.length} in order` : "None, goes straight to them"}
            >
              <Text style={[type.small, { color: theme.ink3, marginTop: -3, marginBottom: 12, lineHeight: 17 }]}>
                Optional. Anyone here signs off in order before {candidateName ? candidateName.split(" ")[0] : "the candidate"} is emailed the offer. You can send without one.
              </Text>

              {/* Picked approvers, in the order they act. */}
              {approvers.map((a, i) => {
                const pool = approverPool.find((m) => (m.email || "").toLowerCase() === (a.email || "").toLowerCase());
                const unconfirmed = pool && pool.status && pool.status !== "confirmed";
                return (
                  <View key={a.id || i} style={styles.rtCard}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <View style={[styles.rtNode, { backgroundColor: theme.card, borderColor: unconfirmed ? theme.warn : theme.brand }]}>
                        <Text style={[styles.rtNodeTxt, unconfirmed && { color: theme.warn }]}>{i + 1}</Text>
                      </View>
                      <View style={styles.rtBody}>
                        <Text numberOfLines={1} style={[type.smallStrong, { color: theme.ink }]}>{a.name || a.email}</Text>
                        <Text numberOfLines={1} style={[type.small, { color: theme.ink3, fontSize: 12 }]}>{a.email}</Text>
                      </View>
                      <Pressable onPress={() => removeApprover(i)} hitSlop={10} accessibilityLabel={`Remove ${a.name || a.email}`} style={styles.rtRemove}>
                        <Feather name="x" size={15} color={theme.ink3} />
                      </Pressable>
                    </View>
                    {unconfirmed ? (
                      <View style={styles.rtWarn}>
                        <Feather name="clock" size={11} color="#92400E" />
                        <Text style={[type.small, { color: "#92400E", fontSize: 11.5, marginLeft: 6, flex: 1, lineHeight: 16 }]}>
                          We email them to confirm their address, then send the letter to approve. It waits here until they do.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {approverPool.filter((m) => !selectedEmails.has((m.email || "").toLowerCase())).length > 0 ? (
                <View style={{ marginTop: space(3) }}>
                  <Text style={[type.small, { color: theme.ink3, fontSize: 12, marginBottom: 8 }]}>
                    {approvers.length ? "Add another" : "Tap to add"}
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {approverPool.filter((m) => !selectedEmails.has((m.email || "").toLowerCase())).map((m) => {
                      const unconfirmed = m.status && m.status !== "confirmed";
                      return (
                        <Pressable
                          key={m.id || m.email}
                          onPress={() => pickApprover(m)}
                          accessibilityLabel={`Add ${m.name || m.email} as an approver`}
                          style={({ pressed }) => [styles.rtChip, pressed && { backgroundColor: theme.bg }]}
                        >
                          <Feather name="plus" size={13} color={theme.brand} />
                          <Text numberOfLines={1} style={styles.rtChipTxt}>{m.name || m.email}</Text>
                          {unconfirmed ? <Feather name="clock" size={11} color={theme.ink4} style={{ marginLeft: 5 }} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Invite a new approver — progressive disclosure. */}
              {addOpen ? (
                <View style={styles.apAddForm}>
                  <TextInput value={newName} onChangeText={setNewName} placeholder="Name (optional)" placeholderTextColor={theme.ink4} style={[styles.input, { marginBottom: 8 }]} />
                  <TextInput value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" placeholder="approver@email.com" placeholderTextColor={theme.ink4} style={styles.input} />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <Pressable onPress={() => { setAddOpen(false); setAddMsg(null); }} style={[styles.apFormBtn, { backgroundColor: theme.bg }]}><Text style={[type.smallStrong, { color: theme.ink2 }]}>Cancel</Text></Pressable>
                    <Pressable onPress={submitNewApprover} disabled={addBusy} style={[styles.apFormBtn, { backgroundColor: theme.brand, flex: 1 }]}><Text style={[type.smallStrong, { color: "#fff" }]}>{addBusy ? "Sending…" : "Send invite"}</Text></Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => { setAddOpen(true); setAddMsg(null); }} style={({ pressed }) => [styles.apInvite, pressed && { opacity: 0.7 }]}>
                  <Feather name="user-plus" size={16} color={theme.brand} />
                  <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 8 }]}>Invite a new approver</Text>
                </Pressable>
              )}
              {addMsg ? <Text style={[type.small, { marginTop: 8, color: addMsg.type === "err" ? "#B42318" : "#166534" }]}>{addMsg.text}</Text> : null}

              {validApprovers.length ? (
                <Text style={[type.small, { color: theme.ink4, marginTop: 12, lineHeight: 17 }]}>Sent in order, each approves from their email (no login). The candidate is emailed to sign only after the last approval.</Text>
              ) : null}
            </FoldField>

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

// A Field you can fold away, with a one-line summary of what is inside so the
// section still answers its own question while shut. Signature and approvers are
// the two longest blocks on this sheet and are usually already settled, so
// collapsing them is what makes the terms and the letter reachable without a
// long scroll.
function FoldField({ label, summary, open, onToggle, children, style }) {
  return (
    <View style={[{ marginTop: space(4) }, style]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}. ${open ? "Collapse" : "Expand"}`}
        style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4 }}
      >
        <Text style={[type.smallStrong, { color: theme.ink2 }]}>{label}</Text>
        <Text numberOfLines={1} style={[type.small, { color: theme.ink3, fontSize: 12, flex: 1, marginLeft: 8, textAlign: "right" }]}>
          {open ? "" : summary}
        </Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={theme.ink3} style={{ marginLeft: 6 }} />
      </Pressable>
      {open ? <View style={{ marginTop: 7 }}>{children}</View> : null}
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
  apSelRow: { flexDirection: "row", alignItems: "stretch" },
  apOrder: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", marginTop: 13 },
  apOrderTxt: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 },
  apRail: { width: 2, flex: 1, backgroundColor: theme.line, marginVertical: 3, borderRadius: 1 },
  apCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, padding: 10, marginBottom: 8, marginLeft: 6, backgroundColor: theme.card },
  apAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  apAvatarTxt: { fontFamily: "Inter_700Bold", fontSize: 12 },
  apRemove: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  apGroupLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, color: theme.ink4, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 10, marginBottom: 7 },
  apAddRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, padding: 10, marginBottom: 8, backgroundColor: theme.card },
  apPlus: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  apAddBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingLeft: 8, paddingRight: 11, paddingVertical: 7 },
  apAddBtnTxt: { color: theme.brand, fontFamily: "Inter_700Bold", fontSize: 12.5 },
  apConfirmedPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 7 },
  apConfirmedTxt: { color: "#166534", fontFamily: "Inter_700Bold", fontSize: 10 },
  rtCard: { borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, paddingHorizontal: space(3), paddingVertical: space(3), marginBottom: 8 },
  // One unbroken line behind every node. Inset so it starts and ends inside the
  // first and last node rather than poking out past them.
  rtSpine: { position: "absolute", left: space(3) + 11, top: space(3) + 12, bottom: space(3) + 12, width: 2, backgroundColor: theme.line2 },
  rtRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: space(4) },
  rtNode: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  rtNodeGhost: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
  rtNodeTxt: { fontSize: 11.5, fontFamily: "Inter_700Bold", color: theme.brand },
  rtBody: { flex: 1, minWidth: 0, marginLeft: 12, paddingTop: 1 },
  rtRemove: { padding: 4, marginLeft: 6, marginTop: -2 },
  rtWarn: { flexDirection: "row", alignItems: "flex-start", marginTop: 6, borderRadius: radius.sm, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", paddingHorizontal: 8, paddingVertical: 6 },
  rtChip: { flexDirection: "row", alignItems: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, paddingHorizontal: 11, paddingVertical: 8, marginRight: 8, marginBottom: 8, maxWidth: "100%" },
  rtChipTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: theme.ink, marginLeft: 5, flexShrink: 1 },
  apPickRow: { flexDirection: "row", alignItems: "flex-start", borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, paddingHorizontal: space(3), paddingVertical: space(3), marginBottom: 8 },
  apPickRowOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  apPickMark: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: theme.line2, backgroundColor: theme.card, alignItems: "center", justifyContent: "center", marginTop: 1 },
  apPickMarkTxt: { color: theme.white, fontFamily: "Inter_700Bold", fontSize: 12 },
  apPendingPill: { flexDirection: "row", alignItems: "center", backgroundColor: "#FEF3C7", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  apPendingTxt: { color: "#92400E", fontFamily: "Inter_700Bold", fontSize: 12 },
  sbRow: { flexDirection: "row", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, paddingHorizontal: space(3), paddingVertical: space(3), marginBottom: 8 },
  sbRowOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  sbDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.line2, alignItems: "center", justifyContent: "center" },
  sbDotIn: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.brand },
  sigFieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5, textTransform: "uppercase", color: theme.ink2, marginTop: space(4), marginBottom: 6 },
  lvBar: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  boldBtn: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  sigPad: { borderRadius: radius.md, borderWidth: 1, borderColor: "transparent" },
  sigSaved: { flexDirection: "row", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, paddingHorizontal: space(3), paddingVertical: space(3) },
  apEmpty: { alignItems: "center", paddingVertical: 22, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.line, borderStyle: "dashed", borderRadius: radius.lg, backgroundColor: theme.bg, marginBottom: 10 },
  apEmptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  apAddForm: { borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, padding: 12, backgroundColor: theme.bg, marginTop: 4 },
  apFormBtn: { alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16 },
  apInvite: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.line, borderStyle: "dashed", borderRadius: radius.md, paddingVertical: 13, marginTop: 4 },
  addApprover: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingVertical: 6 },
  err: { flexDirection: "row", alignItems: "flex-start", marginTop: space(4), padding: space(3), borderRadius: radius.md, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  footer: { paddingTop: space(3), marginTop: space(1), borderTopWidth: 1, borderTopColor: theme.line },
  sendingOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.4)" },
});
