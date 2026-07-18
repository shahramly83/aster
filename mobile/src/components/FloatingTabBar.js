// Floating pill bottom navigation, inspired by the reference concept: a rounded
// white bar hovering above the content with soft shadow. The active tab expands
// into a blue pill with an icon + label; inactive tabs are icon-only. Rendered as
// a normal (non-absolute) element so React Navigation reserves its height and
// screen content never hides behind it.
import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { theme, type, radius, shadow } from "../theme";

const ICONS = {
  DashboardTab: "activity",
  PositionsTab: "briefcase",
  TodayTab: "calendar",
  TeamsTab: "users",
  ProfileTab: "settings",
};

// Content padding a scrollable tab screen should reserve so nothing hides behind
// the floating (absolutely-positioned) bar.
export const TAB_CLEARANCE = 108;

export default function FloatingTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View style={[styles.bar, shadow.float]}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const focused = state.index === index;
          const onPress = () => {
            if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Tab key={route.key} icon={ICONS[route.name] || "circle"} label={label} focused={focused} onPress={onPress} />
          );
        })}
      </View>
    </View>
  );
}

function Tab({ icon, label, focused, onPress }) {
  const w = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(w, { toValue: focused ? 1 : 0, useNativeDriver: false, speed: 16, bounciness: 6 }).start();
  }, [focused]);
  // Animate the label width so the active pill grows/shrinks smoothly.
  const labelW = w.interpolate({ inputRange: [0, 1], outputRange: [0, label.length * 7.6 + 6] });
  return (
    <Pressable onPress={onPress} style={styles.tap} hitSlop={6}>
      <Animated.View style={[styles.item, focused && styles.itemActive]}>
        <Feather name={icon} size={21} color={focused ? theme.white : theme.ink4} />
        <Animated.View style={{ width: labelW, overflow: "hidden" }}>
          {focused ? <Text style={styles.label} numberOfLines={1}>{label}</Text> : null}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "transparent", paddingHorizontal: 14, paddingTop: 8 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.card,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    height: 64,
  },
  tap: { flex: 0, alignItems: "center", justifyContent: "center" },
  item: { flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: 11, borderRadius: radius.pill },
  itemActive: { backgroundColor: theme.brand, paddingLeft: 12, paddingRight: 13 },
  label: { ...type.smallStrong, color: theme.white, marginLeft: 7 },
});
