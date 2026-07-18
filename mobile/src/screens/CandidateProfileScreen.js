import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TextInput, Linking, Modal, StyleSheet, Alert, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadCandidate, loadScorecards, loadCandidateInterview, moveCandidateStage, loadOffer, loadOfferApprovals, signedOfferUrl, loadApplicationMeta, saveMeetingLink, resendInterviewInvite } from "../lib/data";
import { Card, Button, Avatar, Press, SectionHeader, Feather } from "../components/ui";
import { AsterMark } from "../components/Logo";
import OfferSheet from "../components/OfferSheet";
import ProposeTimesSheet from "../components/ProposeTimesSheet";
import ConfirmDialog from "../components/ConfirmDialog";
import { theme, type, space, radius, shadow } from "../theme";
import { recommendationMeta, averageRating, stageLabel, stageColor, fmtInterviewTime } from "@aster/shared";

// The hiring process, in order. Offer/Hired are shown but managed on web.
const STEPS = ["applied", "shortlisted", "interviewing", "offer", "hired"];

export default function CandidateProfileScreen({ route, navigation }) {
  const { profile, manager } = useAuth();
  const insets = useSafeAreaInsets();
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
  const [offer, setOffer] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [matchReason, setMatchReason] = useState(null);
  const [matchScore, setMatchScore] = useState(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, sc, iv, off, meta] = await Promise.all([
      loadCandidate(candidateId),
      loadScorecards(candidateId),
      loadCandidateInterview(profile.companyId, candidateId),
      loadOffer(profile.companyId, candidateId),
      loadApplicationMeta(profile.companyId, candidateId),
    ]);
    setCandidate(c); setCards(sc); setInterview(iv); setOffer(off);
    setMlInput(iv?.meetingLink || "");
    if (meta?.stage) setStage(meta.stage); // true current stage (e.g. from a notification)
    setMatchReason(meta?.reason || null);
    setMatchScore(meta?.score ?? null);
    setApprovals(off?.id && off.approval_status ? await loadOfferApprovals(off.id) : []);
    setLoading(false);
  }, [candidateId, profile.companyId]);

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

  const saveMl = async () => {
    setMlSaving(true);
    const res = await saveMeetingLink(profile.companyId, candidateId, mlInput.trim());
    setMlSaving(false);
    if (!res.ok) Alert.alert("Couldn't save link", res.error || "Try again.");
    else load();
  };

  const resendInvite = async () => {
    if (!interview?.token) return;
    const res = await resendInterviewInvite(interview.token);
    Alert.alert(res.ok ? "Email resent" : "Couldn't resend", res.ok ? "The candidate got the booking link again." : (res.error || "Try again."));
  };

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#fff" />
    </View>
  );

  const parsed = candidate?.parsed || {};
  const name = nameOf();

  // ---- Interview → decision → offer → hired state machine (web sequence) ----
  const scheduledAt = interview?.status === "scheduled" ? interview.scheduledAt : null;
  const pendingInvite = interview?.status === "sent" ? interview : null;
  const interviewDone = !!scheduledAt && new Date(scheduledAt).getTime() < Date.now();
  // Show the interview flow once the candidate reaches interviewing (or there's
  // already an invite/booking).
  const showInterview = stage === "interviewing" || !!scheduledAt || !!pendingInvite;
  const canScore = interviewDone || ["offer", "hired"].includes(stage);
  // Every panel member (interview attendees) must submit a scorecard before the
  // decision opens. Falls back to "any scorecard" if attendees weren't recorded.
  const ratedIds = new Set(cards.map((c) => c.interviewerId));
  const panel = interview?.attendees || [];
  const allRated = panel.length ? panel.every((p) => p.id && ratedIds.has(p.id)) : cards.length > 0;
  const showDecision = stage === "interviewing" && interviewDone && allRated;

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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space(4) }} showsVerticalScrollIndicator={false}>
          <View style={styles.sheet}>
            {/* Actions */}
            <View style={styles.actions}>
              <Button title="Discuss" icon="message-circle" variant="secondary" onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} style={matchReason ? { flex: 1 } : { minWidth: 220 }} />
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
                      <Text style={[type.small, { color: theme.ink2, marginTop: 1 }]}>{fmtInterviewTime(scheduledAt, profile.timezone)}</Text>
                    </View>
                  </View>
                  {/* Meeting link field appears once the candidate has accepted */}
                  <View style={styles.mlWrap}>
                    <Text style={[type.smallStrong, { color: theme.ink2, marginBottom: 7 }]}>Meeting link</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TextInput
                        value={mlInput} onChangeText={setMlInput}
                        placeholder="Paste the video call link…" placeholderTextColor={theme.ink4}
                        autoCapitalize="none" keyboardType="url"
                        style={[styles.mlInput, { flex: 1 }]}
                      />
                      <Pressable onPress={saveMl} disabled={mlSaving} style={styles.mlSave}>
                        {mlSaving ? <ActivityIndicator size="small" color={theme.white} /> : <Text style={[type.smallStrong, { color: theme.white }]}>Save</Text>}
                      </Pressable>
                    </View>
                    {interview?.meetingLink ? (
                      <Pressable onPress={() => Linking.openURL(interview.meetingLink)} style={{ marginTop: 8 }}>
                        <Text style={[type.small, { color: theme.brand }]} numberOfLines={1}>Open link ↗</Text>
                      </Pressable>
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
                      <Text style={[type.small, { color: theme.ink2, marginLeft: 8 }]}>{fmtInterviewTime(s.start, profile.timezone)}</Text>
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
            <SectionHeader>Panel feedback · {cards.length}</SectionHeader>
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
                      <Text style={[type.smallStrong, { color: meta.color }]}>{meta.label}</Text>
                      {c.notes ? <Text style={[type.small, { color: theme.ink2, marginTop: 3 }]} numberOfLines={4}>{c.notes}</Text> : <Text style={[type.small, { color: theme.ink4, marginTop: 3 }]}>No notes</Text>}
                    </View>
                  </Card>
                );
              })
            )}
            {canScore ? (
              <Button title="Add my scorecard" icon="edit-3" variant="secondary" onPress={() => navigation.navigate("Scorecard", { candidateId, jobId, candidateName: name })} style={{ marginTop: space(3) }} />
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
        candidateId={candidateId}
        candidateName={name}
        jobId={jobId}
        onSent={() => { setStage("offer"); load(); }}
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
  name: { fontFamily: "Inter_700Bold", fontSize: 26, lineHeight: 31, letterSpacing: -0.5, color: theme.ink, marginTop: space(3), textAlign: "center" },
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
