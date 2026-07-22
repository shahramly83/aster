// AI interview questions for a candidate + role, grouped into collapsible
// category accordions (closed by default). Tailored by Claude
// (generate-interview-questions) and read by the whole panel. Tap a question to
// copy it; Copy all copies the full set.
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ORDER = ["Technical", "Experience", "Role fit", "Behavioral", "Depth check", "Collaboration", "Motivation"];

export default function AiQuestions({ questions }) {
  const [open, setOpen] = useState({}); // category -> bool, all closed by default

  if (!questions || !questions.length) return null;

  const sorted = [...questions].sort((a, b) => ((ORDER.indexOf(a.category) + 1 || 99) - (ORDER.indexOf(b.category) + 1 || 99)));
  const groups = [];
  for (const q of sorted) {
    const g = groups.find((x) => x.category === q.category);
    if (g) g.items.push(q.question); else groups.push({ category: q.category || "General", items: [q.question] });
  }

  const copy = async (text) => {
    await Clipboard.setStringAsync(text);
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
  };
  const copyAll = () => copy(sorted.map((q, i) => `${i + 1}. [${q.category}] ${q.question}`).join("\n"));
  const toggle = (cat) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setOpen((o) => ({ ...o, [cat]: !o[cat] }));
  };

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

      {groups.map((g, gi) => {
        const isOpen = !!open[g.category];
        return (
          <View key={g.category} style={[styles.group, gi > 0 && { marginTop: 8 }]}>
            <Pressable onPress={() => toggle(g.category)} style={styles.groupHead}>
              {/* Count sits on the right, beside the chevron. Trailing the
                  category label put it at a different x on every row, so the
                  numbers never lined up and the eye had to hunt for each one. */}
              <Text style={[styles.cat, { flex: 1 }]} numberOfLines={1}>{g.category.toUpperCase()}</Text>
              <View style={styles.countPill}><Text style={styles.countTxt}>{g.items.length}</Text></View>
              <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.ink3} />
            </Pressable>
            {isOpen ? (
              <View style={styles.groupBody}>
                {g.items.map((q, i) => (
                  <Pressable key={i} onPress={() => copy(q)} style={[styles.qRow, i > 0 && styles.qDivider]}>
                    <Text style={[type.small, { color: theme.ink, flex: 1, lineHeight: 19 }]}>{q}</Text>
                    <Feather name="copy" size={14} color={theme.ink4} style={{ marginLeft: 10, marginTop: 1 }} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  head: { flexDirection: "row", alignItems: "center", marginBottom: space(3) },
  copyAll: { flexDirection: "row", alignItems: "center", marginLeft: 10 },
  group: { borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, overflow: "hidden" },
  groupHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12, backgroundColor: theme.bg },
  cat: { ...type.label, color: theme.brand },
  // minWidth keeps a 1 and a 12 the same width, so the pills form a clean column.
  countPill: { marginRight: 8, minWidth: 24, alignItems: "center", backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: theme.brand, fontVariant: ["tabular-nums"] },
  groupBody: { paddingHorizontal: 12, paddingBottom: 4, backgroundColor: theme.card },
  qRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10 },
  qDivider: { borderTopWidth: 1, borderTopColor: theme.line2 },
});
