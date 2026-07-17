import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { loadApplicants } from "../lib/data";
import { Card, Avatar, ScoreRing, StagePill, Loader, EmptyState } from "../components/ui";
import { theme } from "../theme";

export default function PositionApplicantsScreen({ route, navigation }) {
  const { profile } = useAuth();
  const { jobId, jobTitle } = route.params || {};
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const data = await loadApplicants(profile.companyId, jobId);
    setRows(data);
  }, [profile, jobId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (rows === null) return <Loader label="Loading candidates…" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["bottom"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 6 }}>
        <Text style={styles.sub}>{jobTitle} · {rows.length} candidate{rows.length === 1 ? "" : "s"}</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.applicationId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListEmptyComponent={<View style={{ marginTop: 60 }}><EmptyState title="No candidates yet" subtitle="Applicants for this role will show here." /></View>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate("CandidateProfile", {
                candidateId: item.candidateId,
                applicationId: item.applicationId,
                jobId,
                stage: item.stage,
                candidateName: item.name,
              })
            }
            style={{ marginBottom: 10 }}
          >
            <Card style={{ flexDirection: "row", alignItems: "center" }}>
              <Avatar uri={item.avatarUrl} name={item.name} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.name}>{item.name}</Text>
                <View style={{ marginTop: 6 }}><StagePill stage={item.stage} /></View>
              </View>
              <ScoreRing score={item.matchScore} />
            </Card>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sub: { color: theme.ink3, fontWeight: "600" },
  name: { fontSize: 16, fontWeight: "700", color: theme.ink },
});
