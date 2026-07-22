import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { useAuth } from "../AuthContext";
import { submitScorecard } from "../lib/data";
import { Card, Button, SectionHeader, ScreenHeader } from "../components/ui";
import { useDialog } from "../components/Dialog";
import SuccessModal from "../components/SuccessModal";
import { theme, type, space, radius } from "../theme";
import { SCORE_CRITERIA, recommendationFromRatings, recommendationMeta } from "@aster/shared";

const SCALE = [1, 2, 3, 4];
const SCALE_HINT = { 1: "Poor", 2: "Fair", 3: "Good", 4: "Excellent" };

export default function ScorecardScreen({ route, navigation }) {
  const { profile } = useAuth();
  const dialog = useDialog();
  const { candidateId, jobId, candidateName, existing } = route.params || {};
  const editing = !!existing;
  const [ratings, setRatings] = useState(existing?.ratings || {});
  const [notes, setNotes] = useState(existing?.notes || "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const setRating = (key, val) => {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    setRatings((r) => ({ ...r, [key]: val }));
  };

  const allRated = SCORE_CRITERIA.every((c) => typeof ratings[c.key] === "number");
  const rec = recommendationFromRatings(ratings);
  const recMeta = recommendationMeta(rec);

  const onSubmit = async () => {
    if (busy || done) return; // ignore rapid repeat taps
    if (!jobId) { dialog.alert({ title: "Missing role", message: "This scorecard isn't linked to a role, so it can't be saved.", icon: "alert-triangle", variant: "danger" }); return; }
    setBusy(true);
    try {
      await submitScorecard({ companyId: profile.companyId, userId: profile.userId, candidateId, jobId, ratings, notes });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(true);
    } catch (e) { dialog.alert({ title: "Could not submit", message: e?.message || "Please try again.", icon: "alert-triangle", variant: "danger" }); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader eyebrow={editing ? "Edit scorecard" : "Scorecard"} title={candidateName || "Candidate"} onBack={() => navigation.goBack()} />
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={[type.small, { color: theme.ink3 }]}>{editing ? "Update your ratings below. This replaces your existing card." : "Rate each area 1–4. Your card stays private until you submit."}</Text>

        <View style={{ marginTop: space(5) }}>
          {SCORE_CRITERIA.map((c) => (
            <Card key={c.key} style={{ marginBottom: space(3) }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[type.bodyStrong, { color: theme.ink }]}>{c.label}</Text>
                {ratings[c.key] ? <Text style={[type.small, { color: theme.brand }]}>{SCALE_HINT[ratings[c.key]]}</Text> : null}
              </View>
              <View style={styles.scaleRow}>
                {SCALE.map((n) => {
                  const active = ratings[c.key] === n;
                  return (
                    <Pressable key={n} onPress={() => setRating(c.key, n)} style={[styles.scaleBtn, active && { backgroundColor: theme.brand, borderColor: theme.brand }]}>
                      <Text style={[type.h3, { color: active ? theme.white : theme.ink3 }]}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          ))}
        </View>

        <SectionHeader>Notes</SectionHeader>
        <Card>
          <TextInput
            style={styles.notes}
            placeholder="What stood out? Strengths, concerns, follow-ups…"
            placeholderTextColor={theme.ink4}
            multiline value={notes} onChangeText={setNotes}
          />
        </Card>

        {allRated ? (
          <View style={[styles.recBox, { backgroundColor: recMeta.bg }]}>
            <View>
              <Text style={[type.label, { color: theme.ink3 }]}>RECOMMENDATION</Text>
              <Text style={{ color: recMeta.color, fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 2 }}>{recMeta.label}</Text>
            </View>
          </View>
        ) : null}

        <Button title={editing ? "Update scorecard" : "Submit scorecard"} icon="check" onPress={onSubmit} loading={busy} disabled={!allRated || busy || done} haptic="success" style={{ marginTop: space(5) }} />
        {!allRated ? <Text style={[type.small, { color: theme.ink4, textAlign: "center", marginTop: space(2) }]}>Rate all four areas to submit.</Text> : null}
      </ScrollView>
      </SafeAreaView>
      <SuccessModal
        visible={done}
        title={editing ? "Scorecard updated" : "Scorecard submitted"}
        message={`Your feedback for ${candidateName || "the candidate"} is saved.`}
        onClose={() => { setDone(false); navigation.goBack(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scaleRow: { flexDirection: "row", gap: 10, marginTop: space(3) },
  scaleBtn: { flex: 1, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg },
  notes: { minHeight: 100, textAlignVertical: "top", fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22, color: theme.ink },
  recBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, padding: space(4), marginTop: space(5) },
});
