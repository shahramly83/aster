import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, TextInput, Linking, Modal, StyleSheet, Alert, Pressable, ActivityIndicator, Keyboard, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadCandidate, loadScorecards, loadCandidateInterview, moveCandidateStage, loadOffer, loadOfferApprovals, signedOfferUrl, loadApplicationMeta, shareMeetingLink, resendInterviewInvite, loadInterviewQuestions, generateInterviewQuestions } from "../lib/data";
import { Card, Button, Avatar, Press, SectionHeader, Feather, Loader } from "../components/ui";
import { AsterMark } from "../components/Logo";
import OfferSheet from "../components/OfferSheet";
import ProposeTimesSheet from "../components/ProposeTimesSheet";
import ConfirmDialog from "../components/ConfirmDialog";
import SuccessModal from "../components/SuccessModal";
import AiInsight from "../components/AiInsight";
import AiQuestions from "../components/AiQuestions";
import { theme, type, space, radius, shadow } from "../theme";
import { recommendationMeta, averageRating, stageLabel, stageColor, fmtInterviewTime, fmtInterviewRange, deriveInsights } from "@aster/shared";

// The hiring process, in order. Offer/Hired are shown but managed on web.
const STEPS = ["applied", "shortlisted", "interviewing", "offer", "hired"];

// "Tue 12 Aug · 2:00–3:00 PM" for a proposed interview slot.
const _WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const _MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const _hm = (iso) => { const d = new Date(iso); return `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${String(d.getMinutes()).padStart(2, "0")}`; };
const _ap = (iso) => (new Date(iso).getHours() < 12 ? "AM" : "PM");
// Track the soft-keyboard height so the scroll content can lift its bottom
// fields above it (Android edge-to-edge doesn't resize the view for us).
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

function slotRange(startIso, endIso) {
  const s = new Date(startIso);
  const date = `${_WD[s.getDay()]} ${s.getDate()} ${_MON[s.getMonth()]}`;
  if (!endIso) return `${date} · ${_hm(startIso)} ${_ap(startIso)}`;
  const same = _ap(startIso) === _ap(endIso);
  return `${date} · ${_hm(startIso)}${same ? "" : ` ${_ap(startIso)}`}–${_hm(endIso)} ${_ap(endIso)}`;
}

export default function CandidateProfileScreen({ route, navigation }) {
  const { profile, manager } = useAuth();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const scrollRef = useRef(null);
  const { candidateId, applicationId, jobId, candidateName } = route.params || {};
  const [candidate, setCandidate] = useState(null);
  const [cards, setCards] = useState([]);
  const [stage, setStage] = useState(route.params?.stage || "applied");
  const [interview, setInterview] = useState(null); // full loadCandidateInterview record
  const [proposeOpen, setProposeOpen] = useState(false);
  const [mlInput, setMlInput] = useState("");
  const [mlSaving, setMlSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // branded confirm dialog config
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerSent, setOfferSent] = useState(null); // { title, message } for the branded success modal
  const [offer, setOffer] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [matchReason, setMatchReason] = useState(null);
  const [matchScore, setMatchScore] = useState(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [questions, setQuestions] = useState([]); // AI interview questions [{category, question}]
  const [genQ, setGenQ] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, sc, iv, off, meta, qs] = await Promise.all([
      loadCandidate(candidateId),
      loadScorecards(candidateId),
      loadCandidateInterview(profile.companyId, candidateId),
      loadOffer(profile.companyId, candidateId),
      loadApplicationMeta(profile.companyId, candidateId),
      loadInterviewQuestions(candidateId, jobId),
    ]);
    setCandidate(c); setCards(sc); setInterview(iv); setOffer(off); setQuestions(qs || []);
    setMlInput(iv?.meetingLink || "");
    if (meta?.stage) setStage(meta.stage); // true current stage (e.g. from a notification)
    setMatchReason(meta?.reason || null);
    setMatchScore(meta?.score ?? null);
    setApprovals(off?.id && off.approval_status ? await loadOfferApprovals(off.id) : []);
    setLoading(false);
  }, [candidateId, jobId, profile.companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nameOf = () => candidate?.name || candidateName || "Candidate";

  // Move the candidate to a stage, mirroring the web setCandidateStage side
  // effects (activity log on hire, hired/rejected candidate email). Optimistic.
  const applyStage = async (to) => {
    const prev = stage;
    setStage(to);
    try { await moveCandidateStage({ companyId: profile.companyId, candidateId, candidateName: nameOf(), stage: to }); }
    catch (e) { setStage(prev); Alert.alert("Could not update", e?.message || "Please try again."); }
  };

  const moveTo = (to) => {
    const isHire = to === "hired";
    setConfirm({
      icon: isHire ? "award" : "arrow-right-circle",
      variant: isHire ? "success" : "primary",
      title: isHire ? "Mark as hired?" : `Move to ${stageLabel(to)}?`,
      message: isHire
        ? `${nameOf()} will be marked hired and emailed a congratulations.`
        : `${nameOf()} will be moved to ${stageLabel(to)}.`,
      confirmLabel: isHire ? "Mark hired" : "Move",
      onConfirm: () => applyStage(to),
    });
  };

  const viewSigned = async () => {
    const url = await signedOfferUrl(candidateId);
    if (url) Linking.openURL(url);
    else Alert.alert("Not available yet", "The signed offer PDF isn't ready.");
  };

  const reject = () => {
    setConfirm({
      icon: "x-circle",
      variant: "danger",
      title: "Reject candidate?",
      message: `${nameOf()} will be moved to Rejected and emailed.`,
      confirmLabel: "Reject",
      onConfirm: () => applyStage("rejected"),
    });
  };

  // Save the link and email it to the candidate + the whole panel (web parity).
  const persistMl = async (link) => {
    setMlSaving(true);
    const res = await shareMeetingLink(profile.companyId, candidateId, jobId, link);
    setMlSaving(false);
    if (!res.ok) { Alert.alert("Couldn't share link", res.error || "Try again."); return; }
    Keyboard.dismiss();
    const who = [res.candidate ? "the candidate" : null, res.panel ? `${res.panel} panel member${res.panel === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
    Alert.alert("Link shared", who ? `Sent to ${who} with a calendar invite.` : "Meeting link saved.");
    load();
  };

  const saveMl = () => persistMl(mlInput.trim());

  // Fill the field with a ready-to-use video room (Jitsi Meet, no account
  // needed). This does NOT send — the HM reviews it and taps Share to email it.
  const genMeetingLink = () => {
    const rand = Math.random().toString(36).slice(2, 10);
    const tag = (candidateId || "iv").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
    setMlInput(`https://meet.jit.si/Aster-${tag}-${rand}`);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  };

  const resendInvite = async () => {
    if (!interview?.token) return;
    const res = await resendInterviewInvite(interview.token);
    Alert.alert(res.ok ? "Email resent" : "Couldn't resend", res.ok ? "The candidate got the booking link again." : (res.error || "Try again."));
  };

  const genQuestions = async () => {
    setGenQ(true);
    const res = await generateInterviewQuestions({
      companyId: profile.companyId, candidateId, jobId,
      parsed: candidate?.parsed || {}, jobTitle: route.params?.jobTitle,
    });
    setGenQ(false);
    if (!res.ok) { Alert.alert("Couldn't generate questions", res.error || "Try again."); return; }
    setQuestions(res.questions);
  };

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" }}>
      <Loader tint="#fff" />
    </View>
  );

  const parsed = candidate?.parsed || {};
  const name = nameOf();
  // AI Insight: use the stored Claude analysis, else derive from the resume so
  // every profile shows one (same as web).
  const insights = candidate ? (candidate.experienceInsights || deriveInsights(candidate)) : null;

  // ---- Interview → decision → offer → hired state machine (web sequence) ----
  const scheduledAt = interview?.status === "scheduled" ? interview.scheduledAt : null;
  // The candidate's chosen slot is one of the proposed ranges; recover its end
  // so the confirmed card can show the full window (e.g. 9:00 – 10:00 am).
  const scheduledEnd = scheduledAt
    ? ((interview?.proposedSlots || []).find((s) => s?.start && new Date(s.start).getTime() === new Date(scheduledAt).getTime())?.end || null)
    : null;
  const pendingInvite = interview?.status === "sent" ? interview : null;
  const interviewDone = !!scheduledAt && new Date(scheduledAt).getTime() < Date.now();
  // Show the interview flow once the candidate reaches interviewing (or there's
  // already an invite/booking).
  const showInterview = stage === "interviewing" || !!scheduledAt || !!pendingInvite;
  const canScore = interviewDone || ["offer", "hired"].includes(stage);
  // Every panel member (interview attendees) must submit a scorecard before the
  // decision opens. Falls back to "any scorecard" if attendees weren't recorded.
  const ratedIds = new Set(cards.map((c) => c.interviewerId));
  const myCard = cards.find((c) => c.interviewerId === profile.userId) || null; // this viewer's own scorecard, if any
  const panel = interview?.attendees || [];
  // Interviewers must submit a scorecard; the hiring manager's is optional (they
  // can skip it). The HM is the attendee flagged hm:true (older invites: the
  // first attendee). The decision opens once every interviewer has scored.
  const hasHmFlag = panel.some((p) => p.hm);
  const requiredRaters = panel.filter((p, i) => p.id && !(hasHmFlag ? p.hm : i === 0));
  const ratedRequired = requiredRaters.filter((p) => ratedIds.has(p.id)).length;
  const allRated = requiredRaters.length ? ratedRequired === requiredRaters.length : true;
  const showDecision = manager && stage === "interviewing" && interviewDone && allRated;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Gradient profile header with a big transparent Aster mark in the corner */}
      <LinearGradient colors={["#123AF0", "#0B2AE0", "#0A1E9E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.watermark} pointerEvents="none">
          <AsterMark size={168} color="rgba(255,255,255,0.12)" />
        </View>
        <SafeAreaView edges={["top"]}>
          <View style={styles.heroTop}>
            <Press onPress={() => navigation.goBack()} haptic="light" style={styles.circleBtn}>
              <Feather name="arrow-left" size={20} color={theme.white} />
            </Press>
            <View style={{ flex: 1 }} />
            <Press onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} haptic="light" style={styles.circleBtn}>
              <Feather name="message-circle" size={19} color={theme.white} />
            </Press>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Identity block sits OUTSIDE the scroll so the avatar can overlap the
          header edge without being clipped by the ScrollView. */}
      <View style={styles.identity}>
        <View style={styles.avatarRing}>
          <Avatar uri={candidate?.avatarUrl} name={name} size={88} />
        </View>
        <View style={[styles.badge, { backgroundColor: stageColor(stage) }]}>
          <Feather name="zap" size={12} color={theme.white} />
          <Text style={styles.badgeTxt}>{stageLabel(stage)}</Text>
        </View>
        <Text style={styles.name} numberOfLines={2}>{name}</Text>
      </View>

      {/* Scrolling content */}
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space(4) + (kb > 0 ? kb : 0) }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.sheet}>
            {/* Actions */}
            <View style={styles.actions}>
              <Button title="Discuss with Panel" icon="message-circle" variant="secondary" onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} style={matchReason ? { flex: 1.7 } : { flex: 1 }} />
              {matchReason ? (
                <Button title="Why" icon="zap" variant="ghost" onPress={() => setWhyOpen(true)} style={{ flex: 1 }} />
              ) : null}
            </View>

            {/* Candidate details — collapsed by default to keep the hiring flow clean */}
            <Pressable onPress={() => setDetailsOpen((o) => !o)} style={styles.exploreToggle}>
              <View style={styles.exploreIcon}><Feather name="file-text" size={16} color={theme.brand} /></View>
              <Text style={[type.bodyStrong, { color: theme.ink, flex: 1, marginLeft: 10 }]}>Candidate details</Text>
              <Feather name={detailsOpen ? "chevron-up" : "chevron-down"} size={20} color={theme.ink3} />
            </Pressable>
            {detailsOpen ? (
              <View>
                {/* AI Insight — resume deep-dive (experience + employment analysis) */}
                {insights ? (
                  <View style={{ marginTop: space(4) }}>
                    <View style={styles.aiHead}>
                      <Feather name="zap" size={14} color={theme.brand} />
                      <Text style={[type.label, { color: theme.ink3, marginLeft: 6 }]}>AI INSIGHT</Text>
                    </View>
                    <AiInsight insights={insights} />
                  </View>
                ) : null}

                {(() => {
                  const email = parsed.email || candidate?.email;
                  const rows = [
                    parsed.location && { icon: "map-pin", value: parsed.location },
                    parsed.years_of_experience != null && { icon: "briefcase", value: `${parsed.years_of_experience} years of experience` },
                    parsed.salary_expectation && { icon: "dollar-sign", value: String(parsed.salary_expectation) },
                    email && { icon: "mail", value: email, onPress: () => Linking.openURL(`mailto:${email}`) },
                    parsed.phone && { icon: "phone", value: parsed.phone, onPress: () => Linking.openURL(`tel:${parsed.phone}`) },
                    parsed.linkedin_url && { icon: "linkedin", value: "LinkedIn profile", onPress: () => Linking.openURL(parsed.linkedin_url) },
                    parsed.portfolio_url && { icon: "globe", value: "Portfolio", onPress: () => Linking.openURL(parsed.portfolio_url) },
                  ].filter(Boolean);
                  return rows.length ? (
                    <View style={{ marginTop: space(4) }}>
                      <SectionHeader>Contact</SectionHeader>
                      <Card style={{ paddingVertical: space(1) }}>
                        {rows.map((r, i) => <DetailRow key={i} {...r} last={i === rows.length - 1} />)}
                      </Card>
                    </View>
                  ) : null;
                })()}

                {parsed.summary ? (
                  <View style={{ marginTop: space(5) }}>
                    <SectionHeader>Summary</SectionHeader>
                    <Card><Text style={[type.body, { color: theme.ink2 }]}>{parsed.summary}</Text></Card>
                  </View>
                ) : null}

                {Array.isArray(parsed.skills) && parsed.skills.length ? (
                  <View style={{ marginTop: space(5) }}>
                    <SectionHeader>Skills</SectionHeader>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {parsed.skills.slice(0, 16).map((s, i) => (
                        <View key={i} style={styles.skill}><Text style={[type.small, { color: theme.ink2 }]}>{String(s)}</Text></View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {Array.isArray(parsed.experience) && parsed.experience.length ? (
                  <View style={{ marginTop: space(5) }}>
                    <SectionHeader>Experience</SectionHeader>
                    <Card>
                      {parsed.experience.map((e, i) => (
                        <View key={i} style={i > 0 ? styles.timelineItem : null}>
                          <Text style={[type.bodyStrong, { color: theme.ink }]}>{e.title || "Role"}{e.company ? ` · ${e.company}` : ""}</Text>
                          {e.duration ? <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]}>{e.duration}</Text> : null}
                          {e.summary ? <Text style={[type.small, { color: theme.ink2, marginTop: 5, lineHeight: 19 }]}>{e.summary}</Text> : null}
                        </View>
                      ))}
                    </Card>
                  </View>
                ) : null}

                {Array.isArray(parsed.education) && parsed.education.length ? (
                  <View style={{ marginTop: space(5) }}>
                    <SectionHeader>Education</SectionHeader>
                    <Card>
                      {parsed.education.map((e, i) => (
                        <View key={i} style={i > 0 ? styles.timelineItem : null}>
                          <Text style={[type.bodyStrong, { color: theme.ink }]}>{e.degree || "Studies"}</Text>
                          <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]}>{[e.institution, e.year].filter(Boolean).join(" · ")}</Text>
                        </View>
                      ))}
                    </Card>
                  </View>
                ) : null}

                {Array.isArray(parsed.languages) && parsed.languages.length ? (
                  <View style={{ marginTop: space(5) }}>
                    <SectionHeader>Languages</SectionHeader>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {parsed.languages.map((l, i) => (
                        <View key={i} style={styles.skill}><Text style={[type.small, { color: theme.ink2 }]}>{String(l)}</Text></View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {Array.isArray(parsed.certifications) && parsed.certifications.length ? (
                  <View style={{ marginTop: space(5) }}>
                    <SectionHeader>Certifications</SectionHeader>
                    <Card>
                      {parsed.certifications.map((c, i) => (
                        <View key={i} style={[styles.certRow, i > 0 && styles.detailDivider]}>
                          <Feather name="award" size={15} color={theme.brand} />
                          <Text style={[type.small, { color: theme.ink2, flex: 1, marginLeft: 10 }]}>{String(c)}</Text>
                        </View>
                      ))}
                    </Card>
                  </View>
                ) : null}
              </View>
            ) : null}

          {/* Hiring process */}
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>Hiring process</SectionHeader>
            <Card>
              <ProcessStepper stage={stage} />
              {manager && (stage === "applied" || stage === "shortlisted") ? (
                <View style={styles.stageActions}>
                  {stage === "applied" ? (
                    <Button title="Shortlist" icon="star" onPress={() => moveTo("shortlisted")} />
                  ) : (
                    <Button title="Move to interview" icon="calendar" onPress={() => moveTo("interviewing")} />
                  )}
                </View>
              ) : null}
            </Card>
          </View>

          {/* Offer (created + sent from mobile; signed on the hosted Aster Sign page) */}
          {offer ? (
            <View style={{ marginTop: space(5) }}>
              <SectionHeader>Offer</SectionHeader>
              <OfferCard offer={offer} approvals={approvals} onViewSigned={viewSigned} canHire={manager && stage !== "hired"} onHire={() => moveTo("hired")} />
            </View>
          ) : null}

          {/* Interview flow: propose times -> candidate picks -> meeting link */}
          {showInterview ? (
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>Interview</SectionHeader>
            <Card>
              {scheduledAt ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={styles.ivIcon}><Feather name="calendar" size={18} color={theme.brand} /></View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[type.bodyStrong, { color: theme.ink }]}>{interviewDone ? "Interview held" : "Interview confirmed"}</Text>
                      <Text style={[type.small, { color: theme.ink2, marginTop: 1 }]}>{fmtInterviewRange(scheduledAt, scheduledEnd, profile.timezone)}</Text>
                    </View>
                  </View>
                  {/* Meeting link appears once the candidate has accepted. Generate a
                      room or paste one — nothing sends until the HM taps Share. */}
                  <View style={styles.mlWrap}>
                    <Text style={[type.smallStrong, { color: theme.ink2, marginBottom: 8 }]}>Meeting link</Text>
                    {interview?.meetingLink ? (
                      <>
                        <Pressable onPress={() => Linking.openURL(interview.meetingLink)} style={styles.mlChip}>
                          <View style={styles.mlChipIcon}><Feather name="video" size={15} color={theme.brand} /></View>
                          <Text style={[type.small, { color: theme.ink, flex: 1 }]} numberOfLines={1}>{interview.meetingLink}</Text>
                          <Feather name="external-link" size={15} color={theme.brand} />
                        </Pressable>
                        {manager ? (
                          <>
                            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 7 }}>
                              <Feather name="check-circle" size={13} color={theme.success} />
                              <Text style={[type.small, { color: theme.success, marginLeft: 6 }]}>Shared with the candidate and panel</Text>
                            </View>
                            <Text style={[type.small, { color: theme.ink4, marginTop: 10, marginBottom: 7 }]}>Replace it, then Share again</Text>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <Text style={[type.small, { color: theme.ink4, marginBottom: 8 }]}>
                        {manager ? "Generate a room or paste your own. Nothing is sent until you tap Share." : "The hiring manager will add the meeting link before the interview."}
                      </Text>
                    )}
                    {/* Only the hiring manager can generate/paste/share the link. */}
                    {manager ? (
                      <>
                        {/* Fill-only: generates a link into the field, doesn't send. */}
                        <Pressable onPress={genMeetingLink} style={styles.mlGen}>
                          <Feather name="video" size={15} color={theme.brand} />
                          <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 8 }]}>Generate a link</Text>
                        </Pressable>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TextInput
                            value={mlInput} onChangeText={setMlInput}
                            placeholder="https://meet.google.com/…" placeholderTextColor={theme.ink4}
                            autoCapitalize="none" keyboardType="url"
                            onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
                            style={[styles.mlInput, { flex: 1 }]}
                          />
                          <Pressable onPress={saveMl} disabled={mlSaving || !mlInput.trim()} style={[styles.mlSave, (mlSaving || !mlInput.trim()) && { opacity: 0.5 }]}>
                            {mlSaving ? <ActivityIndicator size="small" color={theme.white} /> : <Text style={[type.smallStrong, { color: theme.white }]}>Share</Text>}
                          </Pressable>
                        </View>
                      </>
                    ) : null}
                  </View>
                </>
              ) : pendingInvite ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={styles.ivIcon}><Feather name="clock" size={18} color={theme.warn} /></View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[type.bodyStrong, { color: theme.ink }]}>Waiting on the candidate</Text>
                      <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>{pendingInvite.proposedSlots.length} time{pendingInvite.proposedSlots.length === 1 ? "" : "s"} proposed. They'll pick one.</Text>
                    </View>
                  </View>
                  {pendingInvite.proposedSlots.map((s, i) => (
                    <View key={i} style={styles.slotRow}>
                      <Feather name="calendar" size={13} color={theme.ink4} />
                      <Text style={[type.small, { color: theme.ink2, marginLeft: 8 }]}>{slotRange(s.start, s.end)}</Text>
                    </View>
                  ))}
                  {manager ? <Button title="Resend invite" icon="mail" variant="ghost" onPress={resendInvite} style={{ marginTop: space(3) }} /> : null}
                </>
              ) : (
                <>
                  <Text style={[type.small, { color: theme.ink3 }]}>Get the panel's availability, then propose a few times for the candidate to choose from.</Text>
                  <Button title="1 · Panel availability" icon="users" variant="secondary" onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} style={{ marginTop: space(3) }} />
                  {manager ? <Button title="2 · Propose times to candidate" icon="calendar" onPress={() => setProposeOpen(true)} style={{ marginTop: space(2.5) }} /> : null}
                </>
              )}
            </Card>
          </View>
          ) : null}

          {/* AI interview questions — tailored to the candidate + role, once the
              interview is confirmed. Manager generates; the panel reads. */}
          {scheduledAt ? (
            <View style={{ marginTop: space(5) }}>
              <View style={styles.aiHead}>
                <Feather name="zap" size={14} color={theme.brand} />
                <Text style={[type.label, { color: theme.ink3, marginLeft: 6 }]}>AI INTERVIEW QUESTIONS</Text>
              </View>
              {questions.length ? (
                <AiQuestions questions={questions} />
              ) : manager ? (
                <Card>
                  <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>Generate questions tailored to {nameOf().split(" ")[0]}'s resume and this role. The whole panel sees the same set.</Text>
                  <Button title={genQ ? "Generating…" : "Generate questions"} icon={genQ ? undefined : "zap"} onPress={genQuestions} disabled={genQ} />
                </Card>
              ) : (
                <Card><Text style={[type.small, { color: theme.ink3 }]}>The hiring manager will generate tailored interview questions before the call.</Text></Card>
              )}
            </View>
          ) : null}

          {/* Decision — opens once the panel has all scored */}
          {showDecision ? (
            <View style={{ marginTop: space(5) }}>
              <SectionHeader>Decision</SectionHeader>
              <Card>
                <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>The panel has finished scoring. Make the call.</Text>
                <Button title="Make offer" icon="file-text" variant="success" onPress={() => setOfferOpen(true)} />
                <Button title="Decline candidate" icon="x" variant="danger" onPress={reject} style={{ marginTop: space(2.5) }} />
              </Card>
            </View>
          ) : null}

          {/* Panel feedback — scorecards open once an interview exists (web sequence) */}
          {(canScore || cards.length > 0) ? (
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>{requiredRaters.length ? `Panel feedback · ${ratedRequired}/${requiredRaters.length}` : "Panel feedback"}</SectionHeader>
            {cards.length === 0 ? (
              <Card><Text style={[type.small, { color: theme.ink3 }]}>No scorecards yet. Add yours after the interview.</Text></Card>
            ) : (
              cards.map((c) => {
                const meta = recommendationMeta(c.recommendation);
                return (
                  <Card key={c.id} style={{ marginBottom: space(2.5), flexDirection: "row", alignItems: "flex-start" }}>
                    <View style={[styles.recScore, { backgroundColor: meta.bg }]}>
                      <Text style={{ color: meta.color, fontFamily: "Inter_700Bold", fontSize: 15, fontVariant: ["tabular-nums"] }}>{averageRating(c.ratings).toFixed(1)}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={[type.smallStrong, { color: theme.ink, flex: 1 }]} numberOfLines={1}>
                          {c.interviewerId === profile.userId ? "You" : (c.interviewerName || "Panel member")}
                        </Text>
                        <Text style={[type.small, { color: meta.color, marginLeft: 8 }]}>{meta.label}</Text>
                      </View>
                      {c.notes ? <Text style={[type.small, { color: theme.ink2, marginTop: 3 }]} numberOfLines={4}>{c.notes}</Text> : <Text style={[type.small, { color: theme.ink4, marginTop: 3 }]}>No notes</Text>}
                    </View>
                  </Card>
                );
              })
            )}
            {canScore ? (
              <Button title={myCard ? "Edit my scorecard" : "Add my scorecard"} icon="edit-3" variant="secondary" onPress={() => navigation.navigate("Scorecard", { candidateId, jobId, candidateName: name, existing: myCard })} style={{ marginTop: space(3) }} />
            ) : null}
          </View>
          ) : null}


          {/* Reject */}
          {manager && stage !== "rejected" && stage !== "hired" && stage !== "declined" ? (
            <Pressable onPress={reject} style={{ alignSelf: "center", marginTop: space(7), padding: 8 }}>
              <Text style={[type.smallStrong, { color: theme.danger }]}>Reject candidate</Text>
            </Pressable>
          ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>

      <ProposeTimesSheet
        visible={proposeOpen}
        onClose={() => setProposeOpen(false)}
        companyId={profile.companyId}
        candidateId={candidateId}
        jobId={jobId}
        hm={{ id: profile.userId, name: profile.name, email: profile.email }}
        onSent={() => { setStage("interviewing"); load(); }}
      />

      {/* Why this match — slides up */}
      <Modal visible={whyOpen} transparent animationType="slide" onRequestClose={() => setWhyOpen(false)} statusBarTranslucent>
        <View style={styles.whyBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setWhyOpen(false)} />
          <View style={[styles.whySheet, { paddingBottom: insets.bottom + space(3) }]}>
            <View style={styles.whyHandle} />
            <View style={styles.whySheetHead}>
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                <View style={styles.whyIcon}><Feather name="zap" size={15} color={theme.brand} /></View>
                <Text style={[type.h3, { color: theme.ink, marginLeft: 10 }]}>Why this match</Text>
              </View>
              {matchScore != null ? (
                <View style={[styles.whyScore, { backgroundColor: (matchScore >= 75 ? theme.success : matchScore >= 50 ? theme.warn : theme.ink3) + "1A" }]}>
                  <Text style={[type.smallStrong, { color: matchScore >= 75 ? theme.success : matchScore >= 50 ? theme.warn : theme.ink3 }]}>{Math.round(matchScore)}% fit</Text>
                </View>
              ) : null}
            </View>
            <ScrollView style={{ maxHeight: 360, marginTop: space(3) }} showsVerticalScrollIndicator={false}>
              <Text style={[type.body, { color: theme.ink2, lineHeight: 22 }]}>{matchReason}</Text>
            </ScrollView>
            <Button title="Got it" onPress={() => setWhyOpen(false)} style={{ marginTop: space(4) }} />
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        icon={confirm?.icon}
        variant={confirm?.variant}
        confirmLabel={confirm?.confirmLabel}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const fn = confirm?.onConfirm; setConfirm(null); fn?.(); }}
      />

      <OfferSheet
        visible={offerOpen}
        onClose={() => setOfferOpen(false)}
        companyId={profile.companyId}
        companyName={profile.company}
        candidateId={candidateId}
        candidateName={name}
        jobId={jobId}
        defaults={{ jobTitle: route.params?.jobTitle || "" }}
        onSent={(res) => { setStage("offer"); load(); setOfferSent({ title: res?.title || "Offer sent", message: res?.message || "" }); }}
      />

      <SuccessModal
        visible={!!offerSent}
        title={offerSent?.title || "Offer sent"}
        message={offerSent?.message || ""}
        onClose={() => setOfferSent(null)}
      />
    </View>
  );
}

function OfferCard({ offer, approvals, onViewSigned, canHire, onHire }) {
  const st = offerStatus(offer);
  const cur = { myr: "RM", usd: "$", sgd: "S$" }[offer.salary_currency] || "";
  const emp = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" }[offer.employment_type] || null;
  const signed = offer.status === "accepted" || offer.esign_status === "completed";
  return (
    <Card>
      <View style={[styles.offerBadge, { backgroundColor: st.bg }]}>
        <Feather name={st.icon} size={13} color={st.color} />
        <Text style={[type.smallStrong, { color: st.color, marginLeft: 6 }]}>{st.label}</Text>
      </View>
      {offer.offer_job_title ? <Text style={[type.bodyStrong, { color: theme.ink, marginTop: space(3) }]}>{offer.offer_job_title}</Text> : null}
      <View style={{ marginTop: 6, gap: 5 }}>
        {offer.base_salary != null ? <OfferLine icon="dollar-sign" text={`${cur}${Number(offer.base_salary).toLocaleString()}${emp ? ` · ${emp}` : ""}`} /> : null}
        {offer.start_date ? <OfferLine icon="calendar" text={`Starts ${offer.start_date}`} /> : null}
        {offer.expires_at ? <OfferLine icon="clock" text={`Expires ${offer.expires_at}`} /> : null}
      </View>
      {approvals.length ? (
        <View style={{ marginTop: space(3), paddingTop: space(3), borderTopWidth: 1, borderTopColor: theme.line2 }}>
          <Text style={[type.smallStrong, { color: theme.ink2, marginBottom: 8 }]}>Approvals</Text>
          {approvals.map((a) => (
            <View key={a.step} style={styles.apprRow}>
              <View style={[styles.apprDot, { backgroundColor: a.status === "approved" ? theme.success : a.status === "declined" ? theme.danger : theme.line }]}>
                {a.status === "approved" ? <Feather name="check" size={10} color={theme.white} /> : a.status === "declined" ? <Feather name="x" size={10} color={theme.white} /> : null}
              </View>
              <Text style={[type.small, { color: theme.ink2, flex: 1, marginLeft: 8 }]} numberOfLines={1}>{a.approver_name || a.approver_email}</Text>
              <Text style={[type.small, { color: a.status === "declined" ? theme.danger : a.status === "approved" ? theme.success : theme.ink4 }]}>{a.status}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {signed && canHire ? <Button title="Mark as hired" icon="award" variant="success" onPress={onHire} style={{ marginTop: space(3) }} /> : null}
      {signed ? <Button title="View signed offer" icon="file-text" variant="secondary" onPress={onViewSigned} style={{ marginTop: space(2.5) }} /> : null}
    </Card>
  );
}

function OfferLine({ icon, text }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Feather name={icon} size={13} color={theme.ink4} />
      <Text style={[type.small, { color: theme.ink2, marginLeft: 8 }]}>{text}</Text>
    </View>
  );
}

function offerStatus(o) {
  if (o.approval_status === "pending") return { label: "Pending approval", color: "#B45309", bg: "#FEF3C7", icon: "clock" };
  if (o.approval_status === "declined") return { label: "Approval declined", color: theme.danger, bg: "#FEF3F2", icon: "x-circle" };
  if (o.status === "accepted" || o.esign_status === "completed") return { label: "Signed & accepted", color: "#166534", bg: "#F0FDF4", icon: "check-circle" };
  if (o.status === "declined") return { label: "Declined", color: theme.danger, bg: "#FEF3F2", icon: "x-circle" };
  return { label: "Sent · awaiting signature", color: theme.brand, bg: theme.brandSoft, icon: "send" };
}

function ProcessStepper({ stage }) {
  if (stage === "rejected" || stage === "declined") {
    return (
      <View style={styles.rejectBanner}>
        <Feather name="x-circle" size={16} color={theme.danger} />
        <Text style={[type.smallStrong, { color: theme.danger, marginLeft: 8 }]}>Candidate {stageLabel(stage).toLowerCase()}</Text>
      </View>
    );
  }
  const curIdx = STEPS.indexOf(stage);
  return (
    <View style={{ flexDirection: "row" }}>
      {STEPS.map((k, i) => {
        const done = curIdx > i;
        const active = curIdx === i;
        return (
          <View key={k} style={{ flex: 1, alignItems: "center" }}>
            <View style={styles.stepLine}>
              <View style={[styles.connector, { backgroundColor: i > 0 && curIdx >= i ? theme.brand : theme.line, opacity: i === 0 ? 0 : 1 }]} />
              <View style={[styles.stepDot, done && styles.stepDone, active && styles.stepActive]}>
                {done ? <Feather name="check" size={11} color={theme.white} /> : active ? <View style={styles.stepInner} /> : null}
              </View>
              <View style={[styles.connector, { backgroundColor: i < STEPS.length - 1 && curIdx > i ? theme.brand : theme.line, opacity: i === STEPS.length - 1 ? 0 : 1 }]} />
            </View>
            <Text style={[{ color: active ? theme.ink : theme.ink4, fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 10, marginTop: 7, textAlign: "center" }]} numberOfLines={1}>{stageLabel(k)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function DetailRow({ icon, value, onPress, last }) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[styles.detailRow, !last && styles.detailDivider]}>
      <Feather name={icon} size={16} color={theme.ink3} />
      <Text style={[type.small, { color: onPress ? theme.brand : theme.ink2, flex: 1, marginLeft: 12 }]} numberOfLines={1}>{value}</Text>
      {onPress ? <Feather name="external-link" size={14} color={theme.ink4} /> : null}
    </Wrap>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: space(11), overflow: "hidden" },
  watermark: { position: "absolute", top: 6, right: -32 },
  heroTop: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), paddingTop: space(2) },
  circleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  identity: { alignItems: "center", paddingHorizontal: space(5), marginTop: -52, paddingBottom: space(2) },
  avatarRing: { padding: 5, borderRadius: 54, backgroundColor: theme.card, shadowColor: "#0A1E9E", shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  badge: { flexDirection: "row", alignItems: "center", marginTop: -13, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill, shadowColor: "#0A1E9E", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  badgeTxt: { fontFamily: "Inter_700Bold", fontSize: 12.5, color: theme.white, marginLeft: 6 },
  name: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 22, lineHeight: 27, letterSpacing: -0.5, color: theme.ink, marginTop: space(3), textAlign: "center" },
  aiHead: { flexDirection: "row", alignItems: "center", marginBottom: space(3), marginLeft: space(1) },
  role: { fontFamily: "Inter_500Medium", fontSize: 13.5, color: theme.ink3, marginTop: space(2) },
  tags: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: space(3) },
  tag: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  tagTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: theme.ink, marginLeft: 6 },
  sheet: { backgroundColor: theme.bg, paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(6), minHeight: 340 },

  stageTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 8 },
  detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(3) },
  detailDivider: { borderBottomWidth: 1, borderBottomColor: theme.line2 },
  timelineItem: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line2 },
  certRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(2.5) },
  skill: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  recScore: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  ivIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  mlWrap: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line2 },
  mlInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, height: 44, fontFamily: "Inter_500Medium", fontSize: 14, color: theme.ink },
  mlSave: { paddingHorizontal: 16, height: 44, borderRadius: radius.md, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
  mlGen: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, marginBottom: 8 },
  mlChip: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.brandSoft, borderWidth: 1, borderColor: theme.brand, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11 },
  mlChipIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: theme.white, alignItems: "center", justifyContent: "center" },
  slotRow: { flexDirection: "row", alignItems: "center", marginTop: space(2.5), marginLeft: 50 },
  stageActions: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line2, gap: 10 },
  actions: { flexDirection: "row", gap: 10, justifyContent: "center" },
  exploreToggle: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, borderWidth: 1, borderColor: theme.line, paddingHorizontal: space(4), paddingVertical: space(3.5), marginTop: space(5), ...shadow.sm },
  exploreIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  whyIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  whyScore: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  whyBackdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  whySheet: { backgroundColor: theme.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: space(5), paddingTop: space(3) },
  whyHandle: { alignSelf: "center", width: 42, height: 5, borderRadius: 3, backgroundColor: theme.line, marginBottom: space(4) },
  whySheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  offerBadge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  apprRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  apprDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  // stepper
  stepLine: { flexDirection: "row", alignItems: "center", width: "100%" },
  connector: { flex: 1, height: 2 },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.line, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: theme.brand, borderColor: theme.brand },
  stepActive: { borderColor: theme.brand },
  stepInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.brand },
  rejectBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: space(2) },
});
