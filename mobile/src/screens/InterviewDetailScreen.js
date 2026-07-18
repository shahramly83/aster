import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Linking, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadCandidate, loadInterviewQuestions, loadMyInterviews } from "../lib/data";
import { useAuth } from "../AuthContext";
import { Card, Avatar, Button, Loader, SectionHeader, ScreenHeader, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { fmtInterviewTime } from "@aster/shared";

export default function InterviewDetailScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { interviewId } = route.params || {};
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
        const [c, q] = await Promise.all([loadCandidate(row.candidateId), loadInterviewQuestions(row.candidateId, row.jobId)]);
        setCandidate(c); setQuestions(q);
      }
      setLoading(false);
    })();
  }, [resolveInterview]);

  if (loading) return <Loader label="Loading interview…" />;
  if (!iv) return <View style={{ flex: 1, padding: space(6), backgroundColor: theme.bg }}><Text style={[type.body, { color: theme.ink2 }]}>This interview is no longer available.</Text></View>;

  const parsed = candidate?.parsed || {};
  const title = parsed.currentTitle || parsed.headline || "";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader eyebrow="Interview" title={iv.candidateName || "Interview"} onBack={() => navigation.goBack()} />
      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar uri={iv.avatarUrl} name={iv.candidateName} size={60} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[type.h2, { color: theme.ink }]} numberOfLines={1}>{iv.candidateName}</Text>
              {title ? <Text style={[type.small, { color: theme.ink2, marginTop: 2 }]} numberOfLines={1}>{title}</Text> : null}
              <Text style={[type.small, { color: theme.ink3 }]} numberOfLines={1}>{iv.jobTitle}</Text>
            </View>
          </View>
          <View style={styles.timeBox}>
            <Feather name="clock" size={16} color={theme.brand} />
            <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 8 }]}>{fmtInterviewTime(iv.scheduledAt, profile?.timezone)}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: space(3) }}>
            {iv.meetingLink ? <Button title="Join call" icon="video" onPress={() => Linking.openURL(iv.meetingLink)} style={{ flex: 1 }} /> : null}
            {candidate?.resumeUrl ? <Button title="Résumé" icon="file-text" variant="secondary" onPress={() => Linking.openURL(candidate.resumeUrl)} style={{ flex: 1 }} /> : null}
          </View>
        </Card>

        {Array.isArray(parsed.skills) && parsed.skills.length ? (
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>Skills</SectionHeader>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {parsed.skills.slice(0, 12).map((s, i) => (
                <View key={i} style={styles.skill}><Text style={[type.small, { color: theme.ink2 }]}>{String(s)}</Text></View>
              ))}
            </View>
          </View>
        ) : null}

        {questions.length ? (
          <View style={{ marginTop: space(5) }}>
            <SectionHeader>Suggested questions</SectionHeader>
            <Card>
              {questions.slice(0, 8).map((q, i) => (
                <View key={i} style={{ flexDirection: "row", marginTop: i === 0 ? 0 : space(3) }}>
                  <Text style={[type.smallStrong, { color: theme.brand, width: 22 }]}>{i + 1}</Text>
                  <Text style={[type.body, { color: theme.ink, flex: 1 }]}>{typeof q === "string" ? q : q.question || q.text || ""}</Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <Button title="Fill scorecard" icon="edit-3" onPress={() => navigation.navigate("Scorecard", { candidateId: iv.candidateId, jobId: iv.jobId, candidateName: iv.candidateName })} style={{ marginTop: space(5) }} />
        <Button title="Discuss with panel" icon="message-circle" variant="secondary" onPress={() => navigation.navigate("Discussion", { candidateId: iv.candidateId, jobId: iv.jobId, candidateName: iv.candidateName })} style={{ marginTop: space(3) }} />
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  timeBox: { flexDirection: "row", alignItems: "center", marginTop: space(4), backgroundColor: theme.brandSoft, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14 },
  skill: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
