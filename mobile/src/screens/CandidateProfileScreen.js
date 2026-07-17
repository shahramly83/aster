import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Linking, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadCandidate, loadScorecards, setApplicantStage } from "../lib/data";
import { Card, Avatar, Button, Loader } from "../components/ui";
import { theme } from "../theme";
import { recommendationMeta, averageRating, stageLabel } from "@aster/shared";

export default function CandidateProfileScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { candidateId, applicationId, jobId, candidateName } = route.params || {};
  const [candidate, setCandidate] = useState(null);
  const [cards, setCards] = useState([]);
  const [stage, setStage] = useState(route.params?.stage || "applied");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [c, sc] = await Promise.all([loadCandidate(candidateId), loadScorecards(candidateId)]);
    setCandidate(c);
    setCards(sc);
    setLoading(false);
  }, [candidateId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const moveStage = async (next) => {
    if (!applicationId) return;
    const prev = stage;
    setStage(next); // optimistic
    try {
      await setApplicantStage(applicationId, next);
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
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar uri={candidate?.avatarUrl} name={name} size={56} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.name}>{name}</Text>
              {parsed.currentTitle ? <Text style={styles.sub}>{parsed.currentTitle}</Text> : null}
              <Text style={styles.stageNow}>Stage: {stageLabel(stage)}</Text>
            </View>
          </View>
          {candidate?.resumeUrl ? (
            <Button title="Open résumé" variant="ghost" onPress={() => Linking.openURL(candidate.resumeUrl)} style={{ marginTop: 12 }} />
          ) : null}
        </Card>

        {/* Quick stage moves — the on-the-go decision this app exists for. */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Button title="⭐ Shortlist" onPress={() => moveStage("shortlisted")} style={{ flex: 1 }} disabled={stage === "shortlisted"} />
          <Button title="Reject" variant="danger" onPress={() => moveStage("rejected")} style={{ flex: 1 }} disabled={stage === "rejected"} />
        </View>

        {parsed.summary ? (
          <Card style={{ marginTop: 12 }}>
            <Text style={styles.h}>Summary</Text>
            <Text style={styles.body}>{parsed.summary}</Text>
          </Card>
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <Text style={styles.h}>Panel scorecards ({cards.length})</Text>
          {cards.length === 0 ? (
            <Text style={styles.hint}>No scorecards yet. Be the first to score this candidate.</Text>
          ) : (
            cards.map((c) => {
              const meta = recommendationMeta(c.recommendation);
              return (
                <View key={c.id} style={styles.scRow}>
                  <View style={[styles.recDot, { backgroundColor: meta.bg }]}>
                    <Text style={{ color: meta.color, fontWeight: "800", fontSize: 12 }}>{averageRating(c.ratings).toFixed(1)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: meta.color, fontWeight: "700" }}>{meta.label}</Text>
                    {c.notes ? <Text style={styles.notes} numberOfLines={3}>{c.notes}</Text> : null}
                  </View>
                </View>
              );
            })
          )}
        </Card>

        <Button
          title="Fill my scorecard"
          onPress={() => navigation.navigate("Scorecard", { candidateId, jobId, candidateName: name })}
          style={{ marginTop: 16 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: "800", color: theme.ink },
  sub: { color: theme.ink2, marginTop: 1 },
  stageNow: { color: theme.ink3, marginTop: 4, fontSize: 12, fontWeight: "600" },
  h: { fontSize: 15, fontWeight: "800", color: theme.ink },
  hint: { color: theme.ink3, marginTop: 8 },
  body: { color: theme.ink2, marginTop: 8, lineHeight: 21 },
  scRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 12 },
  recDot: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  notes: { color: theme.ink2, marginTop: 3, lineHeight: 19 },
});
