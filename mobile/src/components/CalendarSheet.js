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

const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CalendarSheet({ visible, onClose, onConfirm, title, confirmLabel = "Confirm", minDate, initial, mode = "datetime", blocked = [] }) {
  const insets = useSafeAreaInsets();
  const dateOnly = mode === "date";
  const today = startOfDay(new Date());
  const floor = minDate ? startOfDay(new Date(minDate)) : today;
  const init = initial ? new Date(initial) : null;
  const heading = title || (dateOnly ? "Pick a date" : "Pick a date & time");

  const [view, setView] = useState(startOfDay(init || floor)); // any day in the shown month
  const [day, setDay] = useState(init ? startOfDay(init) : null);
  const [from, setFrom] = useState(init && !dateOnly ? { h: init.getHours(), m: init.getMinutes() >= 30 ? 30 : 0 } : null);
  const [to, setTo] = useState(null);

  const mins = (t) => (t ? t.h * 60 + t.m : -1);

  // 30-min marks on the selected day a panel member is already booked for
  // (confirmed interviews). A start can't land on one, and a range can't span one.
  const blockedMins = useMemo(() => {
    const set = new Set();
    if (!day) return set;
    for (const r of blocked || []) {
      const s = new Date(r.start), e = new Date(r.end);
      if (!sameDay(s, day)) continue;
      const sM = s.getHours() * 60 + s.getMinutes(), eM = e.getHours() * 60 + e.getMinutes();
      for (let m = sM; m < eM; m += 30) set.add(m);
    }
    return set;
  }, [blocked, day]);
  const fromBlocked = (t) => blockedMins.has(mins(t));
  const rangeBlocked = (endT) => { for (let m = mins(from); m < mins(endT); m += 30) if (blockedMins.has(m)) return true; return false; };

  const pickFrom = (t) => {
    if (fromBlocked(t)) return;
    setFrom(t);
    if (!to || mins(to) <= mins(t) || rangeBlocked(to)) {
      const endMin = mins(t) + 60;
      const next = TIME_SLOTS.find((s) => mins(s) === endMin && !blockedMins.has(mins(s) - 30));
      setTo(next || null);
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

  const ready = dateOnly ? !!day : (day && from && to && mins(to) > mins(from));
  const confirm = () => {
    if (!ready) return;
    if (dateOnly) {
      onConfirm({ ymd: ymdOf(day), startIso: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).toISOString() });
      onClose();
      return;
    }
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), from.h, from.m, 0, 0);
    const e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), to.h, to.m, 0, 0);
    onConfirm({ startIso: s.toISOString(), endIso: e.toISOString() });
    onClose();
  };

  // Human summary of the current selection for the header pill.
  const summary = !day
    ? (dateOnly ? "Choose a day" : "Choose a day and time")
    : dateOnly
      ? `${WD_LONG[day.getDay()]}, ${day.getDate()} ${MONTHS[day.getMonth()]}`
      : from && to
        ? `${WEEKDAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()].slice(0, 3)} · ${timeLabel(from.h, from.m)}–${timeLabel(to.h, to.m)}`
        : `${WD_LONG[day.getDay()]}, ${day.getDate()} ${MONTHS[day.getMonth()]}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(3) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[type.h3, { color: theme.ink }]}>{heading}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}><Feather name="x" size={20} color={theme.ink3} /></Pressable>
          </View>

          {/* Live selection summary */}
          <View style={styles.summary}>
            <Feather name="calendar" size={16} color={theme.brand} />
            <Text style={[type.smallStrong, { color: day ? theme.ink : theme.ink3, marginLeft: 10, flex: 1 }]} numberOfLines={1}>{summary}</Text>
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

          {/* Time range: From → To (skipped in date-only mode) */}
          {!dateOnly ? (
            <>
              <Text style={styles.timeHead}>FROM</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingRight: space(2) }}>
                {TIME_SLOTS.map((t, i) => {
                  const on = from && mins(from) === mins(t);
                  const disabled = fromBlocked(t);
                  return (
                    <Pressable key={i} onPress={() => pickFrom(t)} disabled={disabled} style={[styles.timeChip, on && styles.timeChipOn, disabled && { opacity: 0.3 }]}>
                      <Text style={[styles.timeTxt, on && { color: theme.white }, disabled && { textDecorationLine: "line-through" }]}>{timeLabel(t.h, t.m)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.timeHead}>TO</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingRight: space(2) }}>
                {TIME_SLOTS.map((t, i) => {
                  const disabled = mins(t) <= mins(from) || rangeBlocked(t);
                  const on = to && mins(to) === mins(t);
                  return (
                    <Pressable key={i} onPress={() => !disabled && setTo(t)} disabled={disabled} style={[styles.timeChip, on && styles.timeChipOn, disabled && { opacity: 0.35 }]}>
                      <Text style={[styles.timeTxt, on && { color: theme.white }]}>{timeLabel(t.h, t.m)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {blockedMins.size > 0 ? (
                <Text style={[type.small, { color: theme.ink4, marginTop: space(2) }]}>Greyed-out times are when a panel member is already interviewing.</Text>
              ) : null}
            </>
          ) : null}

          <Button title={ready ? confirmLabel : (dateOnly ? "Select a date" : "Select a date & time range")} icon={ready ? "check" : undefined} onPress={confirm} disabled={!ready} style={{ marginTop: space(5) }} />
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
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", alignItems: "center", backgroundColor: theme.brandSoft, borderRadius: radius.md, paddingHorizontal: 14, height: 46, marginBottom: space(4) },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(2) },
  monthLabel: { fontFamily: "Inter_700Bold", fontSize: 16, color: theme.ink, letterSpacing: -0.2 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  weekRow: { flexDirection: "row", marginTop: space(1), marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: 48, alignItems: "center", justifyContent: "center" },
  weekTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: theme.ink4, letterSpacing: 0.5, textTransform: "uppercase" },
  dayDot: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  daySelected: { backgroundColor: theme.brand, shadowColor: theme.brand, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  dayTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15.5, color: theme.ink, fontVariant: ["tabular-nums"] },
  todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.brand, marginTop: 2 },
  todayDot0: { width: 4, height: 4, marginTop: 2 },
  timeHead: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1, color: theme.ink4, marginTop: space(4), marginBottom: space(2) },
  timeChip: { paddingHorizontal: 14, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  timeChipOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  timeTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13.5, color: theme.ink, fontVariant: ["tabular-nums"] },
});
