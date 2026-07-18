// AI interview questions for a candidate + role, grouped by category. Tailored
// by Claude (generate-interview-questions) and read by the whole panel. Tap a
// question to copy it; Copy all copies the full set.
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

const ORDER = ["Technical", "Experience", "Role fit", "Behavioral", "Depth check", "Collaboration", "Motivation"];

export default function AiQuestions({ questions }) {
  if (!questions || !questions.length) return null;

  const groups = [];
  const sorted = [...questions].sort((a, b) => ((ORDER.indexOf(a.category) + 1 || 99) - (ORDER.indexOf(b.category) + 1 || 99)));
  for (const q of sorted) {
    const g = groups.find((x) => x.category === q.category);
    if (g) g.items.push(q.question); else groups.push({ category: q.category || "General", items: [q.question] });
  }

  const copy = async (text) => {
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
  };
  const copyAll = () => copy(sorted.map((q, i) => `${i + 1}. [${q.category}] ${q.question}`).join("\n"));

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={[type.small, { color: theme.ink3, flex: 1 }]}>
          <Text style={{ fontFamily: "Inter_700Bold", color: theme.ink }}>{questions.length} tailored questions</Text> across {groups.length} area{groups.length === 1 ? "" : "s"}.
        </Text>
        <Pressable onPress={copyAll} hitSlop={6} style={styles.copyAll}>
          <Feather name="copy" size={13} color={theme.brand} />
          <Text style={[type.smallStrong, { color: theme.brand, marginLeft: 5 }]}>Copy all</Text>
        </Pressable>
      </View>

      {groups.map((g, gi) => (
        <View key={g.category} style={gi > 0 ? { marginTop: space(3) } : null}>
          <Text style={styles.cat}>{g.category.toUpperCase()}</Text>
          {g.items.map((q, i) => (
            <Pressable key={i} onPress={() => copy(q)} style={styles.qRow}>
              <Text style={[type.small, { color: theme.ink, flex: 1, lineHeight: 19 }]}>{q}</Text>
              <Feather name="copy" size={14} color={theme.ink4} style={{ marginLeft: 10, marginTop: 1 }} />
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  head: { flexDirection: "row", alignItems: "center", marginBottom: space(3) },
  copyAll: { flexDirection: "row", alignItems: "center", marginLeft: 10 },
  cat: { ...type.label, color: theme.brand, marginBottom: space(2) },
  qRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.line2 },
});
