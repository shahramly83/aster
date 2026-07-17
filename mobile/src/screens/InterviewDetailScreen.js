import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Linking, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadCandidate, loadInterviewQuestions, loadMyInterviews } from "../lib/data";
import { useAuth } from "../AuthContext";
import { Card, Avatar, Button, Loader } from "../components/ui";
import { theme } from "../theme";
import { fmtInterviewTime } from "@aster/shared";

export default function InterviewDetailScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { interviewId } = route.params || {};
  // The Today screen passes the row through; a deep link won't, so we can refetch.
  const [iv, setIv] = useState(route.params?.iv || null);
  const [candidate, setCandidate] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);

  const resolveInterview = useCallback(async () => {
    if (iv || !profile) return iv;
    const rows = await loadMyInterviews(profile.companyId, profile.userId);
    const found = rows.find((r) => r.id === interviewId) || null;
    setIv(found);
    return found;
  }, [iv, profile, interviewId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const row = await resolveInterview();
      if (row?.candidateId) {
        const [c, q] = await Promise.all([
          loadCandidate(row.candidateId),
          loadInterviewQuestions(row.candidateId, row.jobId),
        ]);
        setCandidate(c);
        setQuestions(q);
      }
      setLoading(false);
    })();
  }, [resolveInterview]);

  if (loading) return <Loader label="Loading interview…" />;
  if (!iv) return <View style={styles.pad}><Text style={{ color: theme.ink2 }}>This interview is no longer available.</Text></View>;

  const parsed = candidate?.parsed || {};
  const title = parsed.currentTitle || parsed.headline || "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={56} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.name}>{iv.candidateName}</Text>
              {title ? <Text style={styles.sub}>{title}</Text> : null}
              <Text style={styles.sub}>{iv.jobTitle}</Text>
            </View>
          </View>
          <View style={styles.timeBox}>
            <Text style={styles.time}>🕑 {fmtInterviewTime(iv.scheduledAt, profile?.timezone)}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            {iv.meetingLink ? (
              <Button title="Join call" onPress={() => Linking.openURL(iv.meetingLink)} style={{ flex: 1 }} />
            ) : null}
            {candidate?.resumeUrl ? (
              <Button title="Résumé" variant="ghost" onPress={() => Linking.openURL(candidate.resumeUrl)} style={{ flex: 1 }} />
            ) : null}
          </View>
        </Card>

        {Array.isArray(parsed.skills) && parsed.skills.length ? (
          <Card style={{ marginTop: 12 }}>
            <Text style={styles.h}>Skills</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {parsed.skills.slice(0, 12).map((s, i) => (
                <View key={i} style={styles.chip}><Text style={styles.chipText}>{String(s)}</Text></View>
              ))}
            </View>
          </Card>
        ) : null}

        {questions.length ? (
          <Card style={{ marginTop: 12 }}>
            <Text style={styles.h}>Suggested questions</Text>
            <Text style={styles.hint}>AI-drafted for this candidate and role.</Text>
            {questions.slice(0, 8).map((q, i) => (
              <View key={i} style={{ flexDirection: "row", marginTop: 10 }}>
                <Text style={styles.qNum}>{i + 1}.</Text>
                <Text style={styles.qText}>{typeof q === "string" ? q : q.question || q.text || ""}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Button
          title="Fill scorecard"
          onPress={() => navigation.navigate("Scorecard", { candidateId: iv.candidateId, jobId: iv.jobId, candidateName: iv.candidateName })}
          style={{ marginTop: 16 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pad: { flex: 1, padding: 24, backgroundColor: theme.bg },
  name: { fontSize: 20, fontWeight: "800", color: theme.ink },
  sub: { color: theme.ink2, marginTop: 1 },
  timeBox: { marginTop: 14, backgroundColor: theme.brandSoft, borderRadius: 10, padding: 12 },
  time: { color: theme.brand, fontWeight: "600" },
  h: { fontSize: 15, fontWeight: "800", color: theme.ink },
  hint: { color: theme.ink3, fontSize: 12, marginTop: 2 },
  chip: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: theme.ink2, fontSize: 13 },
  qNum: { color: theme.brand, fontWeight: "700", width: 22 },
  qText: { color: theme.ink, flex: 1, lineHeight: 20 },
});
