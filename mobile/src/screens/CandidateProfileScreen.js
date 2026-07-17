import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Linking, StyleSheet, Alert, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadCandidate, loadScorecards, moveCandidateStage, MOBILE_STAGES } from "../lib/data";
import { Card, Button, Avatar, Loader, SectionHeader, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { recommendationMeta, averageRating, stageLabel, stageColor } from "@aster/shared";

// Stages a manager can move a candidate to from mobile, in funnel order. "Offer"
// is intentionally absent: it runs through the web offer + e-sign flow, so
// setting it here would break that flow (see MOBILE_STAGES in data.js).
const MANAGER_STAGES = MOBILE_STAGES;

export default function CandidateProfileScreen({ route, navigation }) {
  const { profile, manager } = useAuth();
  const { candidateId, applicationId, jobId, candidateName } = route.params || {};
  const [candidate, setCandidate] = useState(null);
  const [cards, setCards] = useState([]);
  const [stage, setStage] = useState(route.params?.stage || "applied");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, sc] = await Promise.all([loadCandidate(candidateId), loadScorecards(candidateId)]);
    setCandidate(c); setCards(sc); setLoading(false);
  }, [candidateId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const moveStage = async (next) => {
    if (next === stage) return;
    const prev = stage;
    setStage(next); // optimistic
    try {
      await moveCandidateStage({ companyId: profile.companyId, candidateId, candidateName: candidate?.name || candidateName, stage: next });
    } catch (e) {
      setStage(prev);
      Alert.alert("Could not update", e?.message || "You may not have permission to change this candidate's stage.");
    }
  };

  if (loading) return <Loader label="Loading candidate…" />;

  const parsed = candidate?.parsed || {};
  const name = candidate?.name || candidateName || "Candidate";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar uri={candidate?.avatarUrl} name={name} size={60} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[type.h2, { color: theme.ink }]} numberOfLines={1}>{name}</Text>
              {parsed.currentTitle ? <Text style={[type.small, { color: theme.ink2, marginTop: 2 }]} numberOfLines={1}>{parsed.currentTitle}</Text> : null}
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

        {/* Stage control */}
        <View style={{ marginTop: space(5) }}>
          <SectionHeader>{manager ? "Move to stage" : "Quick actions"}</SectionHeader>
          {manager ? (
            <>
              <View style={styles.stageGrid}>
                {MANAGER_STAGES.map((s) => {
                  const active = stage === s;
                  return (
                    <Pressable key={s} onPress={() => moveStage(s)} style={[styles.stageBtn, active && { backgroundColor: stageColor(s), borderColor: stageColor(s) }]}>
                      <Text style={[type.smallStrong, { color: active ? theme.white : theme.ink2 }]}>{stageLabel(s)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.hint}>
                <Feather name="info" size={13} color={theme.ink4} />
                <Text style={[type.small, { color: theme.ink4, marginLeft: 6, flex: 1 }]}>
                  {stage === "offer"
                    ? "This candidate has a live offer. Manage it on the web app."
                    : "Hired and Rejected notify the candidate by email. Offers are sent from the web app."}
                </Text>
              </View>
            </>
          ) : (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Shortlist" icon="star" variant="secondary" onPress={() => moveStage("shortlisted")} disabled={stage === "shortlisted"} style={{ flex: 1 }} />
              <Button title="Reject" icon="x" variant="ghost" onPress={() => moveStage("rejected")} disabled={stage === "rejected"} style={{ flex: 1 }} />
            </View>
          )}
        </View>

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
              {parsed.skills.slice(0, 14).map((s, i) => (
                <View key={i} style={styles.skill}><Text style={[type.small, { color: theme.ink2 }]}>{String(s)}</Text></View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Scorecards */}
        <View style={{ marginTop: space(5) }}>
          <SectionHeader>Panel scorecards · {cards.length}</SectionHeader>
          {cards.length === 0 ? (
            <Card><Text style={[type.small, { color: theme.ink3 }]}>No scorecards yet. Be the first to score this candidate.</Text></Card>
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
        </View>

        <Button title="Add my scorecard" icon="edit-3" onPress={() => navigation.navigate("Scorecard", { candidateId, jobId, candidateName: name })} style={{ marginTop: space(4) }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  stageTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 8 },
  stageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { flexDirection: "row", alignItems: "flex-start", marginTop: space(3), paddingHorizontal: 2 },
  stageBtn: { paddingHorizontal: 14, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" },
  skill: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  recScore: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
