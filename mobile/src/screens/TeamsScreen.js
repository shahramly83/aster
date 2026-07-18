import React, { useCallback, useState } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { loadTeam } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { Card, Avatar, ScreenTitle, EmptyState, Feather } from "../components/ui";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";
import { ROLE_LABELS } from "@aster/shared";

const ROLE_ICON = { owner: "star", admin: "shield", recruiter: "user-check", interviewer: "users" };

export default function TeamsScreen() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setRows(await loadTeam(profile.companyId));
  }, [profile]);

  useFocusEffect(useCallback(() => { setStatusBarStyle("dark"); }, []));
  useAutoRefresh(profile?.companyId, load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["top"]}>
      <ScreenTitle subtitle={rows ? `${rows.length} member${rows.length === 1 ? "" : "s"}` : undefined}>Team</ScreenTitle>
      <FlatList
        data={rows === null ? [] : rows}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space(4), paddingBottom: TAB_CLEARANCE, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: "center", paddingTop: space(12) }}>
            <EmptyState icon="users" title={rows === null ? "Loading…" : "No teammates yet"} subtitle={rows === null ? "" : "Invite teammates from the Aster web app."} />
          </View>
        }
        renderItem={({ item }) => (
          <Card style={{ marginBottom: space(2.5), flexDirection: "row", alignItems: "center" }}>
            <Avatar name={item.name} size={46} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[type.bodyStrong, { color: theme.ink }]} numberOfLines={1}>{item.name}{item.id === profile?.userId ? " (you)" : ""}</Text>
              {item.email ? <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]} numberOfLines={1}>{item.email}</Text> : null}
            </View>
            <View style={styles.roleTag}>
              <Feather name={ROLE_ICON[item.role] || "user"} size={11} color={theme.brand} />
              <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 5 }]}>{ROLE_LABELS[item.role] || "Member"}</Text>
            </View>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  roleTag: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, marginLeft: 8 },
});
