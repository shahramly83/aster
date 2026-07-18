// A modern in-app date + time picker: a real month grid (pick any day "in
// between"), month navigation, a clean brand-blue selected state, and a row of
// time chips. Returns a combined ISO string. Replaces the native spinner.
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Press, Feather } from "./ui";
import { theme, type, space, radius } from "../theme";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// 30-min time options across the working day.
const TIME_SLOTS = (() => {
  const out = [];
  for (let m = 8 * 60; m <= 20 * 60; m += 30) out.push({ h: Math.floor(m / 60), m: m % 60 });
  return out;
})();
function timeLabel(h, m) {
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}

export default function CalendarSheet({ visible, onClose, onConfirm, title = "Pick a date & time", confirmLabel = "Confirm", minDate, initial }) {
  const insets = useSafeAreaInsets();
  const today = startOfDay(new Date());
  const floor = minDate ? startOfDay(new Date(minDate)) : today;
  const init = initial ? new Date(initial) : null;

  const [view, setView] = useState(startOfDay(init || floor)); // any day in the shown month
  const [day, setDay] = useState(init ? startOfDay(init) : null);
  const [from, setFrom] = useState(init ? { h: init.getHours(), m: init.getMinutes() >= 30 ? 30 : 0 } : null);
  const [to, setTo] = useState(null);

  const mins = (t) => (t ? t.h * 60 + t.m : -1);
  const pickFrom = (t) => {
    setFrom(t);
    if (!to || mins(to) <= mins(t)) {
      const endMin = mins(t) + 60;
      setTo(TIME_SLOTS.find((s) => mins(s) === endMin) || TIME_SLOTS[TIME_SLOTS.length - 1]);
    }
  };

  const monthStart = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = monthStart.getDay();
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = useMemo(() => {
    const arr = [];
    for (let i = 0; i < lead; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(view.getFullYear(), view.getMonth(), d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [view, lead, daysInMonth]);

  const canPrev = new Date(view.getFullYear(), view.getMonth(), 1) > new Date(floor.getFullYear(), floor.getMonth(), 1);
  const shiftMonth = (n) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));

  const ready = day && from && to && mins(to) > mins(from);
  const confirm = () => {
    if (!ready) return;
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), from.h, from.m, 0, 0);
    const e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), to.h, to.m, 0, 0);
    onConfirm({ startIso: s.toISOString(), endIso: e.toISOString() });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(3) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[type.h3, { color: theme.ink }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
          </View>

          {/* Month nav */}
          <View style={styles.monthRow}>
            <Press onPress={() => canPrev && shiftMonth(-1)} haptic="light" style={[styles.navBtn, !canPrev && { opacity: 0.3 }]} disabled={!canPrev}>
              <Feather name="chevron-left" size={20} color={theme.ink} />
            </Press>
            <Text style={styles.monthLabel}>{MONTHS[view.getMonth()]} {view.getFullYear()}</Text>
            <Press onPress={() => shiftMonth(1)} haptic="light" style={styles.navBtn}>
              <Feather name="chevron-right" size={20} color={theme.ink} />
            </Press>
          </View>

          {/* Weekday header */}
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <View key={i} style={styles.cell}><Text style={styles.weekTxt}>{w}</Text></View>
            ))}
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {cells.map((d, i) => {
              if (!d) return <View key={i} style={styles.cell} />;
              const disabled = startOfDay(d) < floor;
              const selected = sameDay(d, day);
              const isToday = sameDay(d, today);
              return (
                <Pressable key={i} onPress={() => !disabled && setDay(startOfDay(d))} disabled={disabled} style={styles.cell} hitSlop={2}>
                  <View style={[styles.dayDot, selected && styles.daySelected]}>
                    <Text style={[styles.dayTxt, disabled && { color: theme.ink4, opacity: 0.5 }, selected && { color: theme.white }, isToday && !selected && { color: theme.brand }]}>
                      {d.getDate()}
                    </Text>
                  </View>
                  {isToday ? <View style={[styles.todayDot, selected && { backgroundColor: theme.white }]} /> : <View style={styles.todayDot0} />}
                </Pressable>
              );
            })}
          </View>

          {/* Time range: From → To */}
          <Text style={styles.timeHead}>FROM</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingRight: space(2) }}>
            {TIME_SLOTS.map((t, i) => {
              const on = from && mins(from) === mins(t);
              return (
                <Pressable key={i} onPress={() => pickFrom(t)} style={[styles.timeChip, on && styles.timeChipOn]}>
                  <Text style={[styles.timeTxt, on && { color: theme.white }]}>{timeLabel(t.h, t.m)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.timeHead}>TO</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingRight: space(2) }}>
            {TIME_SLOTS.map((t, i) => {
              const disabled = mins(t) <= mins(from);
              const on = to && mins(to) === mins(t);
              return (
                <Pressable key={i} onPress={() => !disabled && setTo(t)} disabled={disabled} style={[styles.timeChip, on && styles.timeChipOn, disabled && { opacity: 0.35 }]}>
                  <Text style={[styles.timeTxt, on && { color: theme.white }]}>{timeLabel(t.h, t.m)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Button title={ready ? confirmLabel : "Select a date & time range"} icon={ready ? "check" : undefined} onPress={confirm} disabled={!ready} style={{ marginTop: space(4) }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: space(5), paddingTop: space(3), paddingBottom: space(2) },
  handle: { alignSelf: "center", width: 42, height: 5, borderRadius: 3, backgroundColor: theme.line, marginBottom: space(3) },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(3) },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(2) },
  monthLabel: { fontFamily: "Inter_700Bold", fontSize: 16, color: theme.ink, letterSpacing: -0.2 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  weekRow: { flexDirection: "row", marginTop: space(1), marginBottom: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: 46, alignItems: "center", justifyContent: "center" },
  weekTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: theme.ink4, letterSpacing: 0.3 },
  dayDot: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  daySelected: { backgroundColor: theme.brand },
  dayTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: theme.ink, fontVariant: ["tabular-nums"] },
  todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.brand, marginTop: 2 },
  todayDot0: { width: 4, height: 4, marginTop: 2 },
  timeHead: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1, color: theme.ink4, marginTop: space(4), marginBottom: space(2) },
  timeChip: { paddingHorizontal: 14, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  timeChipOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  timeTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13.5, color: theme.ink, fontVariant: ["tabular-nums"] },
});
