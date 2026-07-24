import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, ScrollView, StyleSheet, Animated, Easing, Modal, Pressable, TextInput, Keyboard, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { setStatusBarStyle } from "expo-status-bar";
import { useAuth } from "../AuthContext";
import { useNotifications } from "../NotificationsContext";
import { loadTeam, inviteTeammate, removeTeammate, loadApprovers, addApprover, removeApprover } from "../lib/data";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { Press, Avatar, HeaderActions, TopBar, Button, Loader, EmptyState, Feather } from "../components/ui";
import SuccessModal from "../components/SuccessModal";
import ConfirmDialog from "../components/ConfirmDialog";
import { TAB_CLEARANCE } from "../components/FloatingTabBar";
import { theme, type, space, radius } from "../theme";
import { ROLE_LABELS } from "@aster/shared";

// Per-role identity: icon + colour so each member reads at a glance and the
// summary tiles are colour-coded.
const ROLE_META = {
  owner: { icon: "star", color: "#B45309", bg: "#FEF3C7", ring: "#F59E0B" },
  admin: { icon: "shield", color: theme.brand, bg: theme.brandSoft, ring: theme.brand },
  recruiter: { icon: "user-check", color: "#0F766E", bg: "#CCFBF1", ring: "#14B8A6" },
  interviewer: { icon: "users", color: "#6D28D9", bg: "#EDE9FE", ring: "#8B5CF6" },
  approver: { icon: "check-circle", color: "#166534", bg: "#DCFCE7", ring: "#22C55E" },
};
const metaOf = (r) => ROLE_META[r] || { icon: "user", color: theme.ink3, bg: theme.line2, ring: theme.line };
const ROLE_ORDER = ["owner", "admin", "recruiter", "interviewer"];
const roleLabelOf = (r) => (r === "approver" ? "Approver" : (ROLE_LABELS[r] || "Member"));

function Rise({ children, delay = 0, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 400, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

function apInitials(s) {
  const p = String(s || "?").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
}

const ap = StyleSheet.create({
  okPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  okTxt: { color: "#166534", fontFamily: "Inter_700Bold", fontSize: 11 },
  pendingPill: { backgroundColor: "#FEF3C7", borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  pendingTxt: { color: "#92400E", fontFamily: "Inter_700Bold", fontSize: 11 },
  x: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 14, height: 48, fontFamily: "Inter_500Medium", fontSize: 14.5, color: theme.ink },
});

export default function TeamsScreen({ navigation }) {
  const { profile } = useAuth();
  const { unread } = useNotifications();
  // A React Native <Modal> renders in its own window on Android, where the
  // safe-area inset frequently reports 0, so the sheet's own padding was all
  // that stood between "Send invite" and the system nav bar. Floor it.
  const insets = useSafeAreaInsets();
  const sheetPadBottom = Math.max(insets.bottom, 24) + space(4);
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Invite flow (owner/admin only — the RPC also enforces this server-side).
  const canInvite = ["owner", "admin"].includes((profile?.role || "").toLowerCase());
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("interviewer");
  const [sending, setSending] = useState(false);
  const [inviteErr, setInviteErr] = useState(null);
  const [inviteDone, setInviteDone] = useState(null); // { title, message }
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const s = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setKb(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  const [approvers, setApprovers] = useState(null);
  const load = useCallback(async () => {
    if (!profile) return;
    const [team, aps] = await Promise.all([loadTeam(profile.companyId), loadApprovers(profile.companyId)]);
    setRows(team); setApprovers(aps);
  }, [profile]);
  const resendApprover = async (r) => {
    const res = await addApprover({ email: r.email, name: r.name });
    if (res.ok) setInviteDone({ title: "Confirmation re-sent", message: `We re-sent the confirmation email to ${r.email}. They'll appear as Confirmed once they click it.` });
  };
  const removeApproverRow = async (id) => { setApprovers((l) => (l || []).filter((x) => x.id !== id)); await removeApprover(id); };
  const removeTeammateRow = async (item) => {
    const err = await removeTeammate(item.id);
    if (err) { setInviteDone({ title: "Couldn't remove", message: err }); return; }
    load();
  };
  const [confirmRemove, setConfirmRemove] = useState(null); // { ...item } pending deletion (approver or teammate)

  // Approver add form — lives inside the "Add people" (invite) modal.
  const [apName, setApName] = useState("");
  const [apEmail, setApEmail] = useState("");
  const [apBusy, setApBusy] = useState(false);
  const [apErr, setApErr] = useState(null);
  const submitApprover = async () => {
    const e = apEmail.trim().toLowerCase();
    if (!e.includes("@")) { setApErr("Enter a valid email address."); return; }
    setApBusy(true); setApErr(null);
    const res = await addApprover({ email: e, name: apName.trim() || null });
    setApBusy(false);
    if (!res.ok) { setApErr(res.error || "Couldn't add that approver."); return; }
    setApName(""); setApEmail(""); Keyboard.dismiss(); setInviteOpen(false); load();
    setInviteDone({
      title: res.already ? "Already an approver" : "Approver invited",
      message: res.already ? `${e} is already a confirmed approver.` : `${e} was emailed a link to confirm. They'll appear as an Approver once they confirm, no account needed.`,
    });
  };

  useFocusEffect(useCallback(() => { setStatusBarStyle("light"); }, []));
  useAutoRefresh(profile?.companyId, load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Match web: invites are gated to the admin's own email domain when set — you
  // type only the name and we append @<domain>. Blocks personal/out-of-domain.
  const tenantDomain = (profile?.email || "").split("@")[1]?.toLowerCase() || "";
  const inviteFullEmail = (tenantDomain ? `${inviteEmail.trim()}@${tenantDomain}` : inviteEmail.trim()).toLowerCase();
  const inviteValid = tenantDomain ? /^[^\s@]+$/.test(inviteEmail.trim()) : /^\S+@\S+\.\S+$/.test(inviteFullEmail);

  const openInvite = () => { setInviteEmail(""); setInviteRole("interviewer"); setInviteErr(null); setApName(""); setApEmail(""); setApErr(null); setInviteOpen(true); };
  const sendInvite = async () => {
    setInviteErr(null);
    if (!inviteValid) { setInviteErr(tenantDomain ? `Enter the name before @${tenantDomain}.` : "Enter a valid work email address."); return; }
    setSending(true);
    const res = await inviteTeammate({ email: inviteFullEmail, role: inviteRole });
    setSending(false);
    if (!res.ok) { setInviteErr(res.error || "Couldn't send the invite."); return; }
    Keyboard.dismiss();
    setInviteOpen(false);
    load();
    setInviteDone({
      title: res.reactivated ? "Teammate reactivated" : "Invite sent",
      message: res.reactivated ? `${res.email} was already on Aster and has been re-added to your workspace.` : `${res.email} has been emailed an invite to join your workspace as ${inviteRole === "admin" ? "a hiring manager" : "an interviewer"}.`,
    });
  };

  // Group members by role, in seniority order, for a sectioned list.
  const groups = [];
  for (const role of ROLE_ORDER) {
    const members = (rows || []).filter((m) => m.role === role);
    if (members.length) groups.push({ role, members });
  }
  // Roles outside the known set (defensive) fall into one "Members" bucket.
  const others = (rows || []).filter((m) => !ROLE_ORDER.includes(m.role));
  if (others.length) groups.push({ role: "member", members: others });
  // Offer approvers appear as their own "APPROVER" section (confirmed first).
  const apItems = [
    ...(approvers || []).filter((a) => a.status === "confirmed"),
    ...(approvers || []).filter((a) => a.status !== "confirmed"),
  ].map((a) => ({ id: a.id, name: a.name || a.email, email: a.email, role: "approver", status: a.status, pending: a.status !== "confirmed", _approver: true }));
  if (apItems.length) groups.push({ role: "approver", members: apItems });

  const flat = groups.flatMap((g) => [{ _section: g.role, count: g.members.length }, ...g.members]);
  const total = rows ? rows.length : 0;

  const firstName = profile?.name?.split(" ")[0] || "there";
  const Header = (
    <View style={{ backgroundColor: theme.brand }}>
      <SafeAreaView edges={["top"]}>
        <TopBar
          mark
          subtitle="Your team"
          name={firstName}
          right={
            <HeaderActions
              unread={unread}
              // Invite is the primary action on this screen, so it gets a
              // user-plus chip in the header rather than living only in a card
              // further down the list. Hidden for roles that cannot invite.
              onAddPeople={canInvite ? openInvite : undefined}
              onSettings={() => navigation.navigate("Settings")}
              onBell={() => navigation.navigate("Notifications")}
            />
          }
        />
        <View style={styles.summaryWrap}>
          {rows && rows.length > 1 ? (
            // A role breakdown only says something once there is more than one
            // person. Below that it is a single tile stranded in a wide card.
            <View style={styles.summary}>
              {groups.map((g) => {
                const m = metaOf(g.role);
                return (
                  <View key={g.role} style={styles.sumTile}>
                    <View style={styles.sumIcon}><Feather name={m.icon} size={14} color="#fff" /></View>
                    <Text style={styles.sumCount}>{g.members.length}</Text>
                    <Text style={styles.sumLabel} numberOfLines={1}>{roleLabelOf(g.role) + (g.members.length === 1 ? "" : "s")}</Text>
                  </View>
                );
              })}
            </View>
          ) : rows && rows.length === 1 ? (
            // Solo workspace: spend the space on the one thing worth doing here
            // rather than reporting "1 Tenant" back to the only person present.
            <Press onPress={canInvite ? openInvite : undefined} disabled={!canInvite} scaleTo={0.98}
              accessibilityRole={canInvite ? "button" : undefined}
              accessibilityLabel={canInvite ? "Invite your first teammate" : undefined}>
              <View style={styles.soloCard}>
                <View style={styles.soloIcon}><Feather name="user-plus" size={16} color="#fff" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.soloTitle}>It's just you right now</Text>
                  <Text style={styles.soloSub} numberOfLines={2}>
                    {canInvite
                      ? "Invite hiring managers and interviewers to share the hiring."
                      : "Your workspace owner can invite more teammates."}
                  </Text>
                </View>
                {canInvite ? <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.7)" /> : null}
              </View>
            </Press>
          ) : (
            <Text style={styles.heroSub}>{rows ? "No teammates yet" : "Loading your team…"}</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );

  if (rows === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        {Header}
        <Loader label="Loading your team…" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        data={flat}
        keyExtractor={(item) => (item._section ? `s-${item._section}` : `m-${item.id}`)}
        ListHeaderComponent={<>{Header}</>}
        contentContainerStyle={{ paddingBottom: TAB_CLEARANCE, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} progressViewOffset={40} />}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: "center", paddingTop: space(12) }}>
            <EmptyState
              icon="users"
              title="No teammates yet"
              subtitle={canInvite ? "Build your interview panel. Invite a teammate and they'll get an email to join your workspace." : "Your panel is empty for now. Owners and admins can invite teammates from the Aster web app, and they'll appear here."}
              actionLabel={canInvite ? "Invite a teammate" : undefined}
              onAction={canInvite ? openInvite : undefined}
            />
          </View>
        }
        ListFooterComponent={rows.length ? (
          <View style={styles.footer}>
            <Feather name="info" size={13} color={theme.ink4} />
            <Text style={[type.small, { color: theme.ink4, marginLeft: 8, flex: 1 }]}>Manage roles and seats from the Aster web app.</Text>
          </View>
        ) : null}
        renderItem={({ item, index }) => {
          if (item._section) {
            const m = metaOf(item._section);
            return (
              <View style={styles.sectionRow}>
                <View style={[styles.sectionDot, { backgroundColor: m.color }]} />
                <Text style={styles.section}>{roleLabelOf(item._section).toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{item.count}</Text>
              </View>
            );
          }
          const m = metaOf(item.role);
          const you = item.id === profile?.userId;
          const isApprover = !!item._approver;
          // Status shows as a dot on the avatar (green = active/confirmed, amber
          // = pending) instead of a pill, leaving a single role chip below the
          // name and the email on its own full-width line.
          const removable = canInvite && (isApprover || (item.role !== "owner" && !you && !item.pending));
          return (
            <Rise delay={Math.min(index, 8) * 35}>
              <View style={styles.mcard}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View>
                    <View style={[styles.avatarRing, { borderColor: m.ring }]}><Avatar name={item.name} size={44} /></View>
                    <View style={[styles.statusDot, { backgroundColor: item.pending ? "#F59E0B" : "#22C55E" }]} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 13, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text style={[type.bodyStrong, { color: theme.ink, flexShrink: 1 }]} numberOfLines={1}>{item.name}</Text>
                      {you ? <View style={styles.youPill}><Text style={styles.youTxt}>You</Text></View> : null}
                      <View style={{ flex: 1, minWidth: 8 }} />
                      <View style={[styles.roleTag, { backgroundColor: m.bg }]}>
                        <Feather name={m.icon} size={11} color={m.color} />
                        <Text style={[type.smallStrong, { color: m.color, marginLeft: 5 }]}>{roleLabelOf(item.role)}</Text>
                      </View>
                      {removable ? (
                        <Pressable onPress={() => setConfirmRemove(item)} hitSlop={10} style={styles.mRemoveInline}><Feather name="x" size={16} color={theme.ink4} /></Pressable>
                      ) : null}
                    </View>
                    {item.email ? <Text style={[type.small, { color: theme.ink3, marginTop: 3 }]} numberOfLines={1}>{item.email}</Text> : null}
                  </View>
                </View>
              </View>
            </Rise>
          );
        }}
      />

      {/* Invite teammate sheet */}
      <Modal visible={inviteOpen} transparent animationType="slide" onRequestClose={() => setInviteOpen(false)} statusBarTranslucent>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => !sending && setInviteOpen(false)} />
          {/* Lift on BOTH platforms here. This Modal sets statusBarTranslucent,
              and such a modal window does NOT resize for the keyboard on
              Android, so without the manual lift "Send invite" ends up buried.
              (The Job Detail sheets omit that flag, do resize, and therefore
              must NOT be lifted on Android or they double-shift.) */}
          <View style={[styles.sheet, { paddingBottom: sheetPadBottom, marginBottom: kb > 0 ? kb : 0 }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <Text style={[type.h3, { color: theme.ink }]}>Add people</Text>
              <Pressable onPress={() => !sending && setInviteOpen(false)} hitSlop={8}><Feather name="x" size={22} color={theme.ink3} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: kb > 0 ? 300 : 540 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.apGroupHead}>Invite a teammate</Text>
            <Text style={[type.small, { color: theme.ink3, marginBottom: space(4) }]}>They get a login to your workspace.</Text>

            <Text style={styles.fieldLabel}>Email</Text>
            {tenantDomain ? (
              <>
                <View style={styles.emailRow}>
                  <TextInput
                    value={inviteEmail} onChangeText={setInviteEmail}
                    placeholder="name" placeholderTextColor={theme.ink4}
                    autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                    style={[styles.input, { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 }]}
                  />
                  <View style={styles.domainChip}><Text style={[type.smallStrong, { color: theme.ink3 }]}>@{tenantDomain}</Text></View>
                </View>
                <Text style={[type.small, { color: theme.ink4, marginTop: 6 }]}>Only teammates on your <Text style={{ color: theme.ink2, fontFamily: "Inter_600SemiBold" }}>@{tenantDomain}</Text> domain can be invited.</Text>
              </>
            ) : (
              <TextInput
                value={inviteEmail} onChangeText={setInviteEmail}
                placeholder="teammate@company.com" placeholderTextColor={theme.ink4}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
                style={styles.input}
              />
            )}

            <Text style={[styles.fieldLabel, { marginTop: space(4) }]}>Role</Text>
            <View style={{ gap: 10 }}>
              {[
                { k: "interviewer", label: "Interviewer", desc: "Joins panels, scores candidates on assigned roles", icon: "users" },
                { k: "admin", label: "Hiring Manager", desc: "Full access: runs roles, offers and hiring", icon: "shield" },
              ].map((r) => {
                const on = inviteRole === r.k;
                return (
                  <Pressable key={r.k} onPress={() => setInviteRole(r.k)} style={[styles.roleOpt, on && styles.roleOptOn]}>
                    <View style={[styles.roleOptIcon, on && { backgroundColor: theme.brand }]}><Feather name={r.icon} size={15} color={on ? "#fff" : theme.ink3} /></View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[type.smallStrong, { color: theme.ink }]}>{r.label}</Text>
                      <Text style={[type.small, { color: theme.ink3, marginTop: 1 }]}>{r.desc}</Text>
                    </View>
                    <View style={[styles.radio, on && styles.radioOn]}>{on ? <Feather name="check" size={12} color="#fff" /> : null}</View>
                  </Pressable>
                );
              })}
            </View>

            {inviteErr ? (
              <View style={styles.errRow}><Feather name="alert-circle" size={14} color="#B42318" /><Text style={[type.small, { color: "#B42318", marginLeft: 8, flex: 1 }]}>{inviteErr}</Text></View>
            ) : null}

            <Button title={sending ? "Sending…" : "Send invite"} icon={sending ? undefined : "send"} onPress={sendInvite} disabled={sending || !inviteValid} style={{ marginTop: space(5) }} />

            {/* Approver: no login, confirms by email, then can approve offers. */}
            <View style={styles.apSep} />
            <Text style={styles.apGroupHead}>Add an approver</Text>
            <Text style={[type.small, { color: theme.ink3, marginBottom: space(3) }]}>No login. They confirm by email, then can approve offers.</Text>
            <TextInput value={apName} onChangeText={setApName} placeholder="Name (optional)" placeholderTextColor={theme.ink4} style={[styles.input, { marginBottom: 10 }]} />
            <TextInput value={apEmail} onChangeText={setApEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="approver@email.com" placeholderTextColor={theme.ink4} style={styles.input} />
            {apErr ? (
              <View style={styles.errRow}><Feather name="alert-circle" size={14} color="#B42318" /><Text style={[type.small, { color: "#B42318", marginLeft: 8, flex: 1 }]}>{apErr}</Text></View>
            ) : null}
            <Button title={apBusy ? "Sending…" : "Add approver"} icon={apBusy ? undefined : "user-plus"} variant="secondary" onPress={submitApprover} disabled={apBusy} style={{ marginTop: space(4) }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!confirmRemove}
        variant="danger"
        icon="user-x"
        title={confirmRemove?._approver ? "Remove approver?" : "Remove teammate?"}
        message={confirmRemove
          ? (confirmRemove._approver
            ? `${confirmRemove.name || confirmRemove.email} will no longer be able to approve offers.`
            : `${confirmRemove.name || confirmRemove.email} will lose access to this workspace. Their scorecards and interviews stay on file.`)
          : ""}
        confirmLabel="Remove"
        cancelLabel="Keep"
        onConfirm={() => {
          if (confirmRemove) { confirmRemove._approver ? removeApproverRow(confirmRemove.id) : removeTeammateRow(confirmRemove); }
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />

      <SuccessModal
        visible={!!inviteDone}
        title={inviteDone?.title || "Invite sent"}
        message={inviteDone?.message || ""}
        onClose={() => setInviteDone(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inviteCta: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), marginHorizontal: space(4), marginTop: space(4), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  inviteIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.brandSoft, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(10,14,40,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space(5), paddingTop: space(3), paddingBottom: space(6) },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: space(3) },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(1) },
  fieldLabel: { ...type.smallStrong, color: theme.ink2, marginBottom: 7 },
  apGroupHead: { fontFamily: "Inter_700Bold", fontSize: 13.5, color: theme.ink, marginBottom: 3 },
  apSep: { height: 1, backgroundColor: theme.line, marginVertical: space(5) },
  input: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, paddingHorizontal: 14, height: 48, fontFamily: "Inter_500Medium", fontSize: 14.5, color: theme.ink },
  emailRow: { flexDirection: "row", alignItems: "stretch" },
  domainChip: { justifyContent: "center", paddingHorizontal: 12, backgroundColor: theme.line2, borderWidth: 1, borderColor: theme.line, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
  roleOpt: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: theme.line, borderRadius: radius.md, padding: 12, backgroundColor: theme.bg },
  roleOptOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  roleOptIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: theme.line2, alignItems: "center", justifyContent: "center" },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.line, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  errRow: { flexDirection: "row", alignItems: "flex-start", marginTop: space(3), padding: space(3), borderRadius: radius.md, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  summaryWrap: { paddingHorizontal: space(5), paddingBottom: space(5), paddingTop: space(1) },
  heroSub: { fontFamily: "Inter_500Medium", fontSize: 14, color: "rgba(255,255,255,0.82)" },
  // Solo-workspace card: replaces the meaningless "1 Tenant" tile with the one
  // action worth taking here. Sits on the brand header, so a frosted surface.
  soloCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: 14,
  },
  soloIcon: {
    width: 34, height: 34, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center",
  },
  soloTitle: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 15, color: "#fff" },
  soloSub: { fontFamily: "Inter_500Medium", fontSize: 12, color: "rgba(255,255,255,0.82)", marginTop: 2, lineHeight: 17 },
  summary: { flexDirection: "row", gap: 10 },
  sumTile: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 10, alignItems: "flex-start" },
  sumIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  sumCount: { fontFamily: "PlusJakartaSans_700Bold", fontSize: 20, color: "#fff", fontVariant: ["tabular-nums"] },
  sumLabel: { fontFamily: "Inter_500Medium", fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 1 },

  sectionRow: { flexDirection: "row", alignItems: "center", marginTop: space(5), marginBottom: space(2), paddingHorizontal: space(5) },
  sectionDot: { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  section: { ...type.label, color: theme.ink3 },
  sectionCount: { ...type.label, color: theme.ink4, marginLeft: 6 },

  card: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: radius.card, padding: space(3.5), marginHorizontal: space(4), marginBottom: space(2.5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  mcard: { position: "relative", backgroundColor: theme.card, borderRadius: radius.card, padding: space(4), marginHorizontal: space(4), marginBottom: space(2.5), shadowColor: "#1A1A22", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  mRemove: { position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", zIndex: 3 },
  statusDot: { position: "absolute", bottom: 1, right: 1, width: 15, height: 15, borderRadius: 8, borderWidth: 3, borderColor: theme.card },
  avatarRing: { borderWidth: 2, borderRadius: 27, padding: 2 },
  youPill: { backgroundColor: theme.brandSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  youTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: theme.brand },
  roleTag: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  pending: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, color: theme.warn, marginTop: 5 },
  footer: { flexDirection: "row", alignItems: "center", marginHorizontal: space(4), marginTop: space(4), padding: space(3), backgroundColor: theme.line2, borderRadius: radius.md },
});
