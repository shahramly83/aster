import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Linking, StyleSheet, Alert, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useAuth } from "../AuthContext";
import { loadCandidate, loadScorecards, loadCandidateInterview, scheduleInterview, moveCandidateStage } from "../lib/data";
import { Card, Button, Avatar, Loader, SectionHeader, ScreenHeader, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { recommendationMeta, averageRating, stageLabel, stageColor, fmtInterviewTime } from "@aster/shared";

// The hiring process, in order. Offer/Hired are shown but managed on web.
const STEPS = ["applied", "shortlisted", "interviewing", "offer", "hired"];

export default function CandidateProfileScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { candidateId, applicationId, jobId, candidateName } = route.params || {};
  const [candidate, setCandidate] = useState(null);
  const [cards, setCards] = useState([]);
  const [stage, setStage] = useState(route.params?.stage || "applied");
  const [scheduledAt, setScheduledAt] = useState(null);
  const [picker, setPicker] = useState(null); // null | "date" | "time"
  const [schedDate, setSchedDate] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, sc, iv] = await Promise.all([
      loadCandidate(candidateId),
      loadScorecards(candidateId),
      loadCandidateInterview(profile.companyId, candidateId),
    ]);
    setCandidate(c); setCards(sc); setScheduledAt(iv); setLoading(false);
  }, [candidateId, profile.companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nameOf = () => candidate?.name || candidateName || "Candidate";

  const reject = () => {
    Alert.alert("Reject candidate?", `${nameOf()} will be moved to Rejected and emailed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject", style: "destructive", onPress: async () => {
          const prev = stage;
          setStage("rejected");
          try { await moveCandidateStage({ companyId: profile.companyId, candidateId, candidateName: nameOf(), stage: "rejected" }); }
          catch (e) { setStage(prev); Alert.alert("Could not update", e?.message || "Please try again."); }
        },
      },
    ]);
  };

  const onPickerChange = (event, selected) => {
    if (event.type === "dismissed" || !selected) { setPicker(null); return; }
    if (picker === "date") { setSchedDate(selected); setPicker("time"); return; }
    const d = new Date(schedDate || new Date());
    d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setPicker(null); setSchedDate(null);
    confirmSchedule(d);
  };

  const confirmSchedule = async (date) => {
    try {
      await scheduleInterview({
        companyId: profile.companyId, candidateId, jobId, candidateName: nameOf(),
        startIso: date.toISOString(), interviewerId: profile.userId, interviewerName: profile.name,
      });
      setScheduledAt(date.toISOString());
      setStage("interviewing");
      Alert.alert("Interview scheduled", `Scheduled for ${fmtInterviewTime(date.toISOString(), profile.timezone)}.`);
    } catch (e) {
      Alert.alert("Could not schedule", e?.message || "You may not have permission to schedule interviews.");
    }
  };

  if (loading) return <Loader label="Loading candidate…" />;

  const parsed = candidate?.parsed || {};
  const name = nameOf();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader eyebrow="Candidate" title={name} onBack={() => navigation.goBack()} />
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} showsVerticalScrollIndicator={false}>
          {/* Identity */}
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Avatar uri={candidate?.avatarUrl} name={name} size={60} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[type.h3, { color: theme.ink }]} numberOfLines={2}>{parsed.currentTitle || name}</Text>
                <View style={[styles.stageTag, { backgroundColor: stageColor(stage) + "1A" }]}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stageColor(stage), marginRight: 6 }} />
                  <Text style={[type.smallStrong, { color: theme.ink2 }]}>{stageLabel(stage)}</Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: space(4) }}>
              {candidate?.resumeUrl ? <Button title="Résumé" icon="file-text" variant="secondary" onPress={() => Linking.openURL(candidate.resumeUrl)} style={{ flex: 1 }} /> : null}
              <Button title="Discuss" icon="message-circle" variant={candidate?.resumeUrl ? "ghost" : "secondary"} onPress={() => navigation.navigate("Discussion", { candidateId, jobId, candidateName: name })} style={{ flex: 1 }} />
            </View>
          </Card>

          {/* Hiring process */}
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>Hiring process</SectionHeader>
            <Card>
              <ProcessStepper stage={stage} />
            </Card>
          </View>

          {/* Interview (part of the process) */}
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>Interview</SectionHeader>
            <Card>
              {scheduledAt ? (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={styles.ivIcon}><Feather name="calendar" size={18} color={theme.brand} /></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[type.bodyStrong, { color: theme.ink }]}>Interview scheduled</Text>
                    <Text style={[type.small, { color: theme.ink2, marginTop: 1 }]}>{fmtInterviewTime(scheduledAt, profile.timezone)}</Text>
                  </View>
                  <Pressable onPress={() => setPicker("date")} hitSlop={8}><Text style={[type.smallStrong, { color: theme.brand }]}>Change</Text></Pressable>
                </View>
              ) : (
                <>
                  <Text style={[type.small, { color: theme.ink3 }]}>No interview scheduled yet.</Text>
                  <Button title="Schedule interview" icon="calendar" onPress={() => setPicker("date")} style={{ marginTop: space(3) }} />
                </>
              )}
            </Card>
          </View>

          {/* Panel feedback (part of the process) */}
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
            <Button title="Add my scorecard" icon="edit-3" variant="secondary" onPress={() => navigation.navigate("Scorecard", { candidateId, jobId, candidateName: name })} style={{ marginTop: space(3) }} />
          </View>

          {/* Details / contact */}
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
              <View style={{ marginTop: space(5) }}>
                <SectionHeader>Details</SectionHeader>
                <Card style={{ paddingVertical: space(1) }}>
                  {rows.map((r, i) => <DetailRow key={i} {...r} last={i === rows.length - 1} />)}
                </Card>
              </View>
            ) : null;
          })()}

          {/* Summary */}
          {parsed.summary ? (
            <View style={{ marginTop: space(5) }}>
              <SectionHeader>Summary</SectionHeader>
              <Card><Text style={[type.body, { color: theme.ink2 }]}>{parsed.summary}</Text></Card>
            </View>
          ) : null}

          {/* Skills */}
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

          {/* Experience */}
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

          {/* Education */}
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

          {/* Languages */}
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

          {/* Certifications */}
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

          {/* Reject */}
          {stage !== "rejected" && stage !== "hired" ? (
            <Pressable onPress={reject} style={{ alignSelf: "center", marginTop: space(7), padding: 8 }}>
              <Text style={[type.smallStrong, { color: theme.danger }]}>Reject candidate</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {picker ? (
        <DateTimePicker
          value={schedDate || new Date(Date.now() + 86400000)}
          mode={picker}
          is24Hour={false}
          minimumDate={picker === "date" ? new Date() : undefined}
          onChange={onPickerChange}
        />
      ) : null}
    </View>
  );
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
  stageTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 8 },
  detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(3) },
  detailDivider: { borderBottomWidth: 1, borderBottomColor: theme.line2 },
  timelineItem: { marginTop: space(4), paddingTop: space(4), borderTopWidth: 1, borderTopColor: theme.line2 },
  certRow: { flexDirection: "row", alignItems: "center", paddingVertical: space(2.5) },
  skill: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  recScore: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  ivIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  // stepper
  stepLine: { flexDirection: "row", alignItems: "center", width: "100%" },
  connector: { flex: 1, height: 2 },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.line, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: theme.brand, borderColor: theme.brand },
  stepActive: { borderColor: theme.brand },
  stepInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.brand },
  rejectBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: space(2) },
});
