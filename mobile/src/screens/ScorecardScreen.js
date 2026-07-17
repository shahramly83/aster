import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { submitScorecard } from "../lib/data";
import { Card, Button } from "../components/ui";
import { theme, radius } from "../theme";
import { SCORE_CRITERIA, recommendationFromRatings, recommendationMeta } from "@aster/shared";

// Ratings are 1..4, matching the web scorecard (SCORE_CRITERIA / 1-to-4 scale).
const SCALE = [1, 2, 3, 4];

export default function ScorecardScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { candidateId, jobId, candidateName } = route.params || {};
  const [ratings, setRatings] = useState({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const setRating = (key, val) => setRatings((r) => ({ ...r, [key]: val }));

  const allRated = SCORE_CRITERIA.every((c) => typeof ratings[c.key] === "number");
  const rec = recommendationFromRatings(ratings);
  const recMeta = recommendationMeta(rec);

  const onSubmit = async () => {
    if (!jobId) {
      Alert.alert("Missing job", "This scorecard isn't linked to a role, so it can't be saved.");
      return;
    }
    setBusy(true);
    try {
      await submitScorecard({
        companyId: profile.companyId,
        userId: profile.userId,
        candidateId,
        jobId,
        ratings,
        notes,
      });
      Alert.alert("Scorecard submitted", `Your feedback for ${candidateName || "the candidate"} is saved.`, [
        { text: "Done", onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert("Could not submit", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.candidate}>{candidateName || "Candidate"}</Text>
        <Text style={styles.hint}>Rate each area 1 (poor) to 4 (excellent). Your card stays private until you submit.</Text>

        {SCORE_CRITERIA.map((c) => (
          <Card key={c.key} style={{ marginTop: 12 }}>
            <Text style={styles.critLabel}>{c.label}</Text>
            <View style={styles.scaleRow}>
              {SCALE.map((n) => {
                const active = ratings[c.key] === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setRating(c.key, n)}
                    style={[styles.scaleBtn, active && { backgroundColor: theme.brand, borderColor: theme.brand }]}
                  >
                    <Text style={[styles.scaleNum, active && { color: "#fff" }]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ))}

        <Card style={{ marginTop: 12 }}>
          <Text style={styles.critLabel}>Notes</Text>
          <TextInput
            style={styles.notes}
            placeholder="What stood out? Strengths, concerns, follow-ups…"
            placeholderTextColor={theme.ink3}
            multiline
            value={notes}
            onChangeText={setNotes}
          />
        </Card>

        {allRated ? (
          <View style={[styles.recBox, { backgroundColor: recMeta.bg }]}>
            <Text style={{ color: theme.ink3, fontSize: 12, fontWeight: "600" }}>Recommendation</Text>
            <Text style={{ color: recMeta.color, fontSize: 18, fontWeight: "800", marginTop: 2 }}>{recMeta.label}</Text>
          </View>
        ) : null}

        <Button
          title={busy ? "Submitting…" : "Submit scorecard"}
          onPress={onSubmit}
          disabled={busy || !allRated}
          style={{ marginTop: 16 }}
        />
        {!allRated ? <Text style={styles.footHint}>Rate all four areas to submit.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  candidate: { fontSize: 22, fontWeight: "800", color: theme.ink, marginTop: 4 },
  hint: { color: theme.ink3, marginTop: 4 },
  critLabel: { fontSize: 15, fontWeight: "700", color: theme.ink },
  scaleRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  scaleBtn: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center", backgroundColor: theme.card },
  scaleNum: { fontSize: 17, fontWeight: "700", color: theme.ink2 },
  notes: { marginTop: 8, minHeight: 96, textAlignVertical: "top", color: theme.ink, fontSize: 15, lineHeight: 21 },
  recBox: { marginTop: 16, borderRadius: radius.md, padding: 14 },
  footHint: { color: theme.ink3, textAlign: "center", marginTop: 8, fontSize: 12 },
});
