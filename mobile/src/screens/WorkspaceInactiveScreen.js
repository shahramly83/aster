import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { AsterLogo } from "../components/Logo";
import { Feather } from "../components/ui";
import { theme, type, space } from "../theme";

// Shown when the workspace's trial has run out, the subscription lapsed, or the
// owner deleted it. Until now the app simply loaded to blank screens: RLS stops
// resolving the company in that state, so every list came back empty with
// nothing on screen to say why.
//
// Deliberately says nothing about prices and offers no way to pay. Billing lives
// on the web, this is a statement of fact rather than a sales pitch, and App
// Store guideline 3.1.1 forbids steering people to an outside purchase. It does
// not even carry a link: the person reading it is usually an interviewer who
// cannot fix it anyway, so the useful instruction is to talk to whoever runs
// the workspace.
// A workspace stops working in three different ways, and they are not the same
// event. Telling someone eighteen months into a subscription that their trial has
// finished is worse than telling them nothing: it reads as a system that does not
// know who they are. `who` is already possessive, so it can carry the fallback.
const COPY = {
  trial: {
    title: "This workspace is paused",
    lead: (who) => `${who} trial has finished, so Aster is read-only for everyone on the team until it is renewed.`,
    next: "Renewing is handled by an admin on the Aster website, not in this app. If you are not the admin, let them know.",
  },
  churned: {
    title: "This workspace is no longer active",
    lead: (who) => `${who} subscription has ended, so Aster is read-only for everyone on the team until it is renewed.`,
    next: "Renewing is handled by an admin on the Aster website, not in this app. If you are not the admin, let them know.",
  },
  // Reachable only by admin_set_company_suspended against a paying customer.
  // Nothing has ended and nothing needs renewing, so it says neither.
  suspended: {
    title: "This workspace is paused",
    lead: (who) => `${who} access to Aster has been suspended, so it is read-only for everyone on the team.`,
    next: "An admin can sort this out on the Aster website, not in this app. If you are not the admin, let them know.",
  },
};

export default function WorkspaceInactiveScreen() {
  const { workspaceInactive, signOut } = useAuth();
  const name = workspaceInactive?.companyName;
  const churned = workspaceInactive?.status === "churned";
  const copy = COPY[churned ? "churned" : workspaceInactive?.everPaid ? "suspended" : "trial"];
  const who = name ? `${name}'s` : "Your";

  // The 30-day window before the data is purged. Worth showing precisely,
  // because it is the one fact that changes what someone does today.
  const purge = workspaceInactive?.purgeAfter ? new Date(workspaceInactive.purgeAfter) : null;
  const daysLeft = purge ? Math.max(0, Math.ceil((purge.getTime() - Date.now()) / 86400000)) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.brand }}>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        <View style={styles.page}>
          <AsterLogo width={132} color="#FFFFFF" />

          <View style={styles.icon}>
            <Feather name="pause-circle" size={30} color="#FFFFFF" />
          </View>

          <Text style={styles.h1}>{copy.title}</Text>

          <Text style={styles.body}>{copy.lead(who)}</Text>

          <Text style={styles.body}>{copy.next}</Text>

          {daysLeft !== null && (
            <View style={styles.note}>
              <Feather name="clock" size={15} color="#FFD9A0" />
              <Text style={styles.noteTxt}>
                {daysLeft > 0
                  ? `Your jobs, candidates and interviews are kept for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}.`
                  : "The retention window for this workspace has passed."}
              </Text>
            </View>
          )}

          <View style={{ flex: 1 }} />

          <Pressable onPress={signOut} style={styles.cta} accessibilityRole="button" accessibilityLabel="Sign out">
            <Text style={styles.ctaTxt}>Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: space(7), paddingTop: space(10), paddingBottom: space(8) },
  icon: {
    width: 60, height: 60, borderRadius: 30, marginTop: space(9),
    backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center",
  },
  h1: {
    fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 27, lineHeight: 33,
    letterSpacing: -0.8, color: "#FFFFFF", marginTop: space(5),
  },
  body: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 23, color: "#CFDCFF", marginTop: space(4) },
  note: {
    flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: space(6),
    backgroundColor: "rgba(0,0,0,0.18)", borderRadius: 14, padding: 13,
  },
  noteTxt: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13.5, lineHeight: 19, color: "#FFD9A0" },
  cta: {
    height: 54, borderRadius: 16, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
  },
  ctaTxt: { fontFamily: "Inter_700Bold", fontSize: 16, color: theme.brand },
});
