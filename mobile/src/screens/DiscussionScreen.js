import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { loadMessages, sendMessage, subscribeMessages } from "../lib/data";
import { Avatar, Loader, EmptyState, Feather } from "../components/ui";
import { theme, type, space, radius } from "../theme";
import { relTime } from "@aster/shared";

// Candidate-scoped chat between the hiring manager and the interview panel.
export default function DiscussionScreen({ route }) {
  const { profile } = useAuth();
  const { candidateId, jobId, candidateName } = route.params || {};
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const load = useCallback(async () => {
    setMessages(await loadMessages(candidateId));
    scrollEnd();
  }, [candidateId]);

  useEffect(() => { load(); }, [load]);

  // Live updates: append inserts from anyone else (our own echo is added on send).
  useEffect(() => {
    const unsub = subscribeMessages(candidateId, (row) => {
      setMessages((prev) => {
        if (!prev || prev.some((m) => m.id === row.id)) return prev;
        return [...prev, { id: row.id, authorId: row.author_id, authorName: row.author_id === profile.userId ? "You" : "Teammate", body: row.body, createdAt: row.created_at }];
      });
      scrollEnd();
    });
    return unsub;
  }, [candidateId, profile?.userId]);

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    // Optimistic bubble.
    const tempId = `temp-${text.length}-${text.slice(0, 4)}`;
    setMessages((prev) => [...(prev || []), { id: tempId, authorId: profile.userId, authorName: "You", body: text, createdAt: new Date().toISOString(), pending: true }]);
    scrollEnd();
    try {
      const saved = await sendMessage({ companyId: profile.companyId, candidateId, jobId, authorId: profile.userId, body: text });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: saved?.id || m.id, pending: false } : m)));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true, pending: false } : m)));
    } finally {
      setSending(false);
    }
  };

  if (messages === null) return <Loader label="Loading discussion…" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: space(4), paddingBottom: space(4), flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollEnd}
          ListHeaderComponent={
            <View style={styles.banner}>
              <Feather name="users" size={13} color={theme.ink3} />
              <Text style={[type.small, { color: theme.ink3, marginLeft: 6, flex: 1 }]}>
                Private discussion about {candidateName || "this candidate"} with your panel.
              </Text>
            </View>
          }
          ListEmptyComponent={<View style={{ marginTop: space(10) }}><EmptyState icon="message-circle" title="No messages yet" subtitle="Start the conversation with your interview panel." /></View>}
          renderItem={({ item }) => <Bubble m={item} mine={item.authorId === profile.userId} />}
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Message the panel…"
            placeholderTextColor={theme.ink4}
            value={draft} onChangeText={setDraft} multiline
          />
          <Pressable onPress={onSend} disabled={!draft.trim()} style={[styles.send, !draft.trim() && { opacity: 0.4 }]}>
            <Feather name="arrow-up" size={20} color={theme.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ m, mine }) {
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheir]}>
      {!mine ? <Avatar name={m.authorName} size={30} /> : null}
      <View style={{ maxWidth: "78%", marginLeft: mine ? 0 : 8 }}>
        {!mine ? <Text style={[type.smallStrong, { color: theme.ink3, marginBottom: 3, marginLeft: 4 }]}>{m.authorName}</Text> : null}
        <View style={[styles.bubble, mine ? styles.mine : styles.their]}>
          <Text style={[type.body, { color: mine ? theme.white : theme.ink }]}>{m.body}</Text>
        </View>
        <Text style={[type.small, { color: theme.ink4, fontSize: 11, marginTop: 3, textAlign: mine ? "right" : "left", marginHorizontal: 4 }]}>
          {m.failed ? "Failed to send" : m.pending ? "Sending…" : relTime(m.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", backgroundColor: theme.line2, borderRadius: radius.md, padding: 12, marginBottom: space(4) },
  row: { flexDirection: "row", marginBottom: space(4), alignItems: "flex-end" },
  rowMine: { justifyContent: "flex-end" },
  rowTheir: { justifyContent: "flex-start" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg },
  mine: { backgroundColor: theme.brand, borderBottomRightRadius: 4 },
  their: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderBottomLeftRadius: 4 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: space(4), paddingVertical: space(3), borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.card },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontFamily: "Inter_400Regular", fontSize: 15, color: theme.ink },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.brand, alignItems: "center", justifyContent: "center" },
});
