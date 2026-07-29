import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, TextInput, Linking, Modal, StyleSheet, Alert, Pressable, ActivityIndicator, Keyboard, Platform, Animated } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { inviteTeammate, assignInterviewer, stageInviteJob, unassignInterviewer, hasPanelPoll, loadInterviewers, loadCandidate, loadScorecards, loadCandidateInterview, moveCandidateStage, loadOffer, loadOfferApprovals, signedOfferUrl, loadApplicationMeta, shareMeetingLink, createVideoRoom, resendInterviewInvite, loadInterviewQuestions, generateInterviewQuestions, loadJobTitle, rescheduleInterview, subscribeInterviews, subscribeDashboard, runExperienceInsights, releaseScorecards } from "../lib/data";
import { Card, Button, Avatar, Press, SectionHeader, Feather, Loader } from "../components/ui";
import { Ionicons } from "@expo/vector-icons";
import { AsterMark } from "../components/Logo";
import OfferSheet from "../components/OfferSheet";
import ProposeTimesSheet from "../components/ProposeTimesSheet";
import ConfirmDialog from "../components/ConfirmDialog";
import SuccessModal from "../components/SuccessModal";
import AiInsight from "../components/AiInsight";
import AiQuestions from "../components/AiQuestions";
import { useDialog } from "../components/Dialog";
import { theme, type, space, radius, shadow } from "../theme";
import { recommendationMeta, averageRating, stageLabel, stageColor, fmtInterviewTime, fmtInterviewRange, SCORE_CRITERIA } from "@aster/shared";

// The hiring process, in order. Offer/Hired are shown but managed on web.
// The hiring process proper. "shortlisted" is deliberately NOT here: it is a
// personal bookmark (candidate_shortlists), not a stage everyone must pass
// through. It is spliced back in below only for a candidate who is actually
// sitting in that stage, so data the web app set still renders honestly.
const STEPS = ["applied", "interviewing", "offer", "hired"];
// Stages at or beyond interview. Offer/hired stay unlocked so a completed
// record remains readable after the fact.
const INTERVIEW_UNLOCKED = ["interviewing", "offer", "hired"];
const stepsFor = (stage) =>
  stage === "shortlisted" ? ["applied", "shortlisted", "interviewing", "offer", "hired"] : STEPS;

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

// Normalize a phone number for a wa.me link: digits only, with a leading local
// "0" converted to Malaysia's +60 country code (and a 00 international prefix
// stripped), so local numbers still open a WhatsApp chat.
function waNumber(phone) {
  let d = String(phone || "").replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "60" + d.slice(1);
  return d;
}

// "THU 6 AUG" — the day line of a ballot card, kept short so two sit side by side.
function slotDayLabel(iso) {
  const d = new Date(iso);
  return `${_WD[d.getDay()]} ${d.getDate()} ${_MON[d.getMonth()]}`;
}
function slotRange(startIso, endIso) {
  const s = new Date(startIso);
  const date = `${_WD[s.getDay()]} ${s.getDate()} ${_MON[s.getMonth()]}`;
  if (!endIso) return `${date} · ${_hm(startIso)} ${_ap(startIso)}`;
  const same = _ap(startIso) === _ap(endIso);
  return `${date} · ${_hm(startIso)}${same ? "" : ` ${_ap(startIso)}`}–${_hm(endIso)} ${_ap(endIso)}`;
}

// One interviewer's scorecard. The old row showed the average and nothing else,
// so the four scores that MAKE the average — the actual substance of a scorecard,
// and the only way to see WHERE someone was strong or weak — never appeared on
// this screen at all. Now the average leads, the breakdown sits beside it as
// filled pips, and the notes read as the quote they are.
function ScorecardCard({ card, mine }) {
  const meta = recommendationMeta(card.recommendation);
  const avg = averageRating(card.ratings);
  return (
    <Card style={{ marginBottom: space(2.5) }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Avatar name={card.interviewerName || "Panel member"} size={30} />
        <Text style={[type.smallStrong, { color: theme.ink, flex: 1, marginLeft: 9 }]} numberOfLines={1}>
          {mine ? "You" : (card.interviewerName || "Panel member")}
        </Text>
        {/* Recommendation as a labelled pill, not small coloured text: it is the
            verdict, and colour alone never carries it. */}
        <View style={[styles.recPill, { backgroundColor: meta.bg }]}>
          <Text style={[styles.recPillTxt, { color: meta.color }]} numberOfLines={1}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.scoreBody}>
        <View style={styles.scoreBig}>
          <Text style={[styles.scoreBigNum, { color: meta.color }]}>{avg.toFixed(1)}</Text>
          <Text style={styles.scoreBigOf}>OUT OF 4</Text>
        </View>
        {/* Four criteria as pips. A bar would read as a percentage; these are
            whole-number ratings out of four, so show four slots and fill them. */}
        <View style={{ flex: 1, marginLeft: space(4) }}>
          {SCORE_CRITERIA.map((crit, i) => {
            const v = Number(card.ratings?.[crit.key]) || 0;
            return (
              <View key={crit.key} style={[styles.critRow, i > 0 && { marginTop: 7 }]}>
                <Text style={styles.critLabel} numberOfLines={1}>{crit.label}</Text>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  {[1, 2, 3, 4].map((n) => (
                    <View key={n} style={[styles.pip, n <= v && { backgroundColor: meta.color }]} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {card.notes ? (
        <View style={styles.scoreNote}>
          <Text style={[type.small, { color: theme.ink2, lineHeight: 20 }]}>&ldquo;{card.notes}&rdquo;</Text>
        </View>
      ) : (
        <Text style={[type.small, { color: theme.ink4, marginTop: space(3) }]}>No notes left.</Text>
      )}
    </Card>
  );
}

// The "current" hiring-journey step: a solid dot with a pulsing halo behind it,
// matching the web's animate-ping ring.
function PulseDot({ color }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(anim, { toValue: 1, duration: 1500, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  return (
    <View style={{ width: 9, height: 9, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: 9, height: 9, borderRadius: 5, backgroundColor: color, transform: [{ scale }], opacity }} />
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
    </View>
  );
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
  // Which role this profile is about. Arriving from the role list or an interview
  // card we already have it; a notification tap carries ids only, so fall back to
  // looking it up rather than leaving the header silent about the position.
  const [jobTitle, setJobTitle] = useState(route.params?.jobTitle || null);
  const [proposeOpen, setProposeOpen] = useState(false);
  // Who is interviewing: null = not answered, "solo" = the hiring manager alone,
  // "panel" = with interviewers. Mirrors the web. Only ever asked when the role
  // has nobody on its panel, because a panel that already exists has answered it.
  const [ivMode, setIvMode] = useState(null);
  const [rolePanel, setRolePanel] = useState(null); // the role's assigned interviewers; null until loaded
  const [polled, setPolled] = useState(false); // the panel has been asked for availability at least once
  const [removingId, setRemovingId] = useState(null); // panel member being taken off the role
  const [team, setTeam] = useState([]); // every interviewer in the workspace, assigned or not
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingId, setSavingId] = useState(null); // teammate being added/removed in the picker
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteNote, setInviteNote] = useState(null); // { ok: bool, msg }
  const [mlInput, setMlInput] = useState("");
  const [mlSaving, setMlSaving] = useState(false);
  const [replacingLink, setReplacingLink] = useState(false); // show the edit controls when replacing a shared link
  const [genningRoom, setGenningRoom] = useState(false); // creating a video room
  const dialog = useDialog();
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
  const [noShowDismissed, setNoShowDismissed] = useState(false); // hide the post-interview reschedule prompt
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("profile"); // interview page sub-tabs: profile | interview | feedback
  const [lockNote, setLockNote] = useState(null); // message shown when a locked tab is tapped
  const [insightRun, setInsightRun] = useState(null);   // result of a run this session
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightErr, setInsightErr] = useState(null);
  const [insightCapped, setInsightCapped] = useState(false); // out of credits
  const tabInit = useRef(false); // only auto-pick the default tab once, so a manual switch sticks
  const tabAnim = useRef(new Animated.Value(1)).current; // fade + slide when switching tabs
  const segScrollRef = useRef(null); // so the active tab is scrolled into view (Result sits off the right edge)

  const load = useCallback(async () => {
    const [c, sc, iv, off, meta, qs, title, crew, wasPolled] = await Promise.all([
      loadCandidate(candidateId),
      loadScorecards(candidateId, jobId),
      loadCandidateInterview(profile.companyId, candidateId),
      loadOffer(profile.companyId, candidateId, jobId),
      loadApplicationMeta(profile.companyId, candidateId),
      loadInterviewQuestions(candidateId, jobId),
      route.params?.jobTitle ? Promise.resolve(route.params.jobTitle) : loadJobTitle(jobId),
      // Who is on this role's panel, which is what decides whether the interview
      // step has to ask how it should be run or can get straight on with it.
      manager ? loadInterviewers(profile.companyId, jobId) : Promise.resolve(null),
      manager ? hasPanelPoll(profile.companyId, candidateId, jobId) : Promise.resolve(false),
    ]);
    if (title) setJobTitle(title);
    if (crew) { setTeam(crew); setRolePanel(crew.filter((m) => m.assigned)); }
    setPolled(!!wasPolled);
    setCandidate(c); setCards(sc); setInterview(iv); setOffer(off); setQuestions(qs || []);
    setMlInput(iv?.meetingLink || "");
    if (meta?.stage) setStage(meta.stage); // true current stage (e.g. from a notification)
    setMatchReason(meta?.reason || null);
    setMatchScore(meta?.score ?? null);
    setApprovals(off?.id && off.approval_status ? await loadOfferApprovals(off.id) : []);
    setLoading(false);
    return meta?.stage || null;   // so a caller can see a stage the DB moved
  }, [candidateId, jobId, profile.companyId, manager]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Realtime: reflect interview changes (booked, rescheduled, meeting link shared)
  // made elsewhere — e.g. on desktop — without needing a manual refresh.
  useEffect(() => {
    if (!profile?.companyId) return undefined;
    return subscribeInterviews(profile.companyId, () => load());
  }, [profile?.companyId, load]);
  // Also react to activity_log / application changes (offer sign or decline,
  // approvals, another panellist's scorecard, stage / mark-hired) made on another
  // device, so this profile doesn't sit stale while focused. Every server action
  // logs activity_log, so this is the universal live signal.
  useEffect(() => {
    if (!profile?.companyId) return undefined;
    return subscribeDashboard(profile.companyId, () => load());
  }, [profile?.companyId, load]);

  // Land on the tab that matters for where the candidate is — always the one
  // that's actionable: scoring once the interview is held and scorecards are
  // open, the interview work while interviewing, the outcome once there's an
  // offer, else their profile. Only auto-picks once (guarded by tabInit) so a
  // manual switch isn't overridden.
  useEffect(() => {
    if (tabInit.current || loading) return;
    tabInit.current = true;
    // Only land on Decision when its tab is actually shown (decisionTabVisible) —
    // e.g. a rejected candidate with no offer + unreleased scorecards has
    // decisionReady true but no Decision tab, which would render a blank screen.
    setTab(
      decisionTabVisible && (!manager ? myCard : decisionReady) ? "decision"
        : (interviewDone && canScore) || stage === "offer" || stage === "hired" ? "feedback"
        : stage === "interviewing" ? "interview"
        : "profile"
    );
  }, [loading, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // After the interviewer submits (their card appears while they're on the
  // Scorecards tab), move them to the new Result tab, matching web. Placed above
  // the loading early-return so hook order stays stable; reads state directly.
  const resultAutoSwitched = useRef(false);
  useEffect(() => {
    const hasMyCard = (cards || []).some((c) => c.interviewerId === profile?.userId);
    if (!manager && hasMyCard && tab === "feedback" && !resultAutoSwitched.current) {
      resultAutoSwitched.current = true;
      setTab("decision");
    }
  }, [cards, manager, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = (t) => {
    if (t === tab) return;
    setTab(t);
    tabAnim.setValue(0);
    Animated.timing(tabAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  };

  // Keep the active tab within view: Decision is the last pill and can sit past
  // the right edge, so reveal it (and snap back to the start for Profile).
  useEffect(() => {
    if (loading || !segScrollRef.current) return;
    if (tab === "decision") segScrollRef.current.scrollToEnd({ animated: true });
    else if (tab === "profile") segScrollRef.current.scrollTo({ x: 0, animated: true });
  }, [tab, loading]);

  const nameOf = () => candidate?.name || candidateName || "Candidate";

  // Move the candidate to a stage, mirroring the web setCandidateStage side
  // effects (activity log on hire, hired/rejected candidate email). Optimistic.
  const applyStage = async (to) => {
    const prev = stage;
    setStage(to);
    try { await moveCandidateStage({ companyId: profile.companyId, candidateId, candidateName: nameOf(), stage: to, jobId }); }
    catch (e) { setStage(prev); dialog.alert({ title: "Could not update", message: e?.message || "Please try again.", icon: "alert-triangle", variant: "danger" }); }
  };

  // Add or remove a teammate on this role's panel, from the candidate you are
  // looking at. Someone who has not accepted their invite has no profile to
  // assign, so the seat is staged on the invitation and applied when they sign
  // up (0138). Either way the stage may move underneath us (0139/0140), so the
  // screen is re-read rather than patched.
  const togglePanelMember = async (m) => {
    if (savingId) return;
    const next = !m.assigned;
    setSavingId(m.id);
    const err = m.inviteId
      ? await stageInviteJob(m.inviteId, jobId, next)
      : next
        ? await assignInterviewer(jobId, m.id)
        : await unassignInterviewer(jobId, m.id);
    setSavingId(null);
    if (err) {
      dialog.alert({ title: "Couldn't update the panel", message: err, icon: "alert-triangle", variant: "danger" });
      return;
    }
    await load();
  };

  // Leaving the picker having added nobody means the panel answer was not really
  // given, so hand the screen back to the question rather than to a panel step
  // with no panel on it.
  const closePicker = () => {
    setPickerOpen(false);
    setInviteNote(null);
    if (!(rolePanel || []).length && ivMode === "panel") setIvMode(null);
  };

  // Invite someone who is not in the workspace yet, and put them on this role in
  // the same breath. inviteTeammate doesn't hand back the invitation id, so the
  // team is re-read and matched by email to find the row to stage; a failure
  // there costs the panel seat, not the invite, and the note says which happened.
  const sendInvite = async () => {
    const em = inviteEmail.trim();
    if (!em || inviting) return;
    Keyboard.dismiss();
    setInviting(true); setInviteNote(null);
    const res = await inviteTeammate({ email: em, role: "interviewer" });
    if (!res.ok) {
      setInviting(false);
      setInviteNote({ ok: false, msg: res.error || "Couldn't send the invite." });
      return;
    }
    let staged = false;
    try {
      const crew = await loadInterviewers(profile.companyId, jobId);
      const row = (crew || []).find((m) => (m.email || "").toLowerCase() === res.email);
      if (row?.inviteId) staged = !(await stageInviteJob(row.inviteId, jobId, true));
      else if (row?.id) staged = !(await assignInterviewer(jobId, row.id)); // already had an account
    } catch { /* the invite still stands */ }
    setInviting(false);
    setInviteEmail("");
    setInviteNote({ ok: true, msg: staged
      ? `Invite sent to ${res.email}. They join this panel when they sign up.`
      : `Invite sent to ${res.email}. Add them to this panel once they sign up.` });
    await load();
  };

  // Take someone off this role's panel. Removing the LAST one is not just a panel
  // edit: with nobody left to interview them, the role's untouched candidates go
  // back to Applied (migration 0139), so that one is confirmed and the whole
  // screen is reloaded afterwards rather than left showing a stale stage.
  const removeFromPanel = async (m) => {
    if (removingId) return;
    const isLast = (rolePanel || []).length <= 1;
    if (isLast) {
      const ok = await dialog.confirm({
        title: `Remove ${m.name}?`,
        message: `Nobody would be left on this panel, so ${nameOf().split(" ")[0]} goes back to Applied until you add someone or interview them yourself.`,
        icon: "user-minus",
        variant: "danger",
        confirmLabel: "Remove",
      });
      if (!ok) return;
    }
    setRemovingId(m.id);
    const err = await unassignInterviewer(jobId, m.id);
    if (err) {
      setRemovingId(null);
      dialog.alert({ title: "Couldn't remove them", message: err, icon: "alert-triangle", variant: "danger" });
      return;
    }
    setRolePanel((prev) => (prev || []).filter((x) => x.id !== m.id));
    setRemovingId(null);
    // The stage may have changed underneath us, so re-read rather than guess.
    const newStage = await load();
    // Taking the last interviewer off sends the candidate back to Applied, which
    // locks this tab. Staying here would leave the reader looking at a tab that
    // no longer applies, so follow them to the one that does.
    if (newStage && newStage !== "interviewing") setTab("profile");
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
    else dialog.alert({ title: "Not available yet", message: "The signed offer PDF isn't ready.", icon: "clock", variant: "warn" });
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
    if (!res.ok) { dialog.alert({ title: "Couldn't share link", message: res.error || "Try again.", icon: "alert-triangle", variant: "danger" }); return; }
    Keyboard.dismiss();
    const who = [res.candidate ? "the candidate" : null, res.panel ? `${res.panel} panel member${res.panel === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ");
    dialog.alert({ title: "Link shared", message: who ? `Sent to ${who} with a calendar invite.` : "Meeting link saved.", icon: "check-circle", variant: "success" });
    setReplacingLink(false);
    load();
  };

  const saveMl = () => persistMl(mlInput.trim());

  // Fill the field with a ready-to-use video room: a real Daily.co room
  // (branded, no account needed to join), falling back to the built-in generator
  // if video isn't configured or the call fails, so the button is never a dead
  // end. This does NOT send — the HM reviews it and taps Share to email it.
  const genMeetingLink = async () => {
    if (genningRoom) return;
    setGenningRoom(true);
    let url = await createVideoRoom(candidateId);
    if (!url) {
      const rand = Math.random().toString(36).slice(2, 10);
      const tag = (candidateId || "iv").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
      url = `https://meet.jit.si/Aster-${tag}-${rand}`;
    }
    setMlInput(url);
    setGenningRoom(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  };

  const resendInvite = async () => {
    if (!interview?.token) return;
    const res = await resendInterviewInvite(interview.token);
    dialog.alert(res.ok
      ? { title: "Email resent", message: "The candidate got the booking link again.", icon: "check-circle", variant: "success" }
      : { title: "Couldn't resend", message: res.error || "Try again.", icon: "alert-triangle", variant: "danger" });
  };

  const genQuestions = async () => {
    setGenQ(true);
    const res = await generateInterviewQuestions({
      companyId: profile.companyId, candidateId, jobId,
      parsed: candidate?.parsed || {}, jobTitle: route.params?.jobTitle,
    });
    setGenQ(false);
    if (!res.ok) { dialog.alert({ title: "Couldn't generate questions", message: res.error || "Try again.", icon: "alert-triangle", variant: "danger" }); return; }
    setQuestions(res.questions);
  };

  const doReschedule = () => {
    setConfirm({
      title: "Reschedule interview?",
      message: `This clears the scheduled time so you can run a fresh availability poll and propose new times to ${nameOf().split(" ")[0]}.`,
      confirmLabel: "Reschedule",
      onConfirm: async () => {
        const res = await rescheduleInterview(profile.companyId, candidateId);
        if (!res.ok) { dialog.alert({ title: "Couldn't reschedule", message: res.error || "Try again.", icon: "alert-triangle", variant: "danger" }); return; }
        setNoShowDismissed(false); load();
      },
    });
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
  // Mobile used to render deriveInsights() — local arithmetic over the parsed CV
  // — unprompted, under an "AI INSIGHT" banner. Web has always required an
  // explicit run, so the two clients disagreed about what an insight even was,
  // and a phone user saw analysis they never asked for and assumed they'd been
  // charged. Mobile now matches web: nothing until the AI actually runs.
  const insights = insightRun || candidate?.experienceInsights || null;

  const generateInsights = async () => {
    if (insightBusy) return;
    setInsightBusy(true);
    setInsightErr(null);
    const res = await runExperienceInsights(candidate);
    setInsightBusy(false);
    if (res.ok) { setInsightRun(res.insights); return; }
    if (res.limitReached) { setInsightCapped(true); return; }
    setInsightErr(res.error);
  };

  // ---- Interview → decision → offer → hired state machine (web sequence) ----
  const scheduledAt = interview?.status === "scheduled" ? interview.scheduledAt : null;
  // The candidate's chosen slot is one of the proposed ranges; recover its end
  // so the confirmed card can show the full window (e.g. 9:00 – 10:00 am).
  const scheduledEnd = scheduledAt
    ? ((interview?.proposedSlots || []).find((s) => s?.start && new Date(s.start).getTime() === new Date(scheduledAt).getTime())?.end || null)
    : null;
  const pendingInvite = interview?.status === "sent" ? interview : null;
  const rescheduling = interview?.status === "reschedule"; // candidate couldn't make the times, suggested their own
  const interviewDone = !!scheduledAt && new Date(scheduledAt).getTime() < Date.now();
  // A hired candidate's interview is in the past by definition, even if the
  // stored time is future. Drives display only (label + hiding the stale video
  // link); the manager action gates keep using interviewDone.
  const interviewOver = interviewDone || stage === "hired";
  // Show the interview flow once the candidate reaches interviewing (or there's
  // already an invite/booking).
  const showInterview = stage === "interviewing" || !!scheduledAt || !!pendingInvite || rescheduling;
  // The HM releases the panel's scorecards by confirming the interview happened.
  // Interviewers can't score until then; the HM (the releaser) scores once the
  // time has passed.
  const scorecardsReleased = !!interview?.scorecardsReleasedAt;
  // Scorecards stay locked for EVERYONE (including the HM) until the HM taps
  // "Proceed to scorecards", which stamps the release. offer/hired keeps them
  // open later in the pipeline.
  const canScore = scorecardsReleased || ["offer", "hired"].includes(stage);
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
  // Panel interview: every required interviewer must score (HM's own optional).
  // SOLO interview (no other interviewers): the HM's own scorecard is the only
  // one, so it's compulsory — the decision waits on at least one card, mirroring
  // the web (soloInterview ? anyScored : allScored). Never opens on zero cards.
  const allRated = requiredRaters.length ? ratedRequired === requiredRaters.length : cards.length > 0;
  const showDecision = manager && stage === "interviewing" && interviewDone && allRated;
  // The Decision tab shows once scoring is open (or an offer exists), but stays
  // LOCKED for the manager until the panel has finished scoring (decisionReady).
  // Interviewers see their own outcome/journey there once they've scored.
  const decisionReady = (interviewDone && allRated) || !!offer || stage === "hired" || stage === "rejected";
  const decisionTabVisible = (!manager && myCard) || (manager && (canScore || !!offer));
  const decisionLocked = manager && !decisionReady; // waiting on the panel
  // Ask how the interview should be run only when nothing has answered it: the
  // hiring manager's view, nothing scheduled, and nobody on the role's panel.
  // panelCount starts null until loaded, so this stays false for a beat rather
  // than flashing the question over a panel that turns out to exist. Adding
  // someone to the role answers it on its own, which is what makes the mobile
  // screen follow the web without having to be told.
  const panelCount = rolePanel === null ? null : rolePanel.length;
  const askIvMode = manager && !interview && panelCount === 0 && ivMode === null;
  // A panel exists but has never been asked for availability. Adding people to a
  // role is the decision to interview with them, so the poll is the next step and
  // the only one offered until it has run.
  const awaitingPanelAvailability = manager && !!panelCount && !polled;

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
        {/* The role, named on the profile itself. Opening this screen from a
            notification gave no clue which position the candidate applied for. */}
        {jobTitle ? (
          <View style={styles.roleRow}>
            <Feather name="briefcase" size={13} color={theme.ink3} />
            <Text style={styles.roleTxt} numberOfLines={1}>{jobTitle}</Text>
          </View>
        ) : null}
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

            {/* Interview page sub-tabs: split the dense stack into Profile /
                Interview / Feedback so only one section shows at a time. */}
            <ScrollView ref={segScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segbar}>
              {[["profile", "Profile"], ["interview", "Interview"], ["feedback", "Scorecards"], ...(decisionTabVisible ? [["decision", "Decision"]] : [])].map(([k, lbl]) => {
                const on = tab === k;
                // The two tabs unlock on different things, and conflating them
                // was wrong: reaching the interview stage only means an
                // interview is being arranged. Scorecard stays shut until one
                // has actually happened (canScore), or the candidate is already
                // past it, so nobody is asked to rate a conversation they
                // haven't had. "Scorecard" over "Feedback" because that is what
                // the tab contains.
                const locked = k === "interview"
                  ? !INTERVIEW_UNLOCKED.includes(stage)
                  : k === "feedback" ? !canScore
                  : k === "decision" ? decisionLocked : false;
                const lockReason = k === "feedback"
                  ? (manager ? `Tap "Proceed to scorecards" on the Interview tab to open this.` : `The scorecard opens once the hiring manager confirms the interview happened.`)
                  : k === "decision" ? `The decision opens once the panel has finished scoring.`
                  : `Move ${nameOf().split(" ")[0]} to interview to open this tab.`;
                return (
                  <Pressable
                    key={k}
                    onPress={() => (locked ? setLockNote(lockReason) : switchTab(k))}
                    style={[styles.segItem, on && styles.segItemOn, locked && { opacity: 0.45 }]}
                    hitSlop={4}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on, disabled: locked }}
                    accessibilityLabel={locked ? `${lbl}, locked. ${lockReason}` : lbl}
                  >
                    {locked ? <Feather name="lock" size={11} color={theme.ink3} style={{ marginRight: 4 }} /> : null}
                    <Text style={[type.smallStrong, { color: on ? "#fff" : theme.ink2 }]}>{lbl}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {lockNote ? (
              /* A tinted notice attached to the tabs it explains. As centred grey
                 text floating between the tab bar and the section heading it read
                 as an error message about the page, not an answer to the tap. */
              <View style={styles.lockNote}>
                <Feather name="lock" size={13} color="#B45309" style={{ marginTop: 1 }} />
                <Text style={[type.small, { color: "#B45309", marginLeft: 8, flex: 1, lineHeight: 18 }]}>{lockNote}</Text>
              </View>
            ) : null}

            <Animated.View style={{ opacity: tabAnim, transform: [{ translateX: tabAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>

            {tab === "profile" ? (<>
            {/* Candidate details — collapsed by default to keep the hiring flow clean */}
            <Pressable onPress={() => setDetailsOpen((o) => !o)} style={styles.exploreToggle}>
              <View style={styles.exploreIcon}><Feather name="file-text" size={16} color={theme.brand} /></View>
              <Text style={[type.bodyStrong, { color: theme.ink, flex: 1, marginLeft: 10 }]}>Candidate details</Text>
              <Feather name={detailsOpen ? "chevron-up" : "chevron-down"} size={20} color={theme.ink3} />
            </Pressable>
            {detailsOpen ? (
              <View>
                {/* AI Insight — resume deep-dive (experience + employment
                    analysis). Open to interviewers too: they prepare for panels
                    and the read is exactly the context they need. Runaway spend
                    isn't the risk it looks like, because the result is stored on
                    the candidate, so a profile can only ever be analysed once —
                    whoever gets there first pays, and everyone else reads it. */}
                <View style={{ marginTop: space(4) }}>
                  {insights ? (
                    <>
                      <View style={styles.aiHead}>
                        <Feather name="zap" size={14} color={theme.brand} />
                        <Text style={[type.label, { color: theme.ink3, marginLeft: 6 }]}>AI INSIGHTS</Text>
                        {insights.generated_at ? (
                          <Text style={[type.small, { color: theme.ink4, marginLeft: "auto" }]}>
                            {new Date(insights.generated_at).toLocaleDateString()}
                          </Text>
                        ) : null}
                      </View>
                      {/* No regenerate: the credit is spent and a resume doesn't
                          change, so the stored read is shown for good. */}
                      <AiInsight insights={insights} />
                    </>
                  ) : (
                    // Same shape as AI Rank on the job screen: icon, name, one
                    // line of consequence, and a pill on the right. The card of
                    // explanatory prose it replaced was heavier than the action.
                    <Card>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <View style={styles.exploreIcon}><Feather name="zap" size={16} color={theme.brand} /></View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[type.bodyStrong, { color: theme.ink }]}>AI Insights</Text>
                        </View>
                        <Pressable
                          onPress={generateInsights}
                          disabled={insightBusy || insightCapped}
                          style={[styles.runBtn, insightCapped && { backgroundColor: theme.ink3 }, insightBusy && { opacity: 0.7 }]}
                          accessibilityRole="button"
                          accessibilityLabel={insightCapped ? "Out of AI insight credits" : "Run AI Insight, uses one credit"}
                        >
                          {insightBusy ? (
                            <ActivityIndicator color={theme.white} size="small" />
                          ) : (
                            <>
                              <Feather name={insightCapped ? "lock" : "zap"} size={14} color={theme.white} />
                              <Text style={[type.smallStrong, { color: theme.white, marginLeft: 6 }]}>Run</Text>
                            </>
                          )}
                        </Pressable>
                      </View>
                      {insightCapped ? (
                        <Text style={[type.small, { color: theme.ink3, marginTop: space(2), lineHeight: 18 }]}>
                          {manager
                            ? "Top up from Billing on the Aster web app."
                            : "Ask your hiring manager to top up."}
                        </Text>
                      ) : null}
                      {insightErr ? (
                        <View style={styles.insightErr}>
                          <Feather name="alert-circle" size={13} color={theme.danger} />
                          <Text style={[type.small, { color: theme.danger, marginLeft: 6, flex: 1 }]}>{insightErr}</Text>
                        </View>
                      ) : null}
                    </Card>
                  )}
                </View>

                {(() => {
                  const email = parsed.email || candidate?.email;
                  const rows = [
                    parsed.location && { icon: "map-pin", value: parsed.location },
                    parsed.years_of_experience != null && { icon: "briefcase", value: `${parsed.years_of_experience} years of experience` },
                    parsed.salary_expectation && { icon: "dollar-sign", value: String(parsed.salary_expectation) },
                    email && { icon: "mail", value: email, onPress: () => Linking.openURL(`mailto:${email}`) },
                    parsed.phone && { icon: "phone", value: parsed.phone, onPress: () => Linking.openURL(`tel:${parsed.phone}`), whatsapp: waNumber(parsed.phone) },
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
                  {/* "Shortlist" used to be the only action offered on an applied
                      candidate, so reaching an interview took two taps through a
                      stage that carries no meaning of its own. Move to interview
                      directly; starring is a bookmark on the applicants list. */}
                  <Button title="Move to interview" icon="calendar" onPress={() => moveTo("interviewing")} />
                </View>
              ) : null}
            </Card>
          </View>
          {/* Reject the candidate — lives on the Profile tab only. */}
          {manager && stage !== "rejected" && stage !== "hired" && stage !== "declined" ? (
            <Pressable onPress={reject} style={{ alignSelf: "center", marginTop: space(7), padding: 8 }}>
              <Text style={[type.smallStrong, { color: theme.danger }]}>Reject candidate</Text>
            </Pressable>
          ) : null}
          </>) : null}

          {/* Offer status lives under the Decision tab (manager view). */}
          {tab === "decision" && manager && offer ? (
            <View style={{ marginTop: space(5) }}>
              <SectionHeader>Offer</SectionHeader>
              <OfferCard offer={offer} approvals={approvals} onViewSigned={viewSigned} canHire={manager && stage !== "hired"} onHire={() => moveTo("hired")} onResend={() => setOfferOpen(true)} onReject={reject} />
            </View>
          ) : null}

          {tab === "interview" ? (<>
          {/* Did the interview happen? — leads the Interview tab once the time has
              passed. Proceed to scorecards dismisses it; Reschedule runs the flow. */}
          {interviewDone && manager && !noShowDismissed && !scorecardsReleased ? (
            <View style={styles.ivHappenCard}>
              <View style={styles.ivHappenHead}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={styles.ivHappenChip}>
                    <View style={styles.ivHappenDot} />
                    <Text style={styles.ivHappenChipTxt}>INTERVIEW TIME PASSED</Text>
                  </View>
                  {scheduledAt ? <Text style={[type.small, { color: theme.ink3, marginLeft: 9 }]}>{fmtInterviewTime(scheduledAt, profile?.timezone)}</Text> : null}
                </View>
                <Text style={[type.bodyStrong, { color: theme.ink, marginTop: 11, fontSize: 17, letterSpacing: -0.2 }]}>Did the interview happen?</Text>
                <Text style={[type.small, { color: theme.ink2, marginTop: 5, lineHeight: 20 }]}>Confirming opens the panel's scorecards. If it was a no-show or needs another time, reschedule instead.</Text>
              </View>
              <View style={styles.ivHappenBody}>
                <Pressable onPress={() => { if (interview?.id) releaseScorecards(interview.id); setInterview((iv) => (iv ? { ...iv, scorecardsReleasedAt: new Date().toISOString() } : iv)); setNoShowDismissed(true); }} style={styles.ivHappenPrimary}>
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={[type.smallStrong, { color: "#fff", marginLeft: 7 }]}>Proceed to scorecards</Text>
                </Pressable>
                <Pressable onPress={doReschedule} style={styles.ivHappenGhost}>
                  <Feather name="refresh-cw" size={14} color={theme.ink3} />
                  <Text style={[type.small, { color: theme.ink3, marginLeft: 7, fontFamily: "Inter_600SemiBold" }]}>No-show or reschedule</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Interviewer's post-interview nudge. The manager gets the card above;
              without this, an interviewer had no signal that the interview had
              passed and it was their turn to score. Leads straight to the form. */}
          {interviewDone && !manager ? (
            canScore ? (
            <View style={styles.ivDoneCard}>
              <LinearGradient colors={["#ECFDF5", theme.card]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ivHappenHead}>
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                  <View style={styles.ivDoneMedallion}><Feather name={myCard ? "check-circle" : "check"} size={18} color="#fff" /></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                      <View style={styles.ivDoneChip}>
                        <Feather name="check" size={10} color="#047857" />
                        <Text style={styles.ivDoneChipTxt}>INTERVIEW COMPLETE</Text>
                      </View>
                      {scheduledAt ? <Text style={[type.small, { color: theme.ink3, marginLeft: 8 }]}>{fmtInterviewTime(scheduledAt, profile?.timezone)}</Text> : null}
                    </View>
                    <Text style={[type.bodyStrong, { color: theme.ink, marginTop: 7, fontSize: 17 }]}>{myCard ? `You've scored ${name.split(" ")[0]}` : `You've interviewed ${name.split(" ")[0]}`}</Text>
                    <Text style={[type.small, { color: theme.ink2, marginTop: 3, lineHeight: 18 }]}>{myCard ? "Your scorecard is in. You can still edit it until the hiring manager decides." : (manager && decisionReady) ? "The panel has finished scoring." : "Add your scorecard so the hiring manager can make the call."}</Text>
                  </View>
                </View>
              </LinearGradient>
              <View style={styles.ivHappenBody}>
                <Pressable onPress={() => switchTab("feedback")} style={styles.ivHappenPrimary}>
                  <Feather name={(myCard || (manager && decisionReady)) ? "eye" : "plus"} size={16} color="#fff" />
                  <Text style={[type.smallStrong, { color: "#fff", marginLeft: 7 }]}>{(myCard || (manager && decisionReady)) ? "View scorecards" : "Add my scorecard"}</Text>
                </Pressable>
              </View>
            </View>
            ) : (
            <View style={styles.ivWaitCard}>
              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={styles.ivWaitMedallion}><Feather name="clock" size={18} color="#B45309" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                    <View style={styles.ivWaitChip}>
                      <Feather name="check" size={10} color="#B45309" />
                      <Text style={styles.ivWaitChipTxt}>INTERVIEW COMPLETE</Text>
                    </View>
                    {scheduledAt ? <Text style={[type.small, { color: theme.ink3, marginLeft: 8 }]}>{fmtInterviewTime(scheduledAt, profile?.timezone)}</Text> : null}
                  </View>
                  <Text style={[type.bodyStrong, { color: theme.ink, marginTop: 7, fontSize: 17 }]}>You've interviewed {name.split(" ")[0]}</Text>
                  <Text style={[type.small, { color: theme.ink2, marginTop: 3, lineHeight: 18 }]}>The hiring manager is confirming the interview. Your scorecard opens as soon as they do.</Text>
                </View>
              </View>
            </View>
            )
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
                      <Text style={[type.bodyStrong, { color: theme.ink }]}>{interviewOver ? "Interview held" : "Interview confirmed"}</Text>
                      <Text style={[type.small, { color: theme.ink2, marginTop: 1 }]}>{fmtInterviewRange(scheduledAt, scheduledEnd, profile.timezone)}</Text>
                    </View>
                  </View>
                  {/* Meeting link appears once the candidate has accepted. Generate a
                      room or paste one — nothing sends until the HM taps Share.
                      Hidden once the interview has passed (or the candidate is
                      hired): nothing left to join. */}
                  {!interviewOver && (
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
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
                              <Feather name="check-circle" size={13} color={theme.success} />
                              <Text style={[type.small, { color: theme.success, marginLeft: 6 }]} numberOfLines={1}>Shared with candidate & panel</Text>
                            </View>
                            {!replacingLink ? (
                              <Pressable onPress={() => { setMlInput(""); setReplacingLink(true); }} hitSlop={8} style={{ marginLeft: 10 }}>
                                <Text style={[type.smallStrong, { color: theme.brand }]}>Replace</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                      </>
                    ) : (
                      <Text style={[type.small, { color: theme.ink4, marginBottom: 8 }]}>
                        {manager ? "Generate a room or paste your own. Nothing is sent until you tap Share." : "The hiring manager will add the meeting link before the interview."}
                      </Text>
                    )}
                    {/* Edit controls: only for the HM, and (once a link is shared) only
                        after they tap Replace — so the shared state stays uncluttered. */}
                    {manager && (!interview?.meetingLink || replacingLink) ? (
                      <View style={{ marginTop: interview?.meetingLink ? 12 : 0 }}>
                        {/* Fill-only: generates a ready-to-use video link into
                            the field, doesn't send. The HM reviews it, then Shares. */}
                        <Pressable onPress={genMeetingLink} disabled={genningRoom} style={[styles.mlGen, genningRoom && { opacity: 0.5 }]}>
                          <Feather name="video" size={15} color={theme.brand} />
                          <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 8 }]}>{genningRoom ? "Creating…" : "Create a video room"}</Text>
                        </Pressable>
                        {/* Share sits below, not beside. Sharing a row with the
                            field left too little width for a URL: the
                            placeholder truncated mid-sentence and a pasted link
                            showed only its first few characters. */}
                        <TextInput
                          value={mlInput} onChangeText={setMlInput}
                          placeholder="or paste a Meet, Zoom or Teams link" placeholderTextColor={theme.ink4}
                          autoCapitalize="none" keyboardType="url"
                          onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
                          style={styles.mlInput}
                        />
                        <Pressable
                          onPress={saveMl}
                          disabled={mlSaving || !mlInput.trim()}
                          style={[styles.mlSave, { marginTop: 8 }, (mlSaving || !mlInput.trim()) && { opacity: 0.5 }]}
                        >
                          {mlSaving ? <ActivityIndicator size="small" color={theme.white} /> : <Text style={[type.smallStrong, { color: theme.white }]}>Share with candidate and panel</Text>}
                        </Pressable>
                        {interview?.meetingLink ? (
                          <Pressable onPress={() => { setReplacingLink(false); setMlInput(""); Keyboard.dismiss(); }} hitSlop={6} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                            <Text style={[type.small, { color: theme.ink3 }]}>Cancel</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  )}
                </>
              ) : rescheduling ? (
                interview?.proposedSlots?.length ? (
                  /* Round 2: candidate suggested their own times → panel votes, HM confirms */
                  <>
                    {/* Eyebrow instead of a boxed icon beside a paragraph: the icon
                        used to sit centred against three lines of text, floating in
                        its own dead space. Inline, it reads as one label. */}
                    <View style={styles.propBand}>
                      <Feather name="refresh-cw" size={13} color="#7C2D12" />
                      <Text style={styles.propBandTxt}>CANDIDATE PROPOSED</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={styles.propBandCount}>
                        {interview.proposedSlots.length} option{interview.proposedSlots.length === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <Text style={styles.propTitle}>
                      {nameOf().split(" ")[0]} suggested {interview.proposedSlots.length} new time{interview.proposedSlots.length === 1 ? "" : "s"}
                    </Text>
                    <Text style={styles.propSub}>The panel votes on these, then you confirm.</Text>

                    {interview?.rescheduleNote ? (
                      /* Their words as a pull-quote against an accent rule, not a
                         grey slab: this is the reason, not boilerplate. */
                      <View style={styles.propQuote}>
                        <Text style={styles.propQuoteTxt}>&ldquo;{interview.rescheduleNote}&rdquo;</Text>
                      </View>
                    ) : null}

                    {/* Ballot cards, side by side and numbered, so the options read
                        as things to choose between. As plain rows with a tiny
                        calendar glyph they looked like fine print. */}
                    <View style={styles.propSlots}>
                      {interview.proposedSlots.slice(0, 2).map((s, i) => (
                        <View key={i} style={styles.propSlot}>
                          <View style={styles.propSlotNum}><Text style={styles.propSlotNumTxt}>{i + 1}</Text></View>
                          <Text style={styles.propSlotDay} numberOfLines={1}>{slotDayLabel(s.start)}</Text>
                          <Text style={styles.propSlotTime} numberOfLines={1}>{_hm(s.start)}{_ap(s.start) !== _ap(s.end || s.start) ? ` ${_ap(s.start)}` : ""}</Text>
                          <Text style={styles.propSlotEnd} numberOfLines={1}>to {_hm(s.end || s.start)} {_ap(s.end || s.start)}</Text>
                        </View>
                      ))}
                    </View>
                    {interview.proposedSlots.length > 2 ? (
                      <Text style={styles.propMore}>+{interview.proposedSlots.length - 2} more in the panel chat</Text>
                    ) : null}

                    <Button title="Vote & confirm" icon="users" onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} style={{ marginTop: space(4) }} />
                  </>
                ) : (
                  /* HM-initiated reschedule (e.g. no-show): run a fresh poll */
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={styles.ivIcon}><Feather name="refresh-cw" size={17} color={theme.warn} /></View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[type.bodyStrong, { color: theme.ink }]}>{manager ? "Rescheduling" : `${nameOf().split(" ")[0]} asked to reschedule`}</Text>
                        <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>
                          {manager
                            ? `${interview?.previousAt ? `The original was ${fmtInterviewTime(interview.previousAt, profile?.timezone)}. ` : ""}Run a fresh panel availability poll, then propose new times.`
                            : "The hiring manager is arranging new times. You'll be notified once it's booked."}
                        </Text>
                      </View>
                    </View>
                    {/* Step 1 is the primary button and step 2 is subordinate. It
                        used to be the other way round: "1 · Vote" was a pale tint and
                        "2 · Propose times" was solid blue, so the strongest thing on
                        the card was the step you are meant to do second, and people
                        tapped it first. */}
                    <Button title={manager ? "1 · Panel availability" : "Panel availability"} icon="users" onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} style={{ marginTop: space(3) }} />
                    {manager ? (
                      <>
                        <Button title="2 · Propose times to candidate" icon="calendar" variant="ghost" onPress={() => setProposeOpen(true)} style={{ marginTop: space(2.5) }} />
                        <Text style={styles.stepHint}>Vote first, so the times you send are ones the panel can actually make.</Text>
                      </>
                    ) : null}
                  </>
                )
              ) : pendingInvite ? (
                <>
                  {/* A handoff, drawn as one. Three steps show the ball is in the
                      candidate's court; matches the same card on web. */}
                  <View style={styles.track}>
                    {[
                      // Same wording as web. "They" was ambiguous on a screen
                      // that also talks about the panel; "Sent" stays short
                      // because three full labels won't fit a phone width.
                      { label: "Sent", state: "done" },
                      { label: "Candidate picks", state: "now" },
                      { label: "Confirmed", state: "todo" },
                    ].map((s, i, arr) => (
                      <React.Fragment key={s.label}>
                        <View style={{ alignItems: "center" }}>
                          <View style={[styles.trackDot, {
                            backgroundColor: s.state === "done" ? theme.success : s.state === "now" ? theme.brand : theme.line,
                          }]} />
                          <Text style={[styles.trackTxt, {
                            color: s.state === "done" ? theme.success : s.state === "now" ? theme.brand : theme.ink4,
                          }]}>{s.label}</Text>
                        </View>
                        {i < arr.length - 1 ? <View style={styles.trackLine} /> : null}
                      </React.Fragment>
                    ))}
                  </View>

                  <Text style={[type.bodyStrong, { color: theme.ink, marginTop: space(3) }]}>
                    Waiting for {nameOf().split(" ")[0]} to pick one of these
                  </Text>

                  {/* One option per row, numbered. A two-column grid wrapped
                      2-then-1 and left the third orphaned on its own line, and
                      with three near-identical dates the eye had nothing to
                      anchor to. */}
                  <View style={{ marginTop: space(3) }}>
                    {pendingInvite.proposedSlots.map((s, i) => (
                      <View key={i} style={[styles.slotTile, i > 0 && { marginTop: 8 }]}>
                        <View style={styles.slotTileNum}><Text style={styles.slotTileNumTxt}>{i + 1}</Text></View>
                        <View style={{ flex: 1, marginLeft: 11 }}>
                          <Text style={styles.slotTileDay} numberOfLines={1}>{slotDayLabel(s.start)}</Text>
                          <Text style={styles.slotTileTime} numberOfLines={1}>{slotRange(s.start, s.end).split("·").slice(-1)[0].trim()}</Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  {manager ? <Button title="Resend invite" icon="mail" variant="ghost" onPress={resendInvite} style={{ marginTop: space(3) }} /> : null}
                </>
              ) : askIvMode ? (
                /* Same question the web asks, for the same reason: moving someone
                   to Interview says nothing about who is actually interviewing
                   them, and the two answers lead to completely different steps.
                   Only asked when the role has nobody on its panel, because a
                   panel that already exists has answered it. */
                <>
                  <Text style={[type.small, { color: theme.ink3 }]}>This decides how the times get picked. You can change the panel later.</Text>
                  <Press haptic="light" onPress={() => setIvMode("solo")} style={{ marginTop: space(3) }}>
                    <View style={styles.ivPick}>
                      <View style={styles.ivPickIcon}><Feather name="user" size={17} color={theme.brand} /></View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[type.bodyStrong, { color: theme.ink }]}>Just me</Text>
                        <Text style={[type.small, { color: theme.ink2, marginTop: 2, lineHeight: 18 }]}>Pick a few times and send them straight to {nameOf().split(" ")[0]}.</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={theme.ink4} />
                    </View>
                  </Press>
                  <Press haptic="light" onPress={() => { setIvMode("panel"); setPickerOpen(true); }} style={{ marginTop: space(2.5) }}>
                    <View style={styles.ivPick}>
                      <View style={styles.ivPickIcon}><Feather name="users" size={17} color={theme.brand} /></View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[type.bodyStrong, { color: theme.ink }]}>Me and a panel</Text>
                        <Text style={[type.small, { color: theme.ink2, marginTop: 2, lineHeight: 18 }]}>Add the interviewers, then collect everyone's availability before offering times.</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={theme.ink4} />
                    </View>
                  </Press>
                </>
              ) : ivMode === "solo" && !panelCount ? (
                /* Interviewing alone: there is no panel to poll, so the
                   availability step would be a round trip to nobody. */
                <>
                  <Text style={[type.small, { color: theme.ink3 }]}>Pick a few times and send them to {nameOf().split(" ")[0]} to choose from.</Text>
                  <Button title="Propose times to candidate" icon="calendar" onPress={() => setProposeOpen(true)} style={{ marginTop: space(3) }} />
                  <Press haptic="light" onPress={() => setIvMode(null)} style={{ marginTop: space(2.5), alignSelf: "center", padding: 6 }}>
                    <Text style={[type.smallStrong, { color: theme.brand }]}>Change</Text>
                  </Press>
                </>
              ) : (
                <>
                  {/* Two different jobs read this card. The manager collects the
                      availability and proposes the times; the interviewer only
                      supplies their own. One instruction can't serve both. */}
                  {/* No blurb while the panel is being assembled: the chips below
                      already say who is on it, and the only button says what to
                      do next. */}
                  {!manager || !awaitingPanelAvailability ? (
                    <Text style={[type.small, { color: theme.ink3 }]}>
                      {manager
                        ? "Get the panel's availability, then propose a few times for the candidate to choose from."
                        : "Mark the times you can make so the panel can find an overlap."}
                    </Text>
                  ) : null}
                  {/* Who is actually on this panel. Without it the step said "get
                      the panel's availability" with no way to tell whose, or even
                      that anyone had been added. */}
                  {rolePanel && rolePanel.length ? (
                    <>
                    <Text style={[type.label, { color: theme.ink3, marginTop: space(3) }]}>INTERVIEWERS</Text>
                    <View style={styles.panelChips}>
                      {rolePanel.map((m) => (
                        <View key={m.id} style={styles.panelChip}>
                          <Avatar name={m.name} size={20} />
                          <Text style={[type.small, { color: theme.ink2, marginLeft: 7, maxWidth: 150 }]} numberOfLines={1}>{m.name}</Text>
                          {manager ? (
                            <Press
                              haptic="light"
                              disabled={removingId === m.id}
                              onPress={() => removeFromPanel(m)}
                              hitSlop={10}
                              accessibilityLabel={`Remove ${m.name} from this panel`}
                              style={styles.panelChipX}
                            >
                              {removingId === m.id
                                ? <ActivityIndicator size="small" color={theme.ink3} />
                                : <Feather name="x" size={13} color={theme.ink3} />}
                            </Press>
                          ) : null}
                        </View>
                      ))}
                      {manager ? (
                        <Press haptic="light" onPress={() => setPickerOpen(true)} accessibilityLabel="Add an interviewer to this panel" style={styles.panelAdd}>
                          <Feather name="user-plus" size={15} color={theme.brand} />
                        </Press>
                      ) : null}
                    </View>
                    </>
                  ) : null}
                  {/* Same ordering fix as the reschedule branch above: the step you
                      do first is the one that looks primary. */}
                  <Button title={!manager || awaitingPanelAvailability ? "Panel availability" : "1 · Panel availability"} icon="users" onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} style={{ marginTop: space(3) }} />
                  {/* Staffing a panel is the decision to interview with one, so
                      offering "propose times" alongside it invites skipping the
                      very people just added, and the poll then has nothing to
                      change. It comes back once availability has been collected. */}
                  {manager && !awaitingPanelAvailability ? (
                    <>
                      <Button title="2 · Propose times to candidate" icon="calendar" variant="ghost" onPress={() => setProposeOpen(true)} style={{ marginTop: space(2.5) }} />
                      <Text style={styles.stepHint}>Vote first, so the times you send are ones the panel can actually make.</Text>
                    </>
                  ) : null}
                </>
              )}
            </Card>
          </View>
          ) : null}

          {/* AI interview questions — tailored to the candidate + role, once the
              interview is confirmed. Anyone on the panel can generate; the set is
              shared, so the first to do it pays and everyone reads the same one.
              Replacing it stays with the hiring manager on web. */}
          {scheduledAt ? (
            <View style={{ marginTop: space(5) }}>
              <View style={styles.aiHead}>
                <Feather name="zap" size={14} color={theme.brand} />
                <Text style={[type.label, { color: theme.ink3, marginLeft: 6 }]}>AI INTERVIEW QUESTIONS</Text>
              </View>
              {questions.length ? (
                <>
                  <AiQuestions questions={questions} />
                  {/* A first pass can miss the mark and there was no way to ask
                      for a better one. Replaces the set for the whole panel and
                      costs a credit, so it confirms first. */}
                  <Press
                    onPress={async () => {
                      const ok = await dialog.confirm({
                        title: "Generate a new set?",
                        message: "This replaces the current questions for the whole panel and uses one credit.",
                        icon: "refresh-cw",
                        confirmLabel: "Regenerate",
                      });
                      if (ok) genQuestions();
                    }}
                    disabled={genQ}
                    haptic="light"
                    style={{ marginTop: space(3) }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10 }}>
                      <Feather name="refresh-cw" size={14} color={theme.brand} />
                      <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 7 }]}>{genQ ? "Regenerating…" : "Regenerate questions"}</Text>
                    </View>
                  </Press>
                </>
              ) : (
                // Open to interviewers too: they are the ones walking into the
                // room. Questions are stored per candidate+role, so the first
                // person to generate pays and the whole panel reads the same
                // set. Waiting on the hiring manager only meant turning up
                // unprepared when they hadn't got to it.
                <Card>
                  <Button title={genQ ? "Generating…" : "Generate questions"} icon={genQ ? undefined : "zap"} onPress={genQuestions} disabled={genQ} />
                </Card>
              )}
            </View>
          ) : null}

          {/* Interview tab empty: candidate isn't at the interview stage yet. */}
          {!showInterview && !(interviewDone && manager && !noShowDismissed) ? (
            <Card style={{ marginTop: space(5) }}><Text style={[type.small, { color: theme.ink3 }]}>Move the candidate to the interview stage to get the panel's availability and propose times.</Text></Card>
          ) : null}
          </>) : null}

          {/* Manager Decision tab: make an offer / not a fit / waiting on panel. */}
          {tab === "decision" && manager ? (<>
          {showDecision ? (
            <View style={{ marginTop: space(5) }}>
              <SectionHeader>Decision</SectionHeader>
              <Pressable onPress={() => setOfferOpen(true)} style={styles.decisionOffer}>
                <View style={styles.decisionOfferIcon}><Feather name="file-text" size={20} color="#fff" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[type.bodyStrong, { color: theme.ink, fontSize: 15 }]}>Make an offer</Text>
                  <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>Send {name.split(" ")[0]} an offer to hire.</Text>
                </View>
                <Feather name="arrow-up-right" size={18} color={theme.brand} />
              </Pressable>
              <Pressable onPress={reject} style={styles.decisionReject}>
                <View style={styles.decisionRejectIcon}><Feather name="x" size={20} color="#DC2626" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[type.bodyStrong, { color: theme.ink, fontSize: 15 }]}>Not a fit</Text>
                  <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>Reject and close out.</Text>
                </View>
              </Pressable>
            </View>
          ) : (manager && stage === "interviewing" && interviewDone && requiredRaters.length > 0 && !allRated) ? (
            <View style={{ marginTop: space(5) }}>
              <SectionHeader>Decision</SectionHeader>
              <View style={styles.dlCard}>
                <LinearGradient colors={["#FFFBEB", theme.card]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dlHead}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {/* Progress ring: scored / total, at a glance. */}
                    <View style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center" }}>
                      <Svg width={56} height={56} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
                        <Circle cx={28} cy={28} r={24} stroke={theme.line} strokeWidth={4} fill="none" />
                        <Circle cx={28} cy={28} r={24} stroke="#F59E0B" strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={`${(ratedRequired / Math.max(1, requiredRaters.length)) * 150.8} 150.8`} />
                      </Svg>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: theme.ink, fontVariant: ["tabular-nums"] }}>{ratedRequired}/{requiredRaters.length}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <View style={styles.dlChip}>
                        <Feather name="lock" size={10} color="#92400E" />
                        <Text style={styles.dlChipTxt}>DECISION LOCKED</Text>
                      </View>
                      <Text style={[type.bodyStrong, { color: theme.ink, marginTop: 5, fontSize: 16 }]}>Waiting on {requiredRaters.length - ratedRequired} of {requiredRaters.length} to score</Text>
                      <Text style={[type.small, { color: theme.ink3, marginTop: 3, lineHeight: 18 }]}>Every interviewer submits their scorecard before you decide. Your own is optional.</Text>
                    </View>
                  </View>
                </LinearGradient>
                <View style={styles.dlRoster}>
                  {requiredRaters.map((p) => {
                    const done = ratedIds.has(p.id);
                    return (
                      <View key={p.id} style={[styles.dlRow, { borderColor: done ? "#A7F3D0" : theme.line, backgroundColor: done ? "#F0FDF4" : theme.card }]}>
                        <Avatar name={p.name || "Interviewer"} size={32} />
                        <Text style={[type.smallStrong, { color: theme.ink, flex: 1, marginLeft: 10 }]} numberOfLines={1}>{p.name || "Interviewer"}</Text>
                        <View style={[styles.dlStatus, { backgroundColor: done ? "#16A34A" : "#FEF3C7" }]}>
                          <Feather name={done ? "check" : "clock"} size={10} color={done ? "#fff" : "#92400E"} />
                          <Text style={[type.small, { marginLeft: 4, fontFamily: "Inter_600SemiBold", color: done ? "#fff" : "#92400E" }]}>{done ? "Scored" : "Pending"}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          ) : null}
          </>) : null}

          {tab === "feedback" ? (<>
          {/* Panel feedback — scorecards open once an interview exists (web sequence) */}
          {(canScore || cards.length > 0) ? (
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>{requiredRaters.length ? `Panel feedback · ${ratedRequired}/${requiredRaters.length}` : "Panel feedback"}</SectionHeader>
            {cards.length === 0 ? (
              canScore && !(manager && decisionReady) ? (
                <LinearGradient colors={[theme.brandSoft, theme.card]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.scoreEmpty}>
                  <Text style={[type.bodyStrong, { color: theme.ink, fontSize: 18, textAlign: "center" }]}>Add your scorecard</Text>
                  <View style={styles.scoreChips}>
                    {["Technical skills", "Communication", "Culture fit", "Experience"].map((c) => (
                      <View key={c} style={styles.scoreChip}><Text style={styles.scoreChipTxt}>{c}</Text></View>
                    ))}
                  </View>
                  <Button title="Start scoring" icon="plus" onPress={() => navigation.navigate("Scorecard", { candidateId, jobId, candidateName: name, existing: myCard })} style={{ marginTop: space(4), alignSelf: "stretch" }} />
                </LinearGradient>
              ) : (
                <Card><Text style={[type.small, { color: theme.ink3 }]}>No scorecards yet. Each interviewer's rating collects here once they submit.</Text></Card>
              )
            ) : (
              <>
                {cards.map((c) => (
                  <ScorecardCard
                    key={c.id}
                    card={c}
                    mine={c.interviewerId === profile.userId}
                  />
                ))}
                {canScore && !myCard && !(manager && decisionReady) ? (
                  <Button title="Add my scorecard" icon="plus" variant="secondary" onPress={() => navigation.navigate("Scorecard", { candidateId, jobId, candidateName: name, existing: null })} style={{ marginTop: space(3) }} />
                ) : null}
              </>
            )}
          </View>
          ) : null}


          {/* Feedback tab empty: nothing to score or decide yet. */}
          {!offer && !showDecision && !(manager && stage === "interviewing" && interviewDone && requiredRaters.length > 0 && !allRated) && !(canScore || cards.length > 0) ? (
            <Card style={{ marginTop: space(5) }}><Text style={[type.small, { color: theme.ink3 }]}>Scorecards and the hiring decision appear here once the interview has happened.</Text></Card>
          ) : null}

          </>) : null}

          {tab === "decision" && !manager ? (() => {
            const first = name.split(" ")[0];
            const decided = stage === "hired" || stage === "rejected";
            const offered = !!offer || stage === "offer" || decided;
            // Reflect the candidate's actual response, not just "offer sent".
            const offerSigned = offer && (offer.status === "accepted" || offer.esign_status === "completed");
            const offerDeclined = offer && offer.status === "declined";
            const hero = stage === "hired"
              ? { icon: "award", label: "Hired", title: `${first} was hired`, sub: "The hiring decision is made and the process is complete. Thanks for your part in it.", tone: "green" }
              : stage === "rejected"
                ? { icon: "x-circle", label: "Closed", title: "Not moving forward", sub: `The team decided not to progress ${first}. Thanks for scoring.`, tone: "red" }
                : offerSigned
                  ? { icon: "check-circle", label: "Signed", title: "Offer signed", sub: `${first} signed the offer. The hiring manager will finalise the hire.`, tone: "green" }
                  : offerDeclined
                    ? { icon: "x-circle", label: "Declined", title: "Offer declined", sub: `${first} declined the offer. The hiring manager will decide the next step.`, tone: "red" }
                    : offered
                      ? { icon: "send", label: "Offer out", title: "Offer sent", sub: `The hiring manager has sent ${first} an offer, and is now awaiting their response.`, tone: "brand" }
                      : { icon: "check-circle", label: "With hiring manager", title: "Your scores are in", sub: "The hiring manager now reviews the panel's scorecards and makes the call. You'll be notified of the outcome.", tone: "brand" };
            const tone = { green: { solid: theme.success, soft: "#ECFDF5", bd: "#A7F3D0" }, red: { solid: theme.danger, soft: "#FEF2F2", bd: "#FECACA" }, brand: { solid: theme.brand, soft: theme.brandSoft, bd: "#CBD8F5" } }[hero.tone];
            const hired = stage === "hired";
            const steps = [
              { label: "Interview held", meta: interviewDone && scheduledAt ? fmtInterviewTime(scheduledAt, profile?.timezone) : null, state: "done" },
              { label: "You submitted your scorecard", state: "done" },
              { label: "Hiring Manager Review", state: offered ? "done" : "current" },
            ];
            if (stage === "rejected") steps.push({ label: "Not moving forward", state: "done" });
            else if (offerDeclined) steps.push({ label: "Offer declined", state: "done" });
            else if (hired || offerSigned) {
              // Candidate signed, then a separate step for the HM to close it out.
              steps.push({ label: "Offer signed", state: "done" });
              steps.push({ label: hired ? "Hired" : "Finalising the hire", state: hired ? "done" : "current", note: hired ? null : "Waiting on the hiring manager to mark them hired" });
            } else if (offered) steps.push({ label: "Offer sent", state: "current" });
            else steps.push({ label: "Final outcome", state: "todo" });
            return (
              <View style={[styles.resultCard, { marginTop: space(5) }]}>
                <View style={[styles.resultHead, { backgroundColor: tone.soft }]}>
                  <View style={[styles.resultMedallion, { backgroundColor: tone.solid }]}><Feather name={hero.icon} size={20} color="#fff" /></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[type.bodyStrong, { color: theme.ink, fontSize: 16 }]}>{hero.title}</Text>
                    <View style={[styles.resultChip, { borderColor: tone.solid + "55", marginLeft: 0, alignSelf: "flex-start", marginTop: 5 }]}><Text style={[styles.resultChipTxt, { color: tone.solid }]}>{hero.label.toUpperCase()}</Text></View>
                  </View>
                </View>
                <View style={{ padding: space(4) }}>
                  <Text style={[type.small, { color: theme.ink3, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, marginBottom: space(3) }]}>WHERE THINGS STAND</Text>
                  {steps.map((s, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <View style={{ alignItems: "center", width: 28 }}>
                        <View style={[styles.stepDot, s.state === "done" ? { backgroundColor: theme.success } : s.state === "current" ? { backgroundColor: tone.soft, borderWidth: 2, borderColor: tone.solid } : { backgroundColor: theme.bg, borderWidth: 2, borderColor: theme.line }]}>
                          {s.state === "done" ? <Feather name="check" size={13} color="#fff" /> : s.state === "current" ? <PulseDot color={tone.solid} /> : null}
                        </View>
                        {i < steps.length - 1 ? <View style={{ width: 2, height: 26, backgroundColor: s.state === "done" ? theme.success : theme.line, marginTop: 2 }} /> : null}
                      </View>
                      <View style={{ flex: 1, marginLeft: 12, paddingTop: 3, paddingBottom: i < steps.length - 1 ? space(1) : 0 }}>
                        <Text style={[type.smallStrong, { color: s.state === "todo" ? theme.ink3 : theme.ink }]}>{s.label}</Text>
                        {s.meta ? <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>{s.meta}</Text> : null}
                        {s.state === "current" ? <Text style={[type.small, { color: tone.solid, marginTop: 1, fontFamily: "Inter_600SemiBold" }]}>{s.note || "In progress"}</Text> : null}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            );
          })() : null}

          </Animated.View>
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

      {/* Add an interviewer without leaving the candidate. Same picker as the
          role screen, because the panel is the role's either way. */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={closePicker}>
        <View style={styles.pickBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={closePicker} />
          <View style={[styles.pickSheet, { paddingBottom: Math.max(insets.bottom, space(4)) }]}>
            <View style={styles.pickHandle} />
            <View style={styles.pickHead}>
              <Text style={[type.h3, { color: theme.ink }]}>Interviewers</Text>
              <Pressable onPress={closePicker} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
            </View>
            <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>Tap a teammate to add or remove them from this role.</Text>
            {team.length === 0 ? (
              <Text style={[type.small, { color: theme.ink3, paddingVertical: space(5), textAlign: "center" }]}>
                Nobody has the interviewer role yet. Invite one below and they land on this panel.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {team.map((m) => (
                  <Pressable key={m.id} onPress={() => togglePanelMember(m)} disabled={!!savingId} style={styles.pickRow}>
                    <Avatar name={m.name} size={38} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text style={[type.bodyStrong, { color: theme.ink, flexShrink: 1 }]} numberOfLines={1}>{m.name}</Text>
                        {m.pending ? <View style={styles.pickPending}><Text style={styles.pickPendingTxt}>INVITE SENT</Text></View> : null}
                      </View>
                      {m.email && m.email !== m.name ? <Text style={[type.small, { color: theme.ink4 }]} numberOfLines={1}>{m.email}</Text> : null}
                      {m.pending && m.assigned ? <Text style={[type.small, { color: theme.ink4 }]} numberOfLines={1}>Joins this panel when they accept</Text> : null}
                    </View>
                    {savingId === m.id ? (
                      <ActivityIndicator size="small" color={theme.brand} />
                    ) : (
                      <View style={[styles.pickCheck, m.assigned && styles.pickCheckOn]}>
                        {m.assigned ? <Feather name="check" size={15} color={theme.white} /> : null}
                      </View>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {/* Inviting is most of the reason this opens on a small team, and
                sending people to the Team tab loses the role they came here to
                staff. The invite is staged onto this job, so accepting puts them
                straight on the panel. */}
            <View style={styles.pickInvite}>
              <Text style={[type.label, { color: theme.ink3, marginBottom: space(2) }]}>INVITE SOMEONE NEW</Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <TextInput
                  value={inviteEmail}
                  onChangeText={(t) => { setInviteEmail(t); setInviteNote(null); }}
                  placeholder="name@company.com"
                  placeholderTextColor={theme.ink4}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="send"
                  onSubmitEditing={sendInvite}
                  editable={!inviting}
                  style={styles.pickInviteInput}
                />
                <Press haptic="light" onPress={sendInvite} disabled={!inviteEmail.trim() || inviting} accessibilityLabel="Send invite" style={styles.pickInviteBtn}>
                  {inviting ? <ActivityIndicator size="small" color={theme.white} /> : <Feather name="send" size={16} color={theme.white} />}
                </Press>
              </View>
              {inviteNote ? (
                <Text style={[type.small, { color: inviteNote.ok ? theme.success : theme.danger, marginTop: space(2), lineHeight: 18 }]}>{inviteNote.msg}</Text>
              ) : null}
            </View>
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

function OfferCard({ offer, approvals, onViewSigned, canHire, onHire, onResend, onReject }) {
  const st = offerStatus(offer);
  const cur = { myr: "RM", usd: "$", sgd: "S$" }[offer.salary_currency] || "";
  const emp = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" }[offer.employment_type] || null;
  const signed = offer.status === "accepted" || offer.esign_status === "completed";
  // Candidate declined, an approver declined, or the offer lapsed without a signature.
  const declined = offer.status === "declined" || offer.approval_status === "declined";
  const expired = !signed && !declined && !!offer.expires_at && new Date(`${offer.expires_at}T23:59:59`) < new Date();
  const canReoffer = (declined || expired) && (onResend || onReject);
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
      {declined && offer.decline_reason ? (
        <View style={styles.declineReason}>
          <Text style={[type.smallStrong, { color: "#9F1239", marginBottom: 3 }]}>Their reason</Text>
          <Text style={[type.small, { color: "#9F1239", lineHeight: 18 }]}>{offer.decline_reason}</Text>
        </View>
      ) : null}
      {canReoffer ? (
        <View style={{ marginTop: space(3) }}>
          {expired ? <Text style={[type.small, { color: theme.ink3, marginBottom: space(2.5), lineHeight: 18 }]}>The offer lapsed without a signature. Send a fresh one, or close this candidate out.</Text> : null}
          {onResend ? <Button title="Re-send offer" icon="send" variant="secondary" onPress={onResend} /> : null}
          {onReject ? <Button title="Close as rejected" icon="x-circle" variant="ghost" onPress={onReject} style={{ marginTop: space(2.5) }} /> : null}
        </View>
      ) : null}
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
  // Lapsed without a signature — keep the badge consistent with the "offer lapsed" body.
  if (o.expires_at && new Date(`${o.expires_at}T23:59:59`) < new Date()) return { label: "Expired", color: "#B45309", bg: "#FEF3C7", icon: "clock" };
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
  const steps = stepsFor(stage);
  const curIdx = steps.indexOf(stage);
  // "hired" is the terminal success stage: the process is finished, so the final
  // step is a checkmark (done), not an in-progress dot.
  const complete = stage === "hired";
  return (
    <View style={{ flexDirection: "row" }}>
      {steps.map((k, i) => {
        const done = curIdx > i || (complete && curIdx === i);
        const active = curIdx === i && !complete;
        return (
          <View key={k} style={{ flex: 1, alignItems: "center" }}>
            <View style={styles.stepLine}>
              <View style={[styles.connector, { backgroundColor: i > 0 && curIdx >= i ? theme.brand : theme.line, opacity: i === 0 ? 0 : 1 }]} />
              <View style={[styles.stepDot, done && styles.stepDone, active && styles.stepActive]}>
                {done ? <Feather name="check" size={11} color={theme.white} /> : active ? <View style={styles.stepInner} /> : null}
              </View>
              <View style={[styles.connector, { backgroundColor: i < steps.length - 1 && curIdx > i ? theme.brand : theme.line, opacity: i === steps.length - 1 ? 0 : 1 }]} />
            </View>
            <Text style={[{ color: active ? theme.ink : theme.ink4, fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 10, marginTop: 7, textAlign: "center" }]} numberOfLines={1}>{stageLabel(k)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function DetailRow({ icon, value, onPress, whatsapp, last }) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[styles.detailRow, !last && styles.detailDivider]}>
      <Feather name={icon} size={16} color={theme.ink3} />
      <Text style={[type.small, { color: onPress ? theme.brand : theme.ink2, flex: 1, marginLeft: 12 }]} numberOfLines={1}>{value}</Text>
      {whatsapp ? (
        <Pressable onPress={() => Linking.openURL(`https://wa.me/${whatsapp}`)} hitSlop={8} style={styles.waBtn}>
          <Ionicons name="logo-whatsapp" size={15} color="#fff" />
          <Text style={styles.waTxt}>WhatsApp</Text>
        </Pressable>
      ) : onPress ? <Feather name="external-link" size={14} color={theme.ink4} /> : null}
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
  roleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: space(1.5), paddingHorizontal: space(6) },
  roleTxt: { ...type.small, color: theme.ink3, marginLeft: 6, flexShrink: 1 },
  aiHead: { flexDirection: "row", alignItems: "center", marginBottom: space(3), marginLeft: space(1) },
  insightErr: { flexDirection: "row", alignItems: "flex-start", marginTop: space(2), backgroundColor: theme.dangerBg, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  // Matches rankBtn on the job screen so the two AI actions read as siblings.
  runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 84, paddingHorizontal: 14, height: 38, borderRadius: radius.pill, backgroundColor: theme.brand, marginLeft: 10 },
  role: { fontFamily: "Inter_500Medium", fontSize: 13.5, color: theme.ink3, marginTop: space(2) },
  tags: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: space(3) },
  tag: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  tagTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: theme.ink, marginLeft: 6 },
  sheet: { backgroundColor: theme.bg, paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(6), minHeight: 340 },

  stageTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 8 },
  detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(3) },
  detailDivider: { borderBottomWidth: 1, borderBottomColor: theme.line2 },
  waBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#25D366", borderRadius: radius.pill, paddingHorizontal: 10, height: 28 },
  waTxt: { fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" },
  timelineItem: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line2 },
  certRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(2.5) },
  skill: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  recPill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  recPillTxt: { fontFamily: "Inter_700Bold", fontSize: 11.5 },
  scoreBody: { flexDirection: "row", alignItems: "center", marginTop: space(3.5) },
  scoreBig: { alignItems: "center", minWidth: 58 },
  scoreBigNum: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 34, lineHeight: 38, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  scoreBigOf: { fontFamily: "Inter_600SemiBold", fontSize: 9, letterSpacing: 0.6, color: theme.ink4, marginTop: 1 },
  critRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  critLabel: { fontFamily: "Inter_500Medium", fontSize: 12, color: theme.ink3, flexShrink: 1, marginRight: 10 },
  pip: { width: 13, height: 5, borderRadius: 3, backgroundColor: theme.line },
  scoreNote: { marginTop: space(3.5), paddingTop: space(3), borderTopWidth: 1, borderTopColor: theme.line2 },
  segbar: { flexDirection: "row", alignSelf: "flex-start", backgroundColor: theme.bg, borderRadius: radius.pill, padding: 4, marginTop: space(4), borderWidth: 1, borderColor: theme.line },
  segItem: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 38, paddingHorizontal: 18, borderRadius: radius.pill },
  segItemOn: { backgroundColor: theme.brand },
  decisionLock: { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: radius.md, padding: 14 },
  lockCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  dlCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, overflow: "hidden" },
  dlHead: { padding: space(4) },
  dlChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "#FEF3C7", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  dlChipTxt: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6, color: "#92400E", marginLeft: 4 },
  dlRoster: { paddingHorizontal: space(3), paddingBottom: space(3), paddingTop: space(1), gap: 8 },
  dlRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 11, paddingVertical: 9 },
  dlStatus: { flexDirection: "row", alignItems: "center", borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  ivStatusCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: radius.lg, borderWidth: 1, backgroundColor: theme.card, padding: space(4) },
  ivStatusIcon: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
  ivStatusChip: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  ivStatusChipTxt: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  decisionOffer: { flexDirection: "row", alignItems: "center", borderRadius: radius.lg, borderWidth: 1, borderColor: "#CBD8F5", backgroundColor: theme.brandSoft, padding: space(3.5) },
  decisionOfferIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", shadowColor: theme.brand, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  decisionReject: { flexDirection: "row", alignItems: "center", borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, padding: space(3.5), marginTop: space(2.5) },
  decisionRejectIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center" },
  resultCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, overflow: "hidden" },
  resultHead: { flexDirection: "row", alignItems: "center", padding: space(4), borderBottomWidth: 1, borderBottomColor: theme.line },
  resultMedallion: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  resultChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8, backgroundColor: theme.card },
  resultChipTxt: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  resultFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: space(4), borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.bg },
  raterChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingLeft: 4, paddingRight: 10, paddingVertical: 3 },
  raterDot: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  ivIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  mlWrap: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line2 },
  mlInput: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 12, height: 44, fontFamily: "Inter_500Medium", fontSize: 14, color: theme.ink },
  mlSave: { paddingHorizontal: 16, height: 44, borderRadius: radius.md, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
  mlGen: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, marginBottom: 8 },
  mlChip: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.brandSoft, borderWidth: 1, borderColor: theme.brand, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11 },
  mlChipIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: theme.white, alignItems: "center", justifyContent: "center" },
  slotRow: { flexDirection: "row", alignItems: "center", marginTop: space(2.5), marginLeft: 50 },
  // Candidate-proposed reschedule: a banded header, the reason as a pull-quote,
  // and the times as ballot cards. Amber throughout, because this is the
  // candidate's move landing back on the panel, not a neutral status.
  propBand: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#FEF3C7", borderRadius: radius.sm,
    paddingHorizontal: 11, paddingVertical: 8,
  },
  propBandTxt: { fontFamily: "Inter_700Bold", fontSize: 10.5, letterSpacing: 0.9, color: "#7C2D12" },
  propBandCount: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#B45309", fontVariant: ["tabular-nums"] },
  propTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 17, lineHeight: 23, letterSpacing: -0.3, color: theme.ink, marginTop: space(3) },
  propSub: { ...type.small, color: theme.ink3, marginTop: 3 },
  propQuote: { borderLeftWidth: 3, borderLeftColor: "#F59E0B", paddingLeft: 12, marginTop: space(3.5) },
  propQuoteTxt: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, color: theme.ink2 },
  propSlots: { flexDirection: "row", gap: 10, marginTop: space(4) },
  propSlot: {
    flex: 1, backgroundColor: theme.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: theme.line, paddingHorizontal: 12, paddingVertical: 12,
  },
  propSlotNum: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: "#FEF3C7",
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  propSlotNumTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#B45309" },
  propSlotDay: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.5, color: theme.ink4, textTransform: "uppercase" },
  propSlotTime: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 17, letterSpacing: -0.3, color: theme.ink, marginTop: 3, fontVariant: ["tabular-nums"] },
  propSlotEnd: { fontFamily: "Inter_400Regular", fontSize: 11.5, color: theme.ink4, marginTop: 1, fontVariant: ["tabular-nums"] },
  propMore: { ...type.small, color: theme.ink4, marginTop: space(2.5) },
  panelAdd: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.brandSoft, borderWidth: 1, borderColor: theme.line,
  },
  pickInvite: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line },
  pickInviteInput: {
    flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: theme.line,
    backgroundColor: theme.bg, paddingHorizontal: 13,
    fontFamily: "Inter_500Medium", fontSize: 14.5, color: theme.ink,
  },
  pickInviteBtn: {
    width: 46, height: 46, borderRadius: radius.md, marginLeft: 8,
    alignItems: "center", justifyContent: "center", backgroundColor: theme.brand,
  },
  pickBackdrop: { flex: 1, backgroundColor: "rgba(15,18,40,0.45)", justifyContent: "flex-end" },
  pickSheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3) },
  pickHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(4) },
  pickHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(1) },
  pickRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: theme.line2 },
  pickCheck: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  pickCheckOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  pickPending: { backgroundColor: "#FEF3C7", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  pickPendingTxt: { fontFamily: "Inter_700Bold", fontSize: 9.5, letterSpacing: 0.5, color: "#92400E" },
  panelChips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: space(2) },
  panelChip: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 6, paddingLeft: 6, paddingRight: 4,
    backgroundColor: theme.bg, borderRadius: 999,
    borderWidth: 1, borderColor: theme.line,
  },
  // 28pt of tappable width inside a small chip, so the x is not a pixel hunt.
  panelChipX: { width: 28, height: 28, alignItems: "center", justifyContent: "center", marginLeft: 2 },
  ivPick: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: theme.white, borderRadius: radius.md,
    borderWidth: 1, borderColor: theme.line, padding: 14,
  },
  ivPickIcon: {
    width: 38, height: 38, borderRadius: radius.sm,
    alignItems: "center", justifyContent: "center", backgroundColor: theme.brandSoft,
  },
  stepHint: { ...type.small, color: theme.ink4, marginTop: space(2), textAlign: "center", paddingHorizontal: space(2) },
  // Handoff tracker
  track: { flexDirection: "row", alignItems: "flex-start" },
  trackDot: { width: 9, height: 9, borderRadius: 5, marginBottom: 5 },
  trackTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  trackLine: { flex: 1, height: 1, backgroundColor: theme.line, marginTop: 4, marginHorizontal: 6 },
  // Offered times, one tile each. A pill of run-together text is the least
  // readable shape for a date, and it buried the substance of the card.
  // Two per row, filling the card. Content-width tiles left a ragged right edge
  // and wasted the space a phone has least of. flexGrow lets an odd last tile
  // take the full row rather than sitting stranded at half width.
  lockNote: { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#FEF3C7", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: space(3) },
  slotTile: { flexDirection: "row", alignItems: "center", backgroundColor: theme.bg, borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 12, paddingVertical: 11 },
  slotTileNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  slotTileNumTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: theme.brand },
  slotTileDay: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: theme.brand, textTransform: "uppercase", letterSpacing: 0.3 },
  slotTileTime: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, letterSpacing: -0.2, color: theme.ink, marginTop: 2, fontVariant: ["tabular-nums"] },
  noteBox: { flexDirection: "row", alignItems: "flex-start", marginTop: space(3), padding: space(3), backgroundColor: theme.line2, borderRadius: radius.md },
  ivHappenCard: { marginTop: space(5), borderRadius: radius.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line },
  ivHappenHead: { paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(1) },
  ivHappenChip: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  ivHappenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.success, marginRight: 6 },
  ivHappenChipTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, color: theme.brand },
  ivHappenBody: { paddingHorizontal: space(4), paddingBottom: space(4), paddingTop: space(3), gap: 8 },
  ivHappenPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 50, borderRadius: radius.md, backgroundColor: theme.brand },
  ivHappenGhost: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 46, borderRadius: radius.md, backgroundColor: theme.line2 },
  ivDoneCard: { marginTop: space(5), borderRadius: radius.lg, borderWidth: 1, borderColor: "#A7F3D0", backgroundColor: theme.card, overflow: "hidden", shadowColor: "#0A1E9E", shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  ivDoneMedallion: { width: 40, height: 40, borderRadius: 13, backgroundColor: theme.success, alignItems: "center", justifyContent: "center", shadowColor: theme.success, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  ivDoneChip: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderWidth: 1, borderColor: "#A7F3D0", borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  ivDoneChipTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, color: "#047857", marginLeft: 4 },
  ivWaitCard: { marginTop: space(5), borderRadius: radius.lg, borderWidth: 1, borderColor: "#FDE68A", backgroundColor: theme.warnBg, padding: space(4) },
  ivWaitMedallion: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  ivWaitChip: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderWidth: 1, borderColor: "#FDE68A", borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  ivWaitChipTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, color: "#B45309", marginLeft: 4 },
  scoreEmpty: { borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, alignItems: "center", paddingVertical: space(6), paddingHorizontal: space(5), overflow: "hidden" },
  scoreEmptyMedallion: { width: 62, height: 62, borderRadius: 20, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center", shadowColor: theme.brand, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  scoreChips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginTop: space(3.5) },
  scoreChip: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5, margin: 3 },
  scoreChipTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: theme.ink2 },
  stageActions: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line2, gap: 10 },
  actions: { flexDirection: "row", gap: 10, justifyContent: "center" },
  exploreToggle: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, borderWidth: 1, borderColor: theme.line, paddingHorizontal: space(4), paddingVertical: space(3.5), marginTop: space(5), ...shadow.sm },
  exploreIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  whyIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  whyScore: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  // No dark scrim. The sheet is short and sits over a screen you keep reading, so
  // dimming the whole profile to explain one line was heavier than the content
  // deserved. Tapping above it still closes it, and the sheet carries a deeper
  // shadow so it still reads as lifted off the page rather than pasted on.
  whyBackdrop: { flex: 1, backgroundColor: "transparent", justifyContent: "flex-end" },
  whySheet: {
    backgroundColor: theme.card, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: space(5), paddingTop: space(3),
    shadowColor: "#0A0E28", shadowOpacity: 0.18, shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 }, elevation: 24,
  },
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
  declineReason: { marginTop: space(3), borderWidth: 1, borderColor: "#FECDD3", backgroundColor: "#FFF1F2", borderRadius: radius.md, padding: space(3) },
});
