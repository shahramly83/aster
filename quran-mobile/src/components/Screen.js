// Standard screen chrome: safe-area padding + themed background. Keeps every
// screen from repeating the same SafeAreaView/StatusBar boilerplate.
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColors } from '../theme';

export default function Screen({ children, edges = ['top'], style }) {
  const c = useColors();
  return (
    <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor: c.bg }]}>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.body, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1 },
});
