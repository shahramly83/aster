// Aster UI primitives. The visual language of the app lives here: Inter type,
// soft elevation, tactile press feedback (scale + haptics), and vector icons.
import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator, Image, StyleSheet, Animated, Easing, Platform, AccessibilityInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { theme, palette, radius, type, shadow, space } from "../theme";
import { stageColor, stageLabel } from "@aster/shared";
import { AsterMark } from "./Logo";

// ---- Text -------------------------------------------------------------------
// One text component that pulls from the type scale so weights/sizes stay
// consistent. `variant` maps to theme.type; `color` overrides the default.
export function Txt({ variant = "body", color, style, children, ...rest }) {
  const base = type[variant] || type.body;
  return (
    <Text style={[base, { color: color || theme.ink2 }, style]} {...rest}>
      {children}
    </Text>
  );
}

// ---- Tactile press wrapper --------------------------------------------------
// Scales to 0.97 on press with a spring back, plus a light haptic tap. This is
// the "micro-interactions" feel applied to every card/button.
export function Press({ onPress, haptic = "light", disabled, style, children, scaleTo = 0.97 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  const onIn = () => animate(scaleTo);
  const onOut = () => animate(1);
  const handle = () => {
    if (disabled) return;
    if (haptic && Platform.OS !== "web") {
      const kind =
        haptic === "medium" ? Haptics.ImpactFeedbackStyle.Medium :
        haptic === "success" ? null : Haptics.ImpactFeedbackStyle.Light;
      if (haptic === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else if (kind) Haptics.impactAsync(kind).catch(() => {});
    }
    onPress?.();
  };
  return (
    <Pressable onPressIn={onIn} onPressOut={onOut} onPress={handle} disabled={disabled}>
      <Animated.View style={[{ transform: [{ scale }] }, disabled && { opacity: 0.5 }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ---- Card -------------------------------------------------------------------
export function Card({ children, style, elevated = true, onPress, haptic }) {
  const body = <View style={[styles.card, elevated && shadow.sm, style]}>{children}</View>;
  if (onPress) return <Press onPress={onPress} haptic={haptic}>{body}</Press>;
  return body;
}

// ---- Hero banner ------------------------------------------------------------
// The bold, near-black banner from the reference concept: a circular accent icon
// chip, a headline, and a circular arrow button. Used for the primary action /
// attention item on a screen.
export function HeroBanner({ title, subtitle, icon = "zap", onPress, accent = theme.brand }) {
  return (
    <Press onPress={onPress} haptic="medium" style={[shadow.float, { marginBottom: space(4) }]}>
      <View style={styles.hero}>
        <View style={[styles.heroChip, { backgroundColor: accent }]}>
          <Feather name={icon} size={20} color={theme.white} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={[type.h3, { color: theme.onHero }]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[type.small, { color: theme.onHeroMuted, marginTop: 2 }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={styles.heroArrow}>
          <Feather name="arrow-up-right" size={20} color={theme.hero} />
        </View>
      </View>
    </Press>
  );
}

// ---- Circular icon chip -----------------------------------------------------
export function IconChip({ name, tint = theme.ink2, bg = theme.line2, size = 44, onPress, badge = 0 }) {
  const chip = (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Feather name={name} size={size * 0.42} color={tint} />
      {badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeTxt}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </View>
  );
  if (onPress) return <Press onPress={onPress} scaleTo={0.92}>{chip}</Press>;
  return chip;
}

// ---- Header actions (settings + bell) ---------------------------------------
// The top-right cluster on the blue tab screens: a settings gear then the
// notification bell (with an optional unread badge).
// `onAddPeople` is optional: pass it to surface a user-plus chip ahead of the
// settings gear (Job Detail uses it to assign interviewers from the header).
// Screens that don't pass it render exactly as before.
export function HeaderActions({ unread = 0, onSettings, onBell, onAddPeople, addPeopleBadge = 0, light = false }) {
  const tint = light ? theme.ink2 : theme.white;
  const bg = light ? theme.line2 : theme.brandPanel;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {onAddPeople ? (
        <>
          {/* Once people are assigned the chip carries the count, so the header
              answers "how many interviewers?" without opening the sheet. It
              stays a bare user-plus while the role has nobody on it. */}
          <IconChip name={addPeopleBadge > 0 ? "users" : "user-plus"} tint={tint} bg={bg} badge={addPeopleBadge} onPress={onAddPeople} />
          <View style={{ width: 10 }} />
        </>
      ) : null}
      <IconChip name="settings" tint={tint} bg={bg} onPress={onSettings} />
      <View style={{ width: 10 }} />
      <IconChip name="bell" tint={tint} bg={bg} badge={unread} onPress={onBell} />
    </View>
  );
}

// ---- Button -----------------------------------------------------------------
export function Button({ title, onPress, variant = "primary", icon, disabled, loading, style, haptic = "medium" }) {
  const kinds = {
    primary: { bg: theme.brand, fg: theme.white, border: "transparent", elev: shadow.brand },
    secondary: { bg: theme.brand50 || palette.brand50, fg: theme.brand, border: "transparent", elev: null },
    ghost: { bg: "transparent", fg: theme.ink2, border: theme.line, elev: null },
    danger: { bg: theme.danger, fg: theme.white, border: "transparent", elev: null },
    success: { bg: theme.success, fg: theme.white, border: "transparent", elev: null },
  };
  const k = kinds[variant] || kinds.primary;
  return (
    <Press onPress={onPress} disabled={disabled || loading} haptic={haptic} style={[k.elev, style]}>
      <View style={[styles.btn, { backgroundColor: k.bg, borderColor: k.border, borderWidth: k.border === "transparent" ? 0 : 1 }]}>
        {loading ? (
          <ActivityIndicator color={k.fg} />
        ) : (
          <>
            {icon ? <Feather name={icon} size={17} color={k.fg} style={{ marginRight: 8 }} /> : null}
            <Text style={[type.bodyStrong, { color: k.fg }]}>{title}</Text>
          </>
        )}
      </View>
    </Press>
  );
}

// ---- Avatar -----------------------------------------------------------------
export function Avatar({ uri, name, size = 46 }) {
  const initials = (name || "?")
    .split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.line2 }} />;
  }
  // Deterministic soft tint from the name so avatars aren't all identical.
  const tints = [palette.brand50, "#E7F7EE", "#FDF1E3", "#F3ECFE", "#E9F3FE"];
  const fg = [palette.brand, "#12A150", "#C2710A", "#7C3AED", "#1D6FD6"];
  const idx = (name || "?").charCodeAt(0) % tints.length;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tints[idx], alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: fg[idx], fontFamily: "Inter_700Bold", fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

// ---- Stage pill -------------------------------------------------------------
export function StagePill({ stage, small }) {
  const color = stageColor(stage);
  return (
    <View style={[styles.pill, { backgroundColor: color + "1A", paddingVertical: small ? 3 : 4 }]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 6 }} />
      <Text style={[type.smallStrong, { color: theme.ink2, fontSize: small ? 11 : 12 }]}>{stageLabel(stage)}</Text>
    </View>
  );
}

// ---- Score chip (AI match) --------------------------------------------------
// A solid, high-contrast score badge. Color-coded by strength with a label so
// meaning isn't carried by color alone.
export function ScoreChip({ score }) {
  const val = typeof score === "number" ? Math.round(score) : null;
  if (val == null) return null;
  const tier = val >= 75 ? { bg: theme.successBg, fg: theme.success } : val >= 50 ? { bg: theme.warnBg, fg: theme.warn } : { bg: theme.line2, fg: theme.ink3 };
  return (
    <View style={[styles.score, { backgroundColor: tier.bg }]}>
      <Feather name="zap" size={11} color={tier.fg} />
      <Text style={[type.smallStrong, { color: tier.fg, marginLeft: 3 }]}>{val}</Text>
    </View>
  );
}

// ---- Stat tile (dashboard) --------------------------------------------------
export function StatTile({ label, value, icon, tint = theme.brand, style }) {
  return (
    <View style={[styles.card, shadow.sm, styles.stat, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={[styles.statIcon, { backgroundColor: tint + "18" }]}>
          <Feather name={icon} size={16} color={tint} />
        </View>
      </View>
      <Text style={[type.display, { color: theme.ink, fontSize: 26, lineHeight: 30, marginTop: 10 }]}>{value}</Text>
      <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>{label}</Text>
    </View>
  );
}

// ---- Icon in a soft tile ----------------------------------------------------
export function IconTile({ name, tint = theme.brand, size = 40 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: tint + "16", alignItems: "center", justifyContent: "center" }}>
      <Feather name={name} size={size * 0.45} color={tint} />
    </View>
  );
}

// ---- Section header ---------------------------------------------------------
export function SectionHeader({ children, action, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={type.label} numberOfLines={1}>{React.Children.toArray(children).join("").toUpperCase()}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}><Text style={[type.smallStrong, { color: theme.brand }]}>{action}</Text></Pressable>
      ) : null}
    </View>
  );
}

// ---- App header (shared) ----------------------------------------------------
// The consistent top bar used on the blue tab screens (Pipeline, Roles): a
// greeting + first name on the left and an action chip on the right.
function greetingWord() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
export function TopBar({ name, subtitle, right, mark = false }) {
  return (
    <View style={styles.topBar}>
      {mark ? <AsterMark size={38} color={theme.white} /> : null}
      <View style={{ flex: 1, marginLeft: mark ? 12 : 0 }}>
        <Text style={[type.small, { color: theme.onBrandMuted }]}>{subtitle || greetingWord()}</Text>
        <Text style={[type.h2, { color: theme.onBrand }]} numberOfLines={1}>{name || "Welcome"}</Text>
      </View>
      {right}
    </View>
  );
}

// ---- Blue screen header (shared across pushed screens) ----------------------
// A consistent brand-blue header: back button, an uppercase eyebrow, and the
// screen title (wraps to two lines). Sits above a light body.
export function ScreenHeader({ title, eyebrow, onBack, right }) {
  return (
    <View style={styles.screenHeader}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.screenHeaderRow}>
          {onBack ? (
            <Press onPress={onBack} haptic="light" style={styles.screenBack}>
              <Feather name="arrow-left" size={20} color={theme.white} />
            </Press>
          ) : null}
          <View style={{ flex: 1, marginLeft: onBack ? 14 : 0 }}>
            {eyebrow ? <Text style={styles.screenEyebrow}>{String(eyebrow).toUpperCase()}</Text> : null}
            <Text style={styles.screenHeadTitle} numberOfLines={2}>{title}</Text>
          </View>
          {right || null}
        </View>
      </SafeAreaView>
    </View>
  );
}

// ---- Screen scaffolding -----------------------------------------------------
export function ScreenTitle({ children, subtitle, right }) {
  return (
    <View style={styles.screenTitle}>
      <View style={{ flex: 1 }}>
        <Text style={type.h1} numberOfLines={1}>{children}</Text>
        {subtitle ? <Text style={[type.small, { color: theme.ink3, marginTop: 2 }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// Loading spinner that reuses the brand mark from the splash: the Aster
// starburst rotates continuously. `tint` white for blue screens, brand for light.
export function Loader({ label, tint = theme.brand, size = 44 }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true }));
    anim.start();
    return () => anim.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const onBrand = tint !== theme.brand;
  return (
    <View style={styles.centered}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <AsterMark size={size} color={tint} />
      </Animated.View>
      {label ? <Text style={[type.small, { color: onBrand ? "rgba(255,255,255,0.9)" : theme.ink3, marginTop: 14 }]}>{label}</Text> : null}
    </View>
  );
}

// A calm, on-brand empty state: a layered brand medallion (not a flat gray box),
// a clear title/subtitle, and an optional primary action. Every list in the app
// renders through this, so the whole product's "nothing here yet" moments share
// one polished look. Fades + rises in gently on mount (skipped under Reduce
// Motion) so it feels intentional rather than a blank gap.
//   tone="light"  → dark ink on a light body (the default, most screens)
//   tone="brand"  → white type inside a translucent glass panel, for the
//                   brand-blue screens (Open positions) so it reads as an
//                   intentional card instead of dark text floating on blue.
export function EmptyState({ icon = "inbox", title, subtitle, actionLabel, onAction, hint, tone = "light" }) {
  const onBrand = tone === "brand";
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((reduce) => {
      if (!mounted) return;
      if (reduce) { anim.setValue(1); return; }
      Animated.timing(anim, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }).catch(() => anim.setValue(1));
    return () => { mounted = false; };
  }, [anim]);
  return (
    <Animated.View style={[styles.centered, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      <View style={onBrand ? styles.emptyPanel : styles.emptyInner}>
        <View style={onBrand ? styles.emptyMedallionBrand : styles.emptyMedallion}>
          <View style={onBrand ? styles.emptyMedallionInnerBrand : styles.emptyMedallionInner}>
            <Feather name={icon} size={26} color={theme.brand} />
          </View>
        </View>
        <Text style={[type.h2, { color: onBrand ? theme.white : theme.ink, textAlign: "center" }]}>{title}</Text>
        {subtitle ? <Text style={[type.body, { color: onBrand ? theme.onBrandMuted : theme.ink3, marginTop: 8, textAlign: "center", maxWidth: 300 }]}>{subtitle}</Text> : null}
        {actionLabel && onAction ? (
          <Button title={actionLabel} onPress={onAction} variant={onBrand ? "secondary" : "primary"} style={{ marginTop: space(5), alignSelf: "center", minWidth: 200 }} />
        ) : null}
        {hint ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: space(4) }}>
            {onBrand ? <Feather name="arrow-down" size={13} color={theme.onBrandFaint} style={{ marginRight: 6 }} /> : null}
            <Text style={[type.small, { color: onBrand ? theme.onBrandFaint : theme.ink4, textAlign: "center" }]}>{hint}</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

export { Feather };

const styles = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: radius.card, padding: space(5) },
  hero: { flexDirection: "row", alignItems: "center", backgroundColor: theme.hero, borderRadius: radius.card, padding: space(4), paddingRight: space(3) },
  heroChip: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  heroArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.white, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  btn: { flexDirection: "row", height: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space(4) },
  pill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderRadius: radius.pill, alignSelf: "flex-start" },
  score: { flexDirection: "row", alignItems: "center", paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  stat: { flex: 1, padding: space(4) },
  statIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(5), paddingTop: space(1), paddingBottom: space(3) },
  screenHeader: { backgroundColor: theme.brand },
  screenHeaderRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(5) },
  screenBack: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: "#F2526B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: theme.brand },
  badgeTxt: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 10, lineHeight: 12 },
  screenEyebrow: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.4, color: "rgba(255,255,255,0.72)", marginBottom: 5 },
  screenHeadTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 23, lineHeight: 28, letterSpacing: -0.4, color: theme.white },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(3), marginTop: space(2), paddingHorizontal: space(1) },
  screenTitle: { flexDirection: "row", alignItems: "center", paddingHorizontal: space(5), paddingTop: space(2), paddingBottom: space(3) },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  emptyInner: { alignItems: "center" },
  emptyMedallion: { width: 92, height: 92, borderRadius: 28, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: space(5) },
  emptyMedallionInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: theme.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.brandSoft2 },
  // Brand (blue-background) variant: a soft glass panel so the empty state reads
  // as an intentional card, echoing the translucent role cards on the same screen.
  emptyPanel: { alignItems: "center", alignSelf: "center", width: "100%", maxWidth: 380, paddingVertical: space(9), paddingHorizontal: space(6), borderRadius: 28, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  emptyMedallionBrand: { width: 92, height: 92, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", marginBottom: space(5), borderWidth: 1, borderColor: "rgba(255,255,255,0.24)" },
  emptyMedallionInnerBrand: { width: 62, height: 62, borderRadius: 31, backgroundColor: theme.white, alignItems: "center", justifyContent: "center" },
});
